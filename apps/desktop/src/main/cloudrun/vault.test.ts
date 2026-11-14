// The login vault, machine side (vault.ts): the boot writes the vault into the home as 0600 files and
// never fails on a bad read, the agent uploads a change once it holds still, the drain flush uploads
// at once, a fence or a refusal stops it, and no link in the home is ever followed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VaultFile, VaultRead, VaultWrite } from '@neuramesh/shared';
import { EpochFencedError, MachineTokenRejected } from './snapshot';
import { apiVaultChannel, fingerprintOf, scanHome, VaultAgent, writeAbsent, type VaultChannel, type VaultRefused, type VaultWriteResult } from './vault';

const b64 = (s: string): string => Buffer.from(s).toString('base64');
const home = (): string => mkdtempSync(join(tmpdir(), 'nm-vault-'));

interface FakeServer { channel: VaultChannel; writes: VaultWrite[]; reads: number; state: { generation: number; files: VaultFile[] } }

function server(o: { files?: VaultFile[]; generation?: number; readFails?: number; refuse?: string; fenceWrites?: boolean; rejectReads?: boolean; conflictOnce?: number } = {}): FakeServer {
  const state = { generation: o.generation ?? (o.files?.length ? 1 : 0), files: o.files ?? [] };
  const writes: VaultWrite[] = [];
  let readFails = o.readFails ?? 0;
  let conflictOnce = o.conflictOnce;
  const s: FakeServer = {
    writes, reads: 0, state,
    channel: {
      read: async (): Promise<VaultRead | VaultRefused> => {
        s.reads += 1;
        if (o.rejectReads) throw new MachineTokenRejected('401');
        if (readFails > 0) { readFails -= 1; throw new Error('HTTP 503'); }
        if (o.refuse) return { refused: o.refuse };
        return { generation: state.generation, files: state.files };
      },
      write: async (w): Promise<VaultWriteResult> => {
        writes.push(w);
        if (o.fenceWrites) throw new EpochFencedError('stale');
        if (o.refuse) return { refused: o.refuse };
        if (conflictOnce !== undefined) { state.generation = conflictOnce; conflictOnce = undefined; return { conflict: state.generation }; }
        if (w.baseGeneration !== state.generation) return { conflict: state.generation };
        state.generation += 1;
        state.files = w.files;
        return { generation: state.generation };
      },
    },
  };
  return s;
}

function agent(dir: string, s: FakeServer, epoch = 5) {
  const fences: string[] = [];
  const rejects: string[] = [];
  const a = new VaultAgent({ channel: s.channel, homeDir: dir, epoch: () => epoch, onFence: (w) => fences.push(w), onRejected: (w) => rejects.push(w), log: () => {} });
  return { a, fences, rejects };
}

test('restore writes the vault into the home as 0600 files in 0700 dirs, before anything else runs', async () => {
  const dir = home();
  const s = server({ files: [{ path: '.config/gh/hosts.yml', data: b64('github.com:\n  oauth_token: gho_x\n') }, { path: '.gitconfig', data: b64('[user]\n') }], generation: 4 });
  const { a } = agent(dir, s);
  const out = await a.restore();
  assert.deepEqual(out, { generation: 4, restored: ['.config/gh/hosts.yml', '.gitconfig'] });
  assert.equal(readFileSync(join(dir, '.config/gh/hosts.yml'), 'utf8'), 'github.com:\n  oauth_token: gho_x\n');
  assert.equal(statSync(join(dir, '.config/gh/hosts.yml')).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, '.config/gh')).mode & 0o777, 0o700);
  // nothing changed since the restore: no upload
  await a.poll(); await a.poll();
  assert.equal(s.writes.length, 0);
});

test('a failed read never fails the boot, and the agent reads again on its next poll', async () => {
  const dir = home();
  const s = server({ files: [{ path: '.codex/auth.json', data: b64('{"t":1}') }], readFails: 1 });
  const { a } = agent(dir, s);
  assert.deepEqual(await a.restore(), { generation: null, restored: [] });
  await a.poll();
  assert.equal(readFileSync(join(dir, '.codex/auth.json'), 'utf8'), '{"t":1}');
  assert.equal(s.writes.length, 0);
});

test('a fence or a refused token at the boot read throws, as every boot step does', async () => {
  await assert.rejects(agent(home(), server({ rejectReads: true })).a.restore(), MachineTokenRejected);
});

test('a change uploads once it holds still for one poll, with the epoch and the generation it read', async () => {
  const dir = home();
  const s = server();
  const { a } = agent(dir, s, 7);
  await a.restore();
  mkdirSync(join(dir, '.config/gh'), { recursive: true });
  writeFileSync(join(dir, '.config/gh/hosts.yml'), 'github.com: one');
  await a.poll();
  assert.equal(s.writes.length, 0, 'not on the poll that first sees it');
  await a.poll();
  assert.equal(s.writes.length, 1);
  assert.deepEqual(s.writes[0], { epoch: 7, baseGeneration: 0, files: [{ path: '.config/gh/hosts.yml', data: b64('github.com: one') }] });
  await a.poll();
  assert.equal(s.writes.length, 1, 'once per change');
  // a sign-out is a change too: the empty set forgets the file
  writeFileSync(join(dir, '.config/gh/hosts.yml'), '');
  await a.poll(); await a.poll();
  assert.deepEqual(s.writes[1], { epoch: 7, baseGeneration: 1, files: [] });
});

test('the drain flush uploads at once, still or not', async () => {
  const dir = home();
  const s = server();
  const { a } = agent(dir, s);
  await a.restore();
  writeFileSync(join(dir, '.gitconfig'), '[user]\n  name = A\n');
  await a.flush();
  assert.equal(s.writes.length, 1);
  await a.flush();
  assert.equal(s.writes.length, 1);
});

test('a 409 STALE_EPOCH fences the lifecycle and stops the agent; a refusal stops it quietly', async () => {
  const dir = home();
  const s = server({ fenceWrites: true });
  const { a, fences } = agent(dir, s);
  await a.restore();
  writeFileSync(join(dir, '.gitconfig'), 'x');
  await a.flush();
  assert.equal(fences.length, 1);
  assert.equal(a.active, false);
  writeFileSync(join(dir, '.gitconfig'), 'y');
  await a.flush();
  assert.equal(s.writes.length, 1, 'a fenced agent writes nothing more');

  const shared = server({ refuse: 'VAULT_SHARED_MACHINE' });
  const r = agent(home(), shared);
  await r.a.restore();
  assert.equal(r.a.active, false);
  await r.a.flush();
  assert.equal(shared.writes.length, 0);
  assert.equal(r.fences.length, 0);
});

test('a conflict adopts the head and writes once more: this process is the only live writer', async () => {
  const dir = home();
  const s = server({ conflictOnce: 9 });
  const { a } = agent(dir, s);
  await a.restore();
  writeFileSync(join(dir, '.gitconfig'), 'x');
  await a.flush();
  assert.deepEqual(s.writes.map((w) => w.baseGeneration), [0, 9]);
  assert.equal(a.storedGeneration, 10);
});

test('no link is followed: a login file that is a symlink, or resolves elsewhere, is never read', () => {
  const dir = home();
  const outside = join(home(), 'machine-token');
  writeFileSync(outside, 'nmm_secret');
  mkdirSync(join(dir, '.config/gh'), { recursive: true });
  symlinkSync(outside, join(dir, '.config/gh/hosts.yml'));
  mkdirSync(join(dir, '.codex'), { recursive: true });
  writeFileSync(join(dir, '.codex/auth.json'), '{"ok":1}');
  const scan = scanHome(dir);
  assert.deepEqual(scan.files.map((f) => f.path), ['.codex/auth.json']);
  assert.ok(!scan.files.some((f) => Buffer.from(f.data, 'base64').toString().includes('nmm_')));
});

test('writeAbsent keeps a login made here, fills the empty .gitconfig in place, and ignores a path off the list', () => {
  const dir = home();
  mkdirSync(join(dir, '.codex'), { recursive: true });
  writeFileSync(join(dir, '.codex/auth.json'), 'local');
  writeFileSync(join(dir, '.gitconfig'), '');
  const ino = statSync(join(dir, '.gitconfig')).ino;
  const wrote = writeAbsent(dir, [
    { path: '.codex/auth.json', data: b64('vault') },
    { path: '.gitconfig', data: b64('[user]') },
    { path: '.ssh/id_ed25519' as unknown as VaultFile['path'], data: b64('key') },
  ]);
  assert.deepEqual(wrote, ['.gitconfig']);
  assert.equal(readFileSync(join(dir, '.codex/auth.json'), 'utf8'), 'local');
  assert.equal(readFileSync(join(dir, '.gitconfig'), 'utf8'), '[user]');
  assert.equal(statSync(join(dir, '.gitconfig')).ino, ino, 'the box binds this file: same inode');
  assert.equal(existsSync(join(dir, '.ssh')), false);
});

test('the fingerprint ignores order and sees content', () => {
  const x = { path: '.gitconfig' as const, data: b64('a') };
  const y = { path: '.codex/auth.json' as const, data: b64('b') };
  assert.equal(fingerprintOf([x, y]), fingerprintOf([y, x]));
  assert.notEqual(fingerprintOf([x]), fingerprintOf([{ ...x, data: b64('c') }]));
});

test('apiVaultChannel: 401 is a refused token, 409 STALE_EPOCH a fence, 409 VAULT_CONFLICT the head, 403 VAULT_SHARED_MACHINE a stop', async () => {
  const answers: Array<[number, Record<string, unknown>]> = [
    [200, { generation: 2, files: [{ path: '.gitconfig', data: b64('x') }] }],
    [403, { code: 'VAULT_SHARED_MACHINE', error: 'shared' }],
    [401, { code: 'AUTH_FAILED' }],
    [409, { code: 'STALE_EPOCH' }],
    [409, { code: 'VAULT_CONFLICT', generation: 6 }],
    [200, { generation: 7 }],
  ];
  const seen: Array<{ url: string; method: string; auth: string | undefined }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push({ url, method: init?.method ?? 'GET', auth: (init?.headers as Record<string, string>)['authorization'] });
    const [status, body] = answers.shift()!;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  const ch = apiVaultChannel({ apiUrl: 'https://api', headers: async () => ({ authorization: 'Bearer nmm_x' }), fetchImpl });
  assert.deepEqual(await ch.read(), { generation: 2, files: [{ path: '.gitconfig', data: b64('x') }] });
  assert.deepEqual(await ch.read(), { refused: 'VAULT_SHARED_MACHINE', error: 'shared' });
  await assert.rejects(ch.read(), MachineTokenRejected);
  const w: VaultWrite = { epoch: 3, baseGeneration: 5, files: [] };
  await assert.rejects(ch.write(w), EpochFencedError);
  assert.deepEqual(await ch.write(w), { conflict: 6 });
  assert.deepEqual(await ch.write(w), { generation: 7 });
  assert.deepEqual(seen[0], { url: 'https://api/v1/machines/vault', method: 'GET', auth: 'Bearer nmm_x' });
  assert.equal(seen[3]!.method, 'PUT');
});
