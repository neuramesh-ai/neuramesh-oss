// The login vault routes (machine-vault.ts) with the storage as a fake repo and the real crypto. The
// contract: a machine bearer only; the machine comes from the TOKEN, never the path, query or body;
// only a Cloud Run machine that one person owns keeps logins; a write names the allowlist only,
// under the caps, at the machine's epoch, on the generation it read.
import type { Actor } from '@neuramesh/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { hashMachineToken } from './machine-auth';
import { checkVaultFiles, machineVaultRoutes, soloRunnerVault, staleEpoch, vaultRefusal, type VaultMachine, type VaultRepo, type VaultRow } from './machine-vault';
import type { Store } from './store';
import { localWrapper, openVault, type VaultConfig } from './vault-crypto';

const WS = '0f0f0f0f-0000-4000-8000-000000000001';
const A = '1a1a1a1a-0000-4000-8000-000000000001';
const B = '1a1a1a1a-0000-4000-8000-000000000002';
const TOKEN_A = `nmm_${'ab'.repeat(24)}`;
const TOKEN_B = `nmm_${'cd'.repeat(24)}`;
const KEY = localWrapper(Buffer.alloc(32, 7));
const on: VaultConfig = { enabled: true, writer: KEY, readers: [KEY] };
const b64 = (s: string): string => Buffer.from(s).toString('base64');

const store = {
  machineByTokenHash: async (hash: string) => {
    if (hash === hashMachineToken(TOKEN_A)) return { id: A, workspace_id: WS, owner_user_id: 'u1', kind: 'member', owner_clerk_id: null };
    if (hash === hashMachineToken(TOKEN_B)) return { id: B, workspace_id: WS, owner_user_id: 'u2', kind: 'member', owner_clerk_id: null };
    return null;
  },
} as unknown as Store;

const member = (id: string, o: Partial<VaultMachine> = {}): VaultMachine => ({ id, workspaceId: WS, kind: 'member', substrate: 'cloudrun', members: 2, team: true, ...o });

function fakeRepo(machines: Record<string, VaultMachine>, epochs: Record<string, number> = {}) {
  const rows = new Map<string, VaultRow>();
  const forgot: string[] = [];
  const repo: VaultRepo = {
    machine: async (id) => machines[id] ?? null,
    read: async (id) => rows.get(id) ?? null,
    write: async (m, row) => {
      if ((epochs[m.machineId] ?? 0) !== m.epoch) return false;
      const cur = rows.get(m.machineId);
      if ((cur?.generation ?? 0) !== m.base) return false;
      rows.set(m.machineId, row);
      return true;
    },
    forget: async (id) => { forgot.push(id); rows.delete(id); },
    fence: async (id, epoch) => { if ((epochs[id] ?? 0) !== epoch) throw staleEpoch(epoch); },
  };
  return { repo, rows, forgot };
}

function mkApp(o: { machines?: Record<string, VaultMachine>; epochs?: Record<string, number>; config?: VaultConfig } = {}) {
  const fake = fakeRepo(o.machines ?? { [A]: member(A), [B]: member(B) }, o.epochs);
  const app = new Hono<{ Variables: { actor: Actor } }>();
  machineVaultRoutes(app, store, { repo: fake.repo, config: o.config ?? on });
  return { app, ...fake };
}

type App = ReturnType<typeof mkApp>['app'];
const get = (app: App, auth: string | null = `Bearer ${TOKEN_A}`, query = '') =>
  app.request(`/v1/machines/vault${query}`, { headers: auth ? { authorization: auth } : {} });
const put = (app: App, body: unknown, auth: string | null = `Bearer ${TOKEN_A}`) =>
  app.request('/v1/machines/vault', { method: 'PUT', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

describe('the login vault: who may read and write', () => {
  it('is a machine bearer only: a person is 403 MACHINE_ONLY, an unknown token 401', async () => {
    const { app } = mkApp();
    const person = await get(app, 'Bearer eyJhbGciOi.clerk.jwt');
    expect(person.status).toBe(403);
    expect((await json(person))['code']).toBe('MACHINE_ONLY');
    expect((await get(app, null)).status).toBe(403);
    expect((await get(app, `Bearer nmm_${'ef'.repeat(24)}`)).status).toBe(401);
    expect((await put(app, { epoch: 0, baseGeneration: 0, files: [] }, 'Bearer eyJ.person')).status).toBe(403);
  });

  it('answers 404 VAULT_OFF when NM_VAULT is off, and 503 when it is on with no key', async () => {
    expect((await json(await get(mkApp({ config: { enabled: false, writer: null, readers: [] } }).app)))['code']).toBe('VAULT_OFF');
    const nokey = await get(mkApp({ config: { enabled: true, writer: null, readers: [] } }).app);
    expect(nokey.status).toBe(503);
  });

  it('scopes to the token: machine B never reads A, and a named machine in the query or body is ignored', async () => {
    const { app, rows } = mkApp();
    const w = await put(app, { epoch: 0, baseGeneration: 0, files: [{ path: '.config/gh/hosts.yml', data: b64('github.com: A') }], machineId: B, workspaceId: 'x' });
    expect(w.status).toBe(200);
    expect([...rows.keys()]).toEqual([A]);
    const readB = await get(app, `Bearer ${TOKEN_B}`, `?machineId=${A}&workspaceId=${WS}`);
    expect(await json(readB)).toEqual({ generation: 0, files: [] });
    const readA = await get(app);
    expect(readA.headers.get('cache-control')).toBe('no-store');
    expect(await json(readA)).toEqual({ generation: 1, files: [{ path: '.config/gh/hosts.yml', data: b64('github.com: A') }] });
  });

  it('a row copied onto another machine does not open there', async () => {
    const { app, rows } = mkApp();
    await put(app, { epoch: 0, baseGeneration: 0, files: [{ path: '.gitconfig', data: b64('[user]') }] });
    rows.set(B, rows.get(A)!);
    const res = await get(app, `Bearer ${TOKEN_B}`);
    expect(res.status).toBe(500);
    expect((await json(res))['code']).toBe('VAULT_UNREADABLE');
    await expect(openVault([KEY], rows.get(A)!, WS, A, 1)).resolves.toBeInstanceOf(Buffer);
  });
});

describe('the login vault: which machines keep logins', () => {
  it('a member machine does, a shared runner does not and its old row goes, a volume machine does not', () => {
    expect(vaultRefusal(member(A))).toBeNull();
    // the one-person runner keeps logins by default (D14), and NM_VAULT_SOLO_RUNNER=0 turns that off
    expect(soloRunnerVault({})).toBe(true);
    expect(soloRunnerVault({ NM_VAULT_SOLO_RUNNER: '0' })).toBe(false);
    expect(vaultRefusal(member(A, { kind: 'runner', members: 1, team: false }), { soloRunner: false })?.code).toBe('VAULT_SHARED_MACHINE');
    expect(vaultRefusal(member(A, { kind: 'runner', members: 1, team: false }), { soloRunner: true })).toBeNull();
    expect(vaultRefusal(member(A, { kind: 'runner', members: 2, team: false }), { soloRunner: true })?.code).toBe('VAULT_SHARED_MACHINE');
    expect(vaultRefusal(member(A, { kind: 'runner', members: 2, team: false }))?.code).toBe('VAULT_SHARED_MACHINE');
    expect(vaultRefusal(member(A, { kind: 'runner', members: 1, team: true }))?.code).toBe('VAULT_SHARED_MACHINE');
    expect(vaultRefusal(member(A, { substrate: 'volume' }))?.code).toBe('VAULT_NOT_CLOUDRUN');
  });

  it('a shared runner is refused with 403 VAULT_SHARED_MACHINE, and any row it kept is forgotten', async () => {
    const { app, rows, forgot } = mkApp({ machines: { [A]: member(A, { kind: 'runner', members: 3, team: true }) } });
    rows.set(A, { generation: 1, keyRef: 'local:v1', wrappedKey: Buffer.alloc(40), iv: Buffer.alloc(12), tag: Buffer.alloc(16), ciphertext: Buffer.alloc(1) });
    const res = await get(app);
    expect(res.status).toBe(403);
    expect((await json(res))['code']).toBe('VAULT_SHARED_MACHINE');
    expect(forgot).toEqual([A]);
    expect(rows.size).toBe(0);
    expect((await put(app, { epoch: 0, baseGeneration: 0, files: [] })).status).toBe(403);
  });
});

describe('the login vault: what a write may carry', () => {
  it('only the allowlist, once each, as base64, under the caps', () => {
    expect(checkVaultFiles([{ path: '.ssh/id_ed25519', data: '' }])).toMatchObject({ status: 400, code: 'VAULT_PATH' });
    expect(checkVaultFiles([{ path: '../.gitconfig', data: '' }])).toMatchObject({ code: 'VAULT_PATH' });
    expect(checkVaultFiles([{ path: '.gitconfig', data: '' }, { path: '.gitconfig', data: '' }])).toMatchObject({ code: 'INVALID_INPUT' });
    expect(checkVaultFiles([{ path: '.gitconfig', data: 'not base64!' }])).toMatchObject({ code: 'INVALID_INPUT' });
    expect(checkVaultFiles([{ path: '.gitconfig', data: Buffer.alloc(64 * 1024 + 1).toString('base64') }])).toMatchObject({ status: 413 });
    const five = ['.claude/.credentials.json', '.codex/auth.json', '.gemini/antigravity-cli/antigravity-oauth-token', '.config/gh/hosts.yml', '.gitconfig'];
    expect(checkVaultFiles(five.map((path) => ({ path, data: Buffer.alloc(60 * 1024).toString('base64') })))).toMatchObject({ status: 413, code: 'VAULT_TOO_LARGE' });
    expect(checkVaultFiles(five.map((path) => ({ path, data: b64('x') })))).toEqual({ files: five.map((path) => ({ path, data: b64('x') })) });
  });

  it('refuses a path outside the allowlist through the route, and a body with no epoch', async () => {
    const { app, rows } = mkApp();
    expect((await put(app, { epoch: 0, baseGeneration: 0, files: [{ path: '.bash_history', data: b64('x') }] })).status).toBe(400);
    expect((await put(app, { baseGeneration: 0, files: [] })).status).toBe(400);
    expect(rows.size).toBe(0);
  });

  it('is fenced by epoch: a replaced instance gets 409 STALE_EPOCH and writes nothing', async () => {
    const { app, rows } = mkApp({ epochs: { [A]: 4 } });
    const stale = await put(app, { epoch: 3, baseGeneration: 0, files: [{ path: '.gitconfig', data: b64('old') }] });
    expect(stale.status).toBe(409);
    expect((await json(stale))['code']).toBe('STALE_EPOCH');
    expect(rows.size).toBe(0);
    expect((await put(app, { epoch: 4, baseGeneration: 0, files: [{ path: '.gitconfig', data: b64('new') }] })).status).toBe(200);
  });

  it('is a compare and swap on the generation: a write on an old generation is 409 VAULT_CONFLICT with the head', async () => {
    const { app } = mkApp();
    expect(await json(await put(app, { epoch: 0, baseGeneration: 0, files: [{ path: '.gitconfig', data: b64('1') }] }))).toEqual({ generation: 1 });
    expect(await json(await put(app, { epoch: 0, baseGeneration: 1, files: [{ path: '.gitconfig', data: b64('2') }] }))).toEqual({ generation: 2 });
    const lost = await put(app, { epoch: 0, baseGeneration: 1, files: [{ path: '.gitconfig', data: b64('3') }] });
    expect(lost.status).toBe(409);
    expect(await json(lost)).toMatchObject({ code: 'VAULT_CONFLICT', generation: 2 });
    // a sign-out: the empty set is a real write, and the vault forgets the file
    expect((await put(app, { epoch: 0, baseGeneration: 2, files: [] })).status).toBe(200);
    expect(await json(await get(app))).toEqual({ generation: 3, files: [] });
  });
});
