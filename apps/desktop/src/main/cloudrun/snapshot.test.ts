import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as zlib from 'node:zlib';
import { apiSnapshotSigner, CHUNK, chunkPlan, EpochFencedError, lockfileKey, lockKeyOf, MachineTokenRejected, QUANTUM, ResumableSink, Snapshots, TAR_MIN_BYTES, type SnapshotSigner } from './snapshot';

interface Put { range: string; bytes: number }

function fakeSession(statusFor: (range: string) => number = (r) => (r.endsWith('/*') ? 308 : 200)) {
  const puts: Put[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    const range = headers['content-range']!;
    const body = init?.body as Uint8Array;
    puts.push({ range, bytes: body.length });
    return new Response(null, { status: statusFor(range) });
  }) as typeof fetch;
  return { puts, fetchImpl };
}

test('the chunk is 32 MiB, a multiple of the 256 KiB quantum', () => {
  assert.equal(QUANTUM, 262144);
  assert.equal(CHUNK, 33554432);
  assert.equal(CHUNK % QUANTUM, 0);
});

test('chunkPlan: a middle chunk rounds down to the quantum with an open total', () => {
  assert.deepEqual(chunkPlan(CHUNK + 1000, 0, false), { sendLen: CHUNK, range: 'bytes 0-33554431/*' });
  assert.deepEqual(chunkPlan(QUANTUM * 3 + 7, CHUNK, false), { sendLen: QUANTUM * 3, range: `bytes ${CHUNK}-${CHUNK + QUANTUM * 3 - 1}/*` });
  for (const pending of [QUANTUM, QUANTUM + 1, CHUNK - 1, CHUNK * 2 + 12345]) assert.equal(chunkPlan(pending, 0, false).sendLen % QUANTUM, 0);
});

test('chunkPlan: the final chunk sends the rest and names the total', () => {
  assert.deepEqual(chunkPlan(1000, CHUNK, true), { sendLen: 1000, range: `bytes ${CHUNK}-${CHUNK + 999}/${CHUNK + 1000}` });
  // nothing left over: an empty final PUT closes the object at its size
  assert.deepEqual(chunkPlan(0, CHUNK, true), { sendLen: 0, range: `bytes */${CHUNK}` });
});

test('ResumableSink: one large write sends whole quanta, then the tail with the total', async () => {
  const { puts, fetchImpl } = fakeSession();
  await pipeline(Readable.from([Buffer.alloc(QUANTUM * 2.5)]), new ResumableSink('https://gcs/session', fetchImpl, QUANTUM));
  assert.deepEqual(puts, [
    { range: 'bytes 0-524287/*', bytes: 524288 },
    { range: 'bytes 524288-655359/655360', bytes: 131072 },
  ]);
});

test('ResumableSink: small writes buffer until a chunk, and an exact multiple ends with an empty PUT', async () => {
  const small = fakeSession();
  await pipeline(Readable.from([Buffer.alloc(102400), Buffer.alloc(102400), Buffer.alloc(102400)]), new ResumableSink('u', small.fetchImpl, QUANTUM));
  assert.deepEqual(small.puts, [{ range: 'bytes 0-262143/*', bytes: 262144 }, { range: 'bytes 262144-307199/307200', bytes: 45056 }]);
  const exact = fakeSession();
  await pipeline(Readable.from([Buffer.alloc(QUANTUM * 2)]), new ResumableSink('u', exact.fetchImpl, QUANTUM));
  assert.deepEqual(exact.puts, [{ range: 'bytes 0-524287/*', bytes: 524288 }, { range: 'bytes */524288', bytes: 0 }]);
});

test('ResumableSink: a middle chunk not answered 308 fails the upload', async () => {
  const { fetchImpl } = fakeSession(() => 500);
  await assert.rejects(pipeline(Readable.from([Buffer.alloc(QUANTUM * 2)]), new ResumableSink('u', fetchImpl, QUANTUM)), /HTTP 500/);
  assert.throws(() => new ResumableSink('u', fetchImpl, QUANTUM + 1), /256 KiB/);
});

test('lockKeyOf: sha256 prefix plus platform, arch and node major', () => {
  assert.equal(lockKeyOf('abc', 'linux', 'x64', '24.1.0'), 'ba7816bf8f01cfea414140de5dae2223b00361a3-linux-x64-node24');
});

test('lockfileKey: pnpm-lock wins over package-lock; no lockfile is an error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-lock-'));
  assert.throws(() => lockfileKey(dir), /no lockfile/);
  writeFileSync(join(dir, 'package-lock.json'), 'npm');
  assert.equal(lockfileKey(dir), lockKeyOf('npm'));
  writeFileSync(join(dir, 'pnpm-lock.yaml'), 'pnpm');
  assert.equal(lockfileKey(dir), lockKeyOf('pnpm'));
});

test('apiSnapshotSigner: the machine bearer, the epoch on every request, 404 is absent, 409 is fenced', async () => {
  const seen: Array<{ url: string; body: unknown; auth: string | undefined }> = [];
  const answers = [new Response(JSON.stringify({ url: 'https://signed', object: 'machines/m1/snapshots/work-e3.tar.zst' }), { status: 200 }), new Response('{}', { status: 404 }), new Response('{}', { status: 409 })];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: (init?.headers as Record<string, string>)['authorization'] });
    return answers.shift()!;
  }) as typeof fetch;
  const signer = apiSnapshotSigner({ apiUrl: 'https://api.test', headers: async () => ({ authorization: 'Bearer nmm_x' }), epoch: () => 3, fetchImpl });
  assert.deepEqual(await signer.sign('snapshot', 'work-e3', 'upload'), { url: 'https://signed', object: 'machines/m1/snapshots/work-e3.tar.zst' });
  assert.deepEqual(seen[0], { url: 'https://api.test/v1/machines/snapshots/sign', body: { kind: 'snapshot', key: 'work-e3', op: 'upload', epoch: 3 }, auth: 'Bearer nmm_x' });
  assert.equal(await signer.sign('snapshot', 'box-e3', 'download'), null);
  await assert.rejects(signer.sign('snapshot', 'work-e3', 'upload'), EpochFencedError);
  await assert.rejects(signer.sign('snapshot', '../escape', 'upload'), /not valid/);
  assert.equal(seen.length, 3);
});

const hasZstd = typeof (zlib as unknown as { createZstdCompress?: unknown }).createZstdCompress === 'function';

test('Snapshots: upload then download round-trips through zstd and the resumable session', { skip: !hasZstd }, async () => {
  const stored: Buffer[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u === 'https://signed/up' && init?.method === 'POST') return new Response(null, { status: 201, headers: { location: 'https://session' } });
    if (u === 'https://session') { stored.push(Buffer.from(init?.body as Uint8Array)); return new Response(null, { status: (init?.headers as Record<string, string>)['content-range']!.endsWith('/*') ? 308 : 200 }); }
    if (u === 'https://signed/down') return new Response(new Uint8Array(Buffer.concat(stored)), { status: 200 });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const signer: SnapshotSigner = { sign: async (_k, _key, op) => ({ url: op === 'upload' ? 'https://signed/up' : 'https://signed/down', object: 'o' }) };
  const snaps = new Snapshots({ signer, fetchImpl });
  const data = Buffer.from('neuramesh '.repeat(100_000));
  const up = await snaps.upload('snapshot', 'work-e1', Readable.from([data]));
  assert.equal(up.rawBytes, data.length);
  assert.ok(up.zBytes < data.length / 10, 'zstd compresses repeated text');
  const got: Buffer[] = [];
  const down = await snaps.download('snapshot', 'work-e1', new Writable({ write(chunk: Buffer, _e, cb) { got.push(chunk); cb(); } }));
  assert.equal(down?.rawBytes, data.length);
  assert.ok(Buffer.concat(got).equals(data));
});

test('Snapshots.download: an absent object is null, not an error', async () => {
  const snaps = new Snapshots({ signer: { sign: async () => null }, fetchImpl: (async () => { throw new Error('no fetch expected'); }) as typeof fetch });
  assert.equal(await snaps.download('snapshot', 'work-e1', new Writable({ write(_c, _e, cb) { cb(); } })), null);
});

test('apiSnapshotSigner: a 401 is a rejected token, not a fence', async () => {
  const fetchImpl = (async () => new Response('', { status: 401 })) as typeof fetch;
  const signer = apiSnapshotSigner({ apiUrl: 'https://api.test', headers: async () => ({}), epoch: () => 3, fetchImpl });
  await assert.rejects(signer.sign('snapshot', 'work-e3', 'upload'), MachineTokenRejected);
});

// ── The e2e run's empty snapshot (README.md, "Snapshots"): real tar, real zstd, a slow signer ─────

/** a GCS stand-in: a signed resumable start, a session that keeps every PUT, a signed GET */
function fakeGcs(signDelayMs = 0) {
  const stored: Buffer[] = [];
  const finals: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u === 'https://signed/up' && init?.method === 'POST') return new Response(null, { status: 201, headers: { location: 'https://session' } });
    if (u === 'https://session') {
      const range = (init?.headers as Record<string, string>)['content-range']!;
      stored.push(Buffer.from(init?.body as Uint8Array));
      if (!range.endsWith('/*')) finals.push(range);
      return new Response(null, { status: range.endsWith('/*') ? 308 : 200 });
    }
    if (u === 'https://signed/down') return new Response(new Uint8Array(Buffer.concat(stored)), { status: 200 });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const signer: SnapshotSigner = {
    sign: async (_k, _key, op) => {
      await new Promise((r) => setTimeout(r, signDelayMs));
      return { url: op === 'upload' ? 'https://signed/up' : 'https://signed/down', object: 'o' };
    },
  };
  return { stored, finals, fetchImpl, signer };
}

/** a tar child that writes `out` and exits `code` once its stdout is read (the short-archive cases) */
function fakeTar(out: Buffer, code: number): ChildProcess {
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdout, stderr: new PassThrough(), stdin: null, kill: () => true });
  stdout.once('end', () => setImmediate(() => child.emit('close', code)));
  setImmediate(() => stdout.end(out));
  return child as unknown as ChildProcess;
}

test('node drains the unread stdout of a child that exits: why save() opens the session before tar spawns', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nm-flush-'));
  writeFileSync(join(root, 'f.txt'), 'x');
  const tar = spawn('tar', ['-C', root, '-cf', '-', 'f.txt'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((r) => tar.once('exit', r));
  await new Promise((r) => setTimeout(r, 100));
  let late = 0;
  tar.stdout.on('data', (d: Buffer) => { late += d.length; });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(late, 0, 'a reader that attaches after the exit gets nothing: the bytes went to a resumed stream with no listener');
});

test('save: a tree small enough to tar during the signer await still uploads every byte, and restores', { skip: !hasZstd }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'nm-save-'));
  mkdirSync(join(root, 'work'));
  writeFileSync(join(root, 'work', 'witness.txt'), 'nonce-123\n');
  // 300 ms of signing: long enough for tar of one small file to finish and exit before the old
  // code piped its stdout, which then uploaded a 9-byte empty zstd frame as the work snapshot
  const gcs = fakeGcs(300);
  const snaps = new Snapshots({ signer: gcs.signer, fetchImpl: gcs.fetchImpl });
  const up = await snaps.save('snapshot', 'work-e1', root, ['work']);
  assert.ok(up.rawBytes >= 10240, `a real tar archive is at least 10 KiB, got ${up.rawBytes}`);
  assert.ok(Buffer.concat(gcs.stored).length > 9, 'more than an empty zstd frame reached the session');
  const dest = mkdtempSync(join(tmpdir(), 'nm-restore-'));
  const down = await snaps.restore('snapshot', 'work-e1', dest);
  assert.equal(down?.rawBytes, up.rawBytes);
  assert.equal(readFileSync(join(dest, 'work', 'witness.txt'), 'utf8'), 'nonce-123\n');
});

test('save: fewer bytes than a tar archive fail the save, so no drain reports them as the state', { skip: !hasZstd }, async () => {
  const gcs = fakeGcs();
  const snaps = new Snapshots({ signer: gcs.signer, fetchImpl: gcs.fetchImpl, spawnTar: () => fakeTar(Buffer.alloc(0), 0) });
  await assert.rejects(snaps.save('snapshot', 'work-e1', '/nm', ['work']), new RegExp(`at least ${TAR_MIN_BYTES}`));
  const short = new Snapshots({ signer: gcs.signer, fetchImpl: gcs.fetchImpl, spawnTar: () => fakeTar(Buffer.from('tiny'), 0) });
  await assert.rejects(short.save('snapshot', 'work-e1', '/nm', ['work']), /gave 4 bytes/);
});

test('save: a tar that exits non-zero fails the save', { skip: !hasZstd }, async () => {
  const gcs = fakeGcs();
  const snaps = new Snapshots({ signer: gcs.signer, fetchImpl: gcs.fetchImpl, spawnTar: () => fakeTar(Buffer.alloc(TAR_MIN_BYTES * 10), 2) });
  await assert.rejects(snaps.save('snapshot', 'work-e1', '/nm', ['work']), /tar -c exited 2/);
});

test('restore: the empty frame the e2e run stored is an error in tar\'s words, not a crash', { skip: !hasZstd }, async () => {
  const empty = (zlib as unknown as { zstdCompressSync: (b: Buffer) => Buffer }).zstdCompressSync(Buffer.alloc(0));
  assert.ok(empty.length <= 13, `an empty zstd frame is a few bytes (the bad object was 9), got ${empty.length}`);
  const fetchImpl = (async () => new Response(new Uint8Array(empty), { status: 200 })) as typeof fetch;
  const snaps = new Snapshots({ signer: { sign: async () => ({ url: 'https://signed/down', object: 'o' }) }, fetchImpl });
  await assert.rejects(snaps.restore('snapshot', 'work-e1', mkdtempSync(join(tmpdir(), 'nm-bad-'))), /tar -x exited|does not look like a tar archive|at least 1024/);
});

test('apiSnapshotSigner.list: op list with the prefix and the epoch; odd keys are dropped; a 401 is a rejected token', async () => {
  const seen: unknown[] = [];
  const answers = [
    new Response(JSON.stringify({ keys: [{ key: 'work-e2', size: 5120 }, { key: '../x', size: 1 }, { key: 'box-e2', size: '77' }] }), { status: 200 }),
    new Response('', { status: 401 }),
  ];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => { seen.push(JSON.parse(String(init?.body))); return answers.shift()!; }) as typeof fetch;
  const signer = apiSnapshotSigner({ apiUrl: 'https://api.test', headers: async () => ({}), epoch: () => 5, fetchImpl });
  assert.deepEqual(await signer.list!('snapshot', ''), [{ key: 'work-e2', size: 5120 }, { key: 'box-e2', size: 77 }]);
  assert.deepEqual(seen[0], { kind: 'snapshot', prefix: '', op: 'list', epoch: 5 });
  await assert.rejects(signer.list!('snapshot', 'work-e'), MachineTokenRejected);
  await assert.rejects(signer.list!('snapshot', '../'), /not valid/);
});
