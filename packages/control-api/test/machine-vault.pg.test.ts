// The login vault and the owner-only attach against the REAL schema (0160, relay.ts, machine-vault.ts).
//
// What this locks down, on a two-person Pro workspace after the first invitation (ensureTeamShape):
//   · the relay attach: member B cannot attach to member A's machine, A can, both can attach to the
//     shared runner, and a person outside the workspace attaches to nothing
//   · the vault is per machine and read by the machine token only: B's machine reads nothing of A's,
//     the shared runner is refused, and a stale epoch is fenced
//   · the row holds ciphertext only, and a row copied onto another machine does not open there
//   · leaving the workspace deletes the leaver's vault row with the machine tombstone
//
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { hashMachineToken } from '../src/machine-auth';
import { destroyMemberMachine } from '../src/member-machines';
import { PostgresStore } from '../src/pgstore';
import { applyPlanPatch } from '../src/plan-flip';
import { localWrapper } from '../src/vault-crypto';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const KEY = localWrapper(Buffer.alloc(32, 3));
const app = store ? createApp(store, { vault: { config: { enabled: true, writer: KEY, readers: [KEY] } } }) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const b64 = (s: string): string => Buffer.from(s).toString('base64');
const RELAY_SECRET = 'relay-secret-for-the-vault-suite';
const DEV_TOKEN = 'd'.repeat(40);

function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

async function makeUser(clerkId: string, email: string): Promise<Actor> {
  const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${clerkId}, ${email})
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  return { kind: 'human', id: row!['id'] as string };
}

async function until<T>(read: () => Promise<T | null>, ms = 4000): Promise<T | null> {
  const t0 = Date.now();
  for (;;) {
    const v = await read();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, 50));
  }
}

interface Row { id: string; kind: string; owner_user_id: string }
const liveOf = async (ws: string): Promise<Row[]> =>
  (await sql!`select id, kind, owner_user_id from machines where workspace_id = ${ws}::uuid and (lifecycle is null or lifecycle <> 'destroyed') order by created_at`) as unknown as Row[];

/** the relay's attach question, as nm-relay asks it, for the person the dev relay token names */
async function attach(userId: string, machineId: string): Promise<boolean> {
  process.env['NM_DEV_RELAY_USER'] = userId;
  const res = await app!.request('/internal/relay/validate-client', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${RELAY_SECRET}` },
    body: JSON.stringify({ clerkToken: DEV_TOKEN, machineId }),
  });
  expect(res.status).toBe(200);
  return (await j(res)).allowed === true;
}

/** a Cloud Run machine at epoch 1 with a current machine token, as POST /v1/machines/boot leaves it */
async function bootAsCloudRun(machineId: string): Promise<string> {
  const token = `nmm_${machineId.replace(/-/g, '').slice(0, 24)}${'0'.repeat(24)}`;
  await sql!`update machines set substrate = 'cloudrun', epoch = 1, token_epoch = 1, token_expires_at = null,
               token_hash = ${hashMachineToken(token)} where id = ${machineId}::uuid`;
  return token;
}

const vaultGet = (token: string) => app!.request('/v1/machines/vault', { headers: { authorization: `Bearer ${token}` } });
const vaultPut = (token: string, body: unknown) => app!.request('/v1/machines/vault', {
  method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
});

const saved: Record<string, string | undefined> = {};
const ENV = ['FLEET_AUTOPROVISION', 'RELAY_SECRET', 'NM_ALLOW_DEV_RELAY', 'NM_DEV_RELAY_TOKEN', 'NM_DEV_RELAY_USER'];
let alice: Actor; let bob: Actor; let cara: Actor;
let WS = '';
let A = ''; let B = ''; let RUNNER = '';
let tokA = ''; let tokB = ''; let tokRunner = '';

beforeAll(async () => {
  if (!sql) return;
  for (const k of ENV) saved[k] = process.env[k];
  process.env['FLEET_AUTOPROVISION'] = 'on';
  process.env['RELAY_SECRET'] = RELAY_SECRET;
  process.env['NM_ALLOW_DEV_RELAY'] = '1';
  process.env['NM_DEV_RELAY_TOKEN'] = DEV_TOKEN;
  alice = await makeUser('clerk_mv_alice', 'alice@machine-vault.test');
  bob = await makeUser('clerk_mv_bob', 'bob@machine-vault.test');
  cara = await makeUser('clerk_mv_cara', 'cara@machine-vault.test');
  // alice's first workspace is the Pro trial; the suite's is her second, flipped to Pro by the webhook
  await send(alice, { type: 'workspace.create', name: 'Vault Trial', slug: `mv-trial-${Date.now().toString(36)}` });
  WS = (await j(await send(alice, { type: 'workspace.create', name: 'Vault', slug: `mv-${Date.now().toString(36)}` }))).workspaceId as string;
  expect(await applyPlanPatch(store!, { workspace: WS, patch: { plan: 'cloud', subscriptionStatus: 'active', stripeCustomerId: 'cus_mv', stripeSubscriptionId: `sub_mv_${WS.slice(0, 8)}` } })).toBe('ok');
  // the first invitation promotes the runner into alice's machine and mints a fresh runner
  const inv = await j(await send(alice, { type: 'workspace.invite', workspace: WS, email: 'bob@machine-vault.test' }));
  expect((await send(bob, { type: 'workspace.accept_invite', invite: inv.inviteId })).status).toBe(200);
  const rows = await until(async () => {
    const r = await liveOf(WS);
    return r.some((m) => m.kind === 'member' && m.owner_user_id === bob.id) ? r : null;
  });
  A = rows!.find((m) => m.kind === 'member' && m.owner_user_id === alice.id)!.id;
  B = rows!.find((m) => m.kind === 'member' && m.owner_user_id === bob.id)!.id;
  RUNNER = rows!.find((m) => m.kind === 'runner')!.id;
  tokA = await bootAsCloudRun(A);
  tokB = await bootAsCloudRun(B);
  tokRunner = await bootAsCloudRun(RUNNER);
});

afterAll(async () => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('owner-only attach on a member machine (relay.ts validate-client, real SQL)', () => {
  it('member B cannot attach to member A\'s machine; A can', async () => {
    expect(await attach(bob.id, A)).toBe(false);
    expect(await attach(alice.id, A)).toBe(true);
    expect(await attach(alice.id, B)).toBe(false);
    expect(await attach(bob.id, B)).toBe(true);
  });

  it('the shared runner is open to every member, and to nobody outside the workspace', async () => {
    expect(await attach(alice.id, RUNNER)).toBe(true);
    expect(await attach(bob.id, RUNNER)).toBe(true);
    expect(await attach(cara.id, RUNNER)).toBe(false);
    expect(await attach(cara.id, A)).toBe(false);
  });
});

describe.skipIf(!DB)('the login vault (0160) on member machines, real SQL', () => {
  const MARK = 'oauth_token: gho_vault_suite_marker';

  it('A\'s machine writes its login, reads it back, and B\'s machine reads nothing of it', async () => {
    const put = await vaultPut(tokA, { epoch: 1, baseGeneration: 0, files: [{ path: '.config/gh/hosts.yml', data: b64(`github.com:\n  ${MARK}\n`) }], machineId: B });
    expect(put.status).toBe(200);
    expect(await j(put)).toEqual({ generation: 1 });
    expect(await j(await vaultGet(tokA))).toEqual({ generation: 1, files: [{ path: '.config/gh/hosts.yml', data: b64(`github.com:\n  ${MARK}\n`) }] });
    expect(await j(await vaultGet(tokB))).toEqual({ generation: 0, files: [] });
    const [row] = await sql!`select workspace_id, generation, epoch, key_ref, ciphertext from machine_vault where machine_id = ${A}::uuid`;
    expect(row!['workspace_id']).toBe(WS);
    expect(row!['key_ref']).toBe('local:v1');
    expect(Buffer.from(row!['ciphertext'] as Buffer).includes(Buffer.from('gho_vault_suite_marker'))).toBe(false);
    expect((await sql!`select count(*)::int as n from machine_vault where machine_id = ${B}::uuid`)[0]!['n']).toBe(0);
  });

  it('the shared runner is refused, and a person\'s bearer is not a machine', async () => {
    const res = await vaultGet(tokRunner);
    expect(res.status).toBe(403);
    expect((await j(res)).code).toBe('VAULT_SHARED_MACHINE');
    const person = await app!.request('/v1/machines/vault', { headers: { 'x-nm-actor': JSON.stringify(alice) } });
    expect(person.status).toBe(403);
    expect((await j(person)).code).toBe('MACHINE_ONLY');
  });

  it('a stale epoch is fenced, and a write on a generation nobody holds is a conflict', async () => {
    await sql!`update machines set epoch = 2, token_epoch = 2 where id = ${A}::uuid`;
    const stale = await vaultPut(tokA, { epoch: 1, baseGeneration: 1, files: [] });
    expect(stale.status).toBe(409);
    expect((await j(stale)).code).toBe('STALE_EPOCH');
    const lost = await vaultPut(tokB, { epoch: 1, baseGeneration: 5, files: [{ path: '.gitconfig', data: b64('[user]') }] });
    expect(lost.status).toBe(409);
    expect(await j(lost)).toMatchObject({ code: 'VAULT_CONFLICT', generation: 0 });
    expect(await j(await vaultGet(tokA))).toMatchObject({ generation: 1 });
  });

  it('a row copied onto another machine does not open there', async () => {
    await sql!`insert into machine_vault (machine_id, workspace_id, generation, epoch, key_ref, wrapped_key, iv, tag, ciphertext)
               select ${B}::uuid, workspace_id, generation, epoch, key_ref, wrapped_key, iv, tag, ciphertext from machine_vault where machine_id = ${A}::uuid`;
    const res = await vaultGet(tokB);
    expect(res.status).toBe(500);
    expect((await j(res)).code).toBe('VAULT_UNREADABLE');
  });

  it('leaving deletes the leaver\'s vault with the machine tombstone; the owner\'s stays', async () => {
    expect(await destroyMemberMachine(sql!, WS, bob.id)).toEqual([B]);
    expect((await sql!`select count(*)::int as n from machine_vault where machine_id = ${B}::uuid`)[0]!['n']).toBe(0);
    expect((await sql!`select count(*)::int as n from machine_vault where machine_id = ${A}::uuid`)[0]!['n']).toBe(1);
    expect((await vaultGet(tokB)).status).toBe(401);
  });
});
