import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { BoxProcess, SpawnRequest } from './runtime-box';
import { encodeFrame, FRAME, FrameDecoder, MAX_FRAME, parseHello, RelayServer, relayWrapperSource, TICKET_IDLE_MS, TICKET_MAX_MS, Tickets, writeRelayWrappers, type RelaySpawner } from './runtime-relay';
import { RELAY_TICKET_ENV } from './runtime-state';

// ── framing ──

test('frames survive being split at every byte, and back to back', () => {
  const frames = [encodeFrame(FRAME.HELLO, '{"v":1}'), encodeFrame(FRAME.STDIN, Buffer.from([0, 1, 2, 255])), encodeFrame(FRAME.STDIN_END), encodeFrame(FRAME.SIGNAL, 'SIGTERM')];
  const all = Buffer.concat(frames);
  for (let cut = 0; cut <= all.length; cut++) {
    const d = new FrameDecoder();
    const got = [...d.push(all.subarray(0, cut)), ...d.push(all.subarray(cut))];
    assert.deepEqual(got.map((f) => f.type), [FRAME.HELLO, FRAME.STDIN, FRAME.STDIN_END, FRAME.SIGNAL]);
    assert.deepEqual([...got[1]!.payload], [0, 1, 2, 255]);
    assert.equal(got[3]!.payload.toString(), 'SIGTERM');
    assert.equal(d.pending, 0);
  }
});

test('a frame header announcing more than the limit is refused before anything is buffered', () => {
  const head = Buffer.alloc(5);
  head.writeUInt8(FRAME.STDOUT, 0);
  head.writeUInt32BE(MAX_FRAME + 1, 1);
  assert.throws(() => new FrameDecoder().push(head), /over the limit/);
  assert.throws(() => encodeFrame(FRAME.STDOUT, Buffer.alloc(MAX_FRAME + 1)), /over the limit/);
});

test('parseHello: the shape the wrapper sends, and nothing else', () => {
  const ok = { v: 1, ticket: 't', target: 'codex', argv: ['exec'], cwd: '/nm/work', env: { A: 'b' } };
  assert.deepEqual(parseHello(Buffer.from(JSON.stringify(ok))), ok);
  const bad = (o: unknown, re: RegExp): void => assert.throws(() => parseHello(Buffer.from(JSON.stringify(o))), re);
  bad({ ...ok, v: 2 }, /stale/);
  bad({ ...ok, ticket: '' }, /ticket/);
  bad({ ...ok, target: 'bash' }, /no "bash"/);
  bad({ ...ok, argv: [1] }, /argv/);
  bad({ ...ok, cwd: 'rel' }, /cwd/);
  bad({ ...ok, env: { A: 1 } }, /env/);
  assert.throws(() => parseHello(Buffer.from('{')), /not JSON/);
});

test('tickets: renewed by use, gone when idle or too old, and revocable', () => {
  let now = 0;
  const t = new Tickets(() => now);
  const a = t.mint();
  assert.match(a, /^[0-9a-f]{48}$/);
  assert.ok(t.redeem(a));
  now += TICKET_IDLE_MS - 1;
  assert.ok(t.redeem(a), 'a second spawn from the same env (codex model fallback) still works');
  now += TICKET_IDLE_MS + 1;
  assert.ok(!t.redeem(a), 'idle too long');
  const b = t.mint();
  for (let i = 0; i < 2 * Math.ceil(TICKET_MAX_MS / TICKET_IDLE_MS) + 2; i++) { now += TICKET_IDLE_MS / 2; t.redeem(b); }
  assert.ok(now > TICKET_MAX_MS && !t.redeem(b), 'no ticket outlives the cap');
  const c = t.mint();
  t.revoke(c);
  assert.ok(!t.redeem(c));
  assert.ok(!t.redeem('nope'));
});

// ── the wrapper ──

test('the wrapper source starts no process and names no sandbox (invariant 4)', () => {
  const src = relayWrapperSource({ node: '/usr/local/bin/node', port: 4567, target: 'claude' });
  assert.ok(src.startsWith('#!/usr/local/bin/node\n'));
  assert.ok(!/child_process|\bspawn\b|\bexecFile\b|execSync|\bfork\(|sandbox/.test(src), 'no way to start a process');
  assert.match(src, /const PORT = 4567;/);
  assert.match(src, /host: '127\.0\.0\.1'/);
  assert.throws(() => relayWrapperSource({ node: 'node; rm -rf /', port: 1, target: 'claude' }));
  assert.throws(() => relayWrapperSource({ node: '/n', port: 0, target: 'claude' }));
  assert.throws(() => relayWrapperSource({ node: '/n', port: 1, target: 'bash' as 'claude' }));
});

test('writeRelayWrappers: one executable file per target, owner-only', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'nm-boxbin-')), 'box-bin');
  const w = writeRelayWrappers(dir, 4567, '/usr/local/bin/node');
  assert.deepEqual(Object.keys(w).sort(), ['agy', 'claude', 'codex']);
  for (const f of Object.values(w)) {
    assert.equal(statSync(f).mode & 0o777, 0o700);
    assert.match(readFileSync(f, 'utf8'), /^#!\/usr\/local\/bin\/node\n/);
  }
});

// ── end to end: a real wrapper process, a real relay, a fake box ──

interface Fake { proc: BoxProcess; stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kills: string[]; finish: (code: number | null, signal: string | null) => void }

function fakeProc(): Fake {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const kills: string[] = [];
  let exit: [number | null, string | null] | null = null;
  const waiters: Array<(c: number | null, s: string | null) => void> = [];
  const ended = (s: PassThrough): Promise<void> => new Promise((r) => { if (s.readableEnded) r(); else s.once('end', () => r()); });
  let finishing = false;
  const finish = (code: number | null, signal: string | null): void => {
    if (finishing) return;
    finishing = true;
    stdout.end(); stderr.end();
    void Promise.all([ended(stdout), ended(stderr)]).then(() => { exit = [code, signal]; for (const w of waiters.splice(0)) w(code, signal); });
  };
  const proc: BoxProcess = {
    stdin, stdout, stderr,
    kill: (s = 'SIGTERM') => { kills.push(s); finish(null, s); },
    onExit: (cb) => { if (exit) cb(...exit); else waiters.push(cb); },
  };
  return { proc, stdin, stdout, stderr, kills, finish };
}

function harness(make: (req: SpawnRequest) => Fake | Promise<Fake>): { spawner: RelaySpawner; requests: SpawnRequest[]; fakes: Fake[]; started: Promise<void> } {
  const requests: SpawnRequest[] = [];
  const fakes: Fake[] = [];
  let signal!: () => void;
  const started = new Promise<void>((r) => { signal = r; });
  return {
    requests, fakes, started,
    spawner: { spawn: async (req) => { requests.push(req); const f = await make(req); fakes.push(f); signal(); return f.proc; } },
  };
}

async function relayWith(spawner: RelaySpawner): Promise<{ relay: RelayServer; wrappers: Record<'claude' | 'codex' | 'agy', string>; dir: string }> {
  const relay = new RelayServer({ spawner, log: () => {} });
  const port = await relay.listen();
  const dir = mkdtempSync(join(tmpdir(), 'nm-relay-'));
  return { relay, wrappers: writeRelayWrappers(join(dir, 'bin'), port, process.execPath), dir };
}

function run(file: string, args: string[], env: Record<string, string>, cwd: string, stdin?: string | Buffer): { done: Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: Buffer; stderr: string }>; child: ReturnType<typeof spawn> } {
  const child = spawn(file, args, { env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', ...env }, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  const out: Buffer[] = [];
  let err = '';
  child.stdout!.on('data', (c: Buffer) => out.push(c));
  child.stderr!.on('data', (c: Buffer) => { err += c.toString(); });
  if (stdin !== undefined) child.stdin!.end(stdin);
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: Buffer; stderr: string }>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal, stdout: Buffer.concat(out), stderr: err }));
  });
  return { done, child };
}

test('relay e2e: argv, cwd and env arrive; stdin goes in, stdout/stderr come out, the exit code is the box process\'s', async () => {
  const h = harness(() => {
    const f = fakeProc();
    f.stdin.on('data', (c: Buffer) => f.stdout.write(c.toString().toUpperCase()));
    f.stdin.on('end', () => { f.stderr.write('from the box'); f.finish(3, null); });
    return f;
  });
  const { relay, wrappers, dir } = await relayWith(h.spawner);
  try {
    const ticket = relay.mintTicket();
    const r = await run(wrappers.codex, ['exec', 'two words', '--json'], { [RELAY_TICKET_ENV]: ticket, OPENAI_API_KEY: 'sk-test-abcdefghijkl' }, dir, 'hello\nworld\n').done;
    assert.equal(r.code, 3, r.stderr);
    assert.equal(r.stdout.toString(), 'HELLO\nWORLD\n');
    assert.equal(r.stderr, 'from the box');
    const req = h.requests[0]!;
    assert.equal(req.target, 'codex');
    assert.deepEqual(req.argv, ['exec', 'two words', '--json']);
    assert.equal(realpathSync(req.cwd), realpathSync(dir));
    assert.equal(req.env['OPENAI_API_KEY'], 'sk-test-abcdefghijkl');
    assert.equal(req.env[RELAY_TICKET_ENV], ticket, 'the spawner gets it, and its env allowlist drops it');
  } finally {
    await relay.close();
  }
});

test('relay e2e: an empty stdin (agy spawns with stdin ignored) reaches the box as EOF', async () => {
  const h = harness(() => {
    const f = fakeProc();
    f.stdin.resume();
    f.stdin.on('end', () => { f.stdout.write('done'); f.finish(0, null); });
    return f;
  });
  const { relay, wrappers, dir } = await relayWith(h.spawner);
  try {
    const child = spawn(wrappers.agy, ['--print', 'hi'], { env: { [RELAY_TICKET_ENV]: relay.mintTicket() }, cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout!.on('data', (c: Buffer) => { out += c.toString(); });
    const code = await new Promise<number | null>((r) => child.once('close', (c) => r(c)));
    assert.equal(code, 0);
    assert.equal(out, 'done');
  } finally {
    await relay.close();
  }
});

test('relay e2e: a bad ticket, or no ticket, never reaches the box', async () => {
  const h = harness(() => fakeProc());
  const { relay, wrappers, dir } = await relayWith(h.spawner);
  try {
    const bad = await run(wrappers.claude, [], { [RELAY_TICKET_ENV]: 'f'.repeat(48) }, dir, '').done;
    assert.equal(bad.code, 126);
    assert.match(bad.stderr, /unknown or expired/);
    const none = await run(wrappers.claude, [], {}, dir, '').done;
    assert.equal(none.code, 126);
    assert.match(none.stderr, /no relay ticket/);
    assert.equal(h.requests.length, 0);
  } finally {
    await relay.close();
  }
});

test('relay e2e: a spawn the box refuses comes back as 126 with the reason', async () => {
  const relay = new RelayServer({ spawner: { spawn: async () => { throw new Error('A sandbox argument looks like a credential.'); } }, log: () => {} });
  const port = await relay.listen();
  const dir = mkdtempSync(join(tmpdir(), 'nm-relay-'));
  const w = writeRelayWrappers(join(dir, 'bin'), port, process.execPath);
  try {
    const r = await run(w.claude, ['--print'], { [RELAY_TICKET_ENV]: relay.mintTicket() }, dir, '').done;
    assert.equal(r.code, 126);
    assert.match(r.stderr, /could not start claude: A sandbox argument looks like a credential/);
  } finally {
    await relay.close();
  }
});

test('relay e2e: SIGTERM to the wrapper signals the box process, and the wrapper dies of that signal', async () => {
  const h = harness(() => { const f = fakeProc(); f.stdin.resume(); return f; });
  const { relay, wrappers, dir } = await relayWith(h.spawner);
  const { done, child } = run(wrappers.claude, ['--output-format', 'stream-json'], { [RELAY_TICKET_ENV]: relay.mintTicket() }, dir);
  try {
    await h.started;
    child.kill('SIGTERM');
    const r = await done;
    assert.deepEqual(h.fakes[0]!.kills, ['SIGTERM']);
    assert.equal(r.signal, 'SIGTERM', `code ${r.code} ${r.stderr}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); // never leave a child holding the run open
    await relay.close();
  }
});

test('relay e2e: a wrapper killed outright (SIGKILL) takes its box process with it', async () => {
  const h = harness(() => { const f = fakeProc(); f.stdin.resume(); return f; });
  const { relay, wrappers, dir } = await relayWith(h.spawner);
  const { done, child } = run(wrappers.codex, ['exec'], { [RELAY_TICKET_ENV]: relay.mintTicket() }, dir);
  try {
    await h.started;
    child.kill('SIGKILL');
    await done;
    for (let i = 0; i < 50 && !h.fakes[0]!.kills.length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(h.fakes[0]!.kills, ['SIGTERM']);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await relay.close();
  }
});

test('relay e2e: 8 MiB of output arrive whole through the backpressure', async () => {
  const size = 8 * 1024 * 1024;
  const h = harness(() => {
    const f = fakeProc();
    f.stdin.resume();
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    let sent = 0;
    const pump = (): void => {
      while (sent < size) {
        sent += chunk.length;
        if (!f.stdout.write(chunk)) { f.stdout.once('drain', pump); return; }
      }
      f.finish(0, null);
    };
    setImmediate(pump);
    return f;
  });
  const { relay, wrappers, dir } = await relayWith(h.spawner);
  try {
    const r = await run(wrappers.claude, [], { [RELAY_TICKET_ENV]: relay.mintTicket() }, dir, '').done;
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.length, size);
    assert.ok(r.stdout.every((b) => b === 0x61));
  } finally {
    await relay.close();
  }
});

test('relay: a connection that never says hello is closed with a reason', async () => {
  const relay = new RelayServer({ spawner: { spawn: async () => fakeProc().proc }, log: () => {}, helloTimeoutMs: 30 });
  const port = await relay.listen();
  try {
    const frames = await new Promise<Array<{ type: number; payload: Buffer }>>((resolve, reject) => {
      const d = new FrameDecoder();
      const got: Array<{ type: number; payload: Buffer }> = [];
      const s = connect(port, '127.0.0.1');
      s.on('data', (c: Buffer) => got.push(...d.push(c)));
      s.on('close', () => resolve(got));
      s.on('error', reject);
    });
    assert.deepEqual(frames.map((f) => f.type), [FRAME.FAIL, FRAME.EXIT]);
    assert.match(frames[0]!.payload.toString(), /no hello/);
    assert.deepEqual(JSON.parse(frames[1]!.payload.toString()), { code: 126, signal: null });
  } finally {
    await relay.close();
  }
});
