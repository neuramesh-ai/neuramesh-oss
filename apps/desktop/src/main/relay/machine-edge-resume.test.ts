// SESSIONS OUTLIVE SOCKETS (the session round, 2026-10; RESUME in @neuramesh/relay protocol.ts). On
// Cloud Run every relay socket ends, and a terminal or a Code session no longer ends with it. Against
// a relay stand-in: a socket that drops keeps its sessions and the redial takes them back with an exact
// replay and no new shell; a detached session ends when its grace runs out; a resume is the owner's
// alone; a buffer that overflowed says how much it dropped; a Code session resumes on a whole event,
// and the same thread opened again takes over the session its old channel left; the relay's word after
// a takeover reattaches a detached session; a detached session gives up its slot to a new one; and
// before the cut the edge rotates its own socket, with nothing detached.
// Run: pnpm exec tsx --test src/main/relay/machine-edge-resume.test.ts
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { connectMachineEdge, MAX_TERMINAL_SESSIONS_PER_ACTOR, RESUME_GONE_TERMINAL, RESUME_NOT_YOURS, type PtyLike, type SpawnPty } from './machine-edge';
import { ResumeBuffer } from './resume-buffer';
import type { EngineeringMachineHost } from './engineering-host';

const brain = mkdtempSync(join(tmpdir(), 'nm-edge-resume-'));
process.env['NM_BRAIN'] = brain;
after(() => rmSync(brain, { recursive: true, force: true }));

async function until(cond: () => boolean, what: string, ms = 6000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Frame { ch?: string; t: string; d?: string; o?: number; dropped?: number; reason?: string; [k: string]: unknown }
interface Leg { sock: WsSocket; frames: Frame[]; hello: Frame | null }

/** a relay stand-in that takes every socket: the newest hello is the current leg, and (as the hub does)
 *  its hello closes the older leg with 4409 unless `takeover` is false */
async function relay(opts: { takeover?: boolean } = {}) {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  const state = {
    url: '',
    legs: [] as Leg[],
    current: null as Leg | null,
    send: (f: Frame, leg?: Leg): void => { (leg ?? state.current)?.sock.send(JSON.stringify(f)); },
    close: (): void => { for (const l of state.legs) l.sock.terminate(); wss.close(); server.close(); },
  };
  wss.on('connection', (sock: WsSocket) => {
    const leg: Leg = { sock, frames: [], hello: null };
    state.legs.push(leg);
    sock.on('message', (raw) => {
      const f = JSON.parse(raw.toString()) as Frame;
      if (f.t !== 'hello') { leg.frames.push(f); return; }
      leg.hello = f;
      const prev = state.current;
      if (prev && opts.takeover === false) return;
      state.current = leg;
      if (prev && prev !== leg && prev.sock.readyState === prev.sock.OPEN) prev.sock.close(4409, 'replaced by a newer connection');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  state.url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  return state;
}

/** shells that print a prompt, then whatever the test makes them print: the CI install builds no node-pty */
function fakePtys() {
  const started: Array<{ out(d: string): void; written: string[]; killed: boolean }> = [];
  const spawn: SpawnPty = () => {
    let data: (d: string) => void = () => {};
    let exit: () => void = () => {};
    const rec = { out: (d: string) => data(d), written: [] as string[], killed: false };
    started.push(rec);
    const pty: PtyLike = {
      onData: (cb) => { data = cb; setTimeout(() => cb('nm $ '), 0); },
      onExit: (cb) => { exit = cb; },
      write: (d) => { rec.written.push(d); },
      resize: () => {},
      kill: () => { if (rec.killed) return; rec.killed = true; setTimeout(() => exit(), 0); },
    };
    return pty;
  };
  return { spawn, started };
}

const on = (frames: Frame[], ch: string): Frame[] => frames.filter((f) => f.ch === ch);
const bytesOf = (frames: Frame[], ch: string): Buffer => Buffer.concat(on(frames, ch).filter((f) => f.t === 'data').map((f) => Buffer.from(f.d ?? '', 'base64')));
const textOf = (frames: Frame[], ch: string): string => bytesOf(frames, ch).toString('utf8');
const b64 = (s: string): string => Buffer.from(s).toString('base64');
const META = {
  threadId: 'th1', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'act',
  permissions: { read: true, edit: true, command: true, web: true, mcp: true }, policy: { read: true, edit: true, command: true, web: true, mcp: true },
};

test('ResumeBuffer keeps the newest bytes by their offset, reads from any offset it holds, and finds a whole line', () => {
  const b = new ResumeBuffer(8);
  b.push(Buffer.from('ab\n'));
  b.push(Buffer.from('cdefgh'));
  assert.equal(b.start, 1);
  assert.equal(b.end, 9);
  assert.equal(Buffer.concat(b.read(0, 4).map((p) => p.bytes)).toString(), 'b\ncdefgh', 'a read before the start begins at the start');
  assert.deepEqual(b.read(5, 2).map((p) => [p.at, p.bytes.toString()]), [[5, 'ef'], [7, 'gh']]);
  assert.equal(b.lineStart(), 3, 'the first byte after a newline');
  b.push(Buffer.from('ij'));
  assert.equal(b.start, 3);
  assert.equal(b.lineStart(), 3, 'the front was cut right after a newline');
  b.push(Buffer.from('k'));
  assert.equal(b.lineStart(), b.end, 'no whole line begins in what is held');
});

test('a socket that drops keeps its sessions: the redial takes them back with an exact replay and no new shell', async () => {
  const r = await relay();
  const ptys = fakePtys();
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', spawnPty: ptys.spawn, log: () => {} });
  try {
    await until(() => r.current?.hello !== null && r.current !== null, 'the hello');
    assert.ok((r.current!.hello!['lanes'] as string[]).includes('resume'), 'the hello names the resume capability');
    r.send({ ch: 'c1', t: 'open', cols: 80, rows: 24, actorId: 'u1' });
    await until(() => textOf(r.legs[0]!.frames, 'c1') === 'nm $ ', 'the first prompt');
    assert.equal(on(r.legs[0]!.frames, 'c1')[0]!.o, 0, 'every byte carries its offset');

    r.legs[0]!.sock.terminate(); // the cut
    await until(() => edge.detachedCount() === 1, 'the session detached');
    assert.equal(edge.sessionCount(), 0, 'a detached session is nobody\'s work');
    ptys.started[0]!.out('AFTER');
    await until(() => r.legs.length === 2 && r.legs[1]!.hello !== null, 'the redial');
    assert.equal(ptys.started[0]!.killed, false, 'the shell lives on');

    r.send({ ch: 'c1', t: 'open', cols: 80, rows: 24, resume: true, from: 5, actorId: 'u1' });
    await until(() => textOf(r.legs[1]!.frames, 'c1') === 'AFTER', 'the replay');
    assert.deepEqual(on(r.legs[1]!.frames, 'c1')[0], { ch: 'c1', t: 'resumed', o: 5, dropped: 0, from: 5 }, 'the answer repeats the resume it answers');
    assert.equal(on(r.legs[1]!.frames, 'c1')[1]!.o, 5);
    assert.equal(ptys.started.length, 1, 'a resume never spawns');
    assert.equal(edge.sessionCount(), 1);
    assert.equal(edge.detachedCount(), 0);
    r.send({ ch: 'c1', t: 'data', d: b64('ls\r') });
    await until(() => ptys.started[0]!.written.includes('ls\r'), 'the keystroke reaches the same shell');
  } finally { edge.close(); r.close(); }
});

test('a detached session nobody takes back ends when its grace runs out, and a late resume hears why', async () => {
  const r = await relay();
  const ptys = fakePtys();
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', spawnPty: ptys.spawn, resumeGraceMs: 150, log: () => {} });
  try {
    await until(() => r.current?.hello != null, 'the hello');
    r.send({ ch: 'c1', t: 'open', cols: 80, rows: 24, actorId: 'u1' });
    await until(() => textOf(r.legs[0]!.frames, 'c1') === 'nm $ ', 'the first prompt');
    r.send({ ch: 'c1', t: 'detach' });
    await until(() => edge.detachedCount() === 1, 'detached');
    await until(() => ptys.started[0]!.killed, 'the grace ran out');
    assert.equal(edge.detachedCount(), 0);
    r.send({ ch: 'c1', t: 'open', resume: true, from: 5, actorId: 'u1' });
    await until(() => on(r.legs[0]!.frames, 'c1').some((f) => f.t === 'close'), 'the answer');
    assert.equal(on(r.legs[0]!.frames, 'c1').find((f) => f.t === 'close')!.reason, RESUME_GONE_TERMINAL);
  } finally { edge.close(); r.close(); }
});

test('a resume is the owner\'s alone', async () => {
  const r = await relay();
  const ptys = fakePtys();
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', spawnPty: ptys.spawn, log: () => {} });
  try {
    await until(() => r.current?.hello != null, 'the hello');
    r.send({ ch: 'c1', t: 'open', cols: 80, rows: 24, actorId: 'u1' });
    await until(() => textOf(r.legs[0]!.frames, 'c1') === 'nm $ ', 'the first prompt');
    r.send({ ch: 'c1', t: 'detach' });
    r.send({ ch: 'c1', t: 'open', resume: true, from: 0, actorId: 'u2' });
    await until(() => on(r.legs[0]!.frames, 'c1').some((f) => f.t === 'close'), 'the refusal');
    assert.equal(on(r.legs[0]!.frames, 'c1').find((f) => f.t === 'close')!.reason, RESUME_NOT_YOURS);
    assert.equal(edge.detachedCount(), 1, 'the session still waits for its owner');
    r.send({ ch: 'c1', t: 'open', resume: true, from: 5, actorId: 'u1' });
    await until(() => on(r.legs[0]!.frames, 'c1').some((f) => f.t === 'resumed'), 'the owner takes it back');
  } finally { edge.close(); r.close(); }
});

test('a buffer that overflowed while nobody listened says how much it dropped, and replays the rest exactly', async () => {
  const r = await relay();
  const ptys = fakePtys();
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', spawnPty: ptys.spawn, resumeBufferBytes: 4096, log: () => {} });
  try {
    await until(() => r.current?.hello != null, 'the hello');
    r.send({ ch: 'c1', t: 'open', cols: 80, rows: 24, actorId: 'u1' });
    await until(() => textOf(r.legs[0]!.frames, 'c1') === 'nm $ ', 'the first prompt');
    r.send({ ch: 'c1', t: 'detach' });
    await until(() => edge.detachedCount() === 1, 'detached');
    const flood = Array.from({ length: 10_000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
    ptys.started[0]!.out(flood);
    const before = r.legs[0]!.frames.length;
    r.send({ ch: 'c1', t: 'open', resume: true, from: 5, actorId: 'u1' });
    await until(() => bytesOf(r.legs[0]!.frames.slice(before), 'c1').length === 4096, 'the replay of what was kept');
    const replay = r.legs[0]!.frames.slice(before);
    assert.deepEqual(on(replay, 'c1')[0], { ch: 'c1', t: 'resumed', o: 10_005 - 4096, dropped: 10_005 - 4096 - 5, from: 5 });
    assert.equal(textOf(replay, 'c1'), flood.slice(-4096));
  } finally { edge.close(); r.close(); }
});

test('a Code session resumes too; the same thread opened again takes over a detached session, never an attached one', async () => {
  const r = await relay();
  const hosts: Array<{ emit(e: Record<string, unknown>): void; commands: unknown[]; closed: boolean }> = [];
  const engineering: EngineeringMachineHost = {
    open: async (_meta, emit) => {
      const h = { emit: (e: Record<string, unknown>) => emit(e as never), commands: [] as unknown[], closed: false };
      hosts.push(h);
      return { command: (v) => { h.commands.push(v); }, close: () => { h.closed = true; } };
    },
  };
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', spawnPty: fakePtys().spawn, engineering, log: () => {} });
  const lines = (frames: Frame[], ch: string): Array<Record<string, unknown>> =>
    textOf(frames, ch).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  try {
    await until(() => r.current?.hello != null, 'the hello');
    r.send({ ch: 'e1', t: 'open', lane: 'engineering', actorId: 'u1', meta: META });
    await until(() => hosts.length === 1, 'the Code session');
    hosts[0]!.emit({ type: 'status', status: 'one' });
    await until(() => lines(r.legs[0]!.frames, 'e1').length === 1, 'the first event');
    const had = bytesOf(r.legs[0]!.frames, 'e1').length;
    r.send({ ch: 'e1', t: 'detach' });
    await until(() => edge.detachedCount() === 1, 'detached');
    hosts[0]!.emit({ type: 'status', status: 'two' });
    await sleep(30);
    assert.equal(lines(r.legs[0]!.frames, 'e1').length, 1, 'nothing goes out while detached');
    r.send({ ch: 'e1', t: 'open', lane: 'engineering', resume: true, from: had, actorId: 'u1', meta: META });
    await until(() => lines(r.legs[0]!.frames, 'e1').length === 2, 'the replayed event');
    assert.deepEqual(lines(r.legs[0]!.frames, 'e1')[1], { type: 'status', status: 'two' });
    assert.equal(hosts.length, 1, 'a resume opens no second host session');
    r.send({ ch: 'e1', t: 'data', d: b64(JSON.stringify({ type: 'prompt', prompt: 'hi' })) });
    await until(() => hosts[0]!.commands.length === 1, 'the command reaches the same session');

    // a reload: the old channel detaches and the thread opens on a new channel
    r.send({ ch: 'e1', t: 'detach' });
    await until(() => edge.detachedCount() === 1, 'detached again');
    r.send({ ch: 'e2', t: 'open', lane: 'engineering', actorId: 'u1', meta: META });
    await until(() => hosts.length === 2, 'the new channel\'s session');
    assert.equal(hosts[0]!.closed, true, 'the detached session gave up its thread');
    assert.ok(!lines(r.legs[0]!.frames, 'e2').some((e) => e['code'] === 'SESSION_ACTIVE'));
    // a second tab on the same thread while e2 is attached is still refused
    r.send({ ch: 'e3', t: 'open', lane: 'engineering', actorId: 'u1', meta: META });
    await until(() => on(r.legs[0]!.frames, 'e3').some((f) => f.t === 'close'), 'the refusal');
    assert.ok(lines(r.legs[0]!.frames, 'e3').some((e) => e['code'] === 'SESSION_ACTIVE'));
    assert.equal(hosts.length, 2);
  } finally { edge.close(); r.close(); }
});

test('input on a detached session takes it back, and so does the relay\'s word after a takeover; an attached session hears no replay', async () => {
  const r = await relay();
  const ptys = fakePtys();
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', spawnPty: ptys.spawn, log: () => {} });
  try {
    await until(() => r.current?.hello != null, 'the hello');
    r.send({ ch: 'c1', t: 'open', cols: 80, rows: 24, actorId: 'u1' });
    r.send({ ch: 'c2', t: 'open', cols: 80, rows: 24, actorId: 'u1' });
    await until(() => textOf(r.legs[0]!.frames, 'c1') === 'nm $ ' && textOf(r.legs[0]!.frames, 'c2') === 'nm $ ', 'both prompts');
    r.send({ ch: 'c1', t: 'detach' });
    r.send({ ch: 'c2', t: 'detach' });
    await until(() => edge.detachedCount() === 2, 'both detached');
    ptys.started[0]!.out('one');
    ptys.started[1]!.out('two');
    r.send({ ch: 'c1', t: 'data', d: b64('x') });
    await until(() => textOf(r.legs[0]!.frames, 'c1') === 'nm $ one', 'the held bytes after the input');
    r.send({ ch: 'c2', t: 'open', resume: true, actorId: 'u1' }); // no `from`: the relay's word
    await until(() => textOf(r.legs[0]!.frames, 'c2') === 'nm $ two', 'the held bytes after the relay\'s word');
    assert.deepEqual(on(r.legs[0]!.frames, 'c2').find((f) => f.t === 'resumed'), { ch: 'c2', t: 'resumed', o: 5, dropped: 0 });
    assert.equal(edge.detachedCount(), 0);
    const count = r.legs[0]!.frames.length;
    r.send({ ch: 'c1', t: 'open', resume: true, actorId: 'u1' });
    await sleep(50);
    assert.equal(r.legs[0]!.frames.length, count, 'an attached session hears nothing for the relay\'s word');
  } finally { edge.close(); r.close(); }
});

test('a detached terminal gives up its slot to a new one of the same person', async () => {
  const r = await relay();
  const ptys = fakePtys();
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', spawnPty: ptys.spawn, log: () => {} });
  try {
    await until(() => r.current?.hello != null, 'the hello');
    for (let i = 1; i <= MAX_TERMINAL_SESSIONS_PER_ACTOR; i++) r.send({ ch: `c${i}`, t: 'open', cols: 80, rows: 24, actorId: 'u1' });
    await until(() => edge.sessionCount() === MAX_TERMINAL_SESSIONS_PER_ACTOR, 'every terminal');
    for (let i = 1; i <= MAX_TERMINAL_SESSIONS_PER_ACTOR; i++) { r.send({ ch: `c${i}`, t: 'detach' }); await sleep(2); }
    await until(() => edge.detachedCount() === MAX_TERMINAL_SESSIONS_PER_ACTOR, 'every terminal detached');
    r.send({ ch: 'new', t: 'open', cols: 80, rows: 24, actorId: 'u1' });
    await until(() => textOf(r.legs[0]!.frames, 'new') === 'nm $ ', 'the new terminal');
    assert.equal(ptys.started[0]!.killed, true, 'the oldest detached terminal gave up its slot');
    assert.equal(ptys.started.slice(1).filter((p) => p.killed).length, 0, 'only the one');
  } finally { edge.close(); r.close(); }
});

test('before the relay\'s cut the edge rotates its socket: the takeover moves the sessions, nothing detaches, every byte arrives once', async () => {
  const r = await relay();
  const ptys = fakePtys();
  const logs: string[] = [];
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', spawnPty: ptys.spawn, rotateMs: 400, log: (l) => logs.push(l) });
  try {
    await until(() => r.current?.hello != null, 'the hello');
    r.send({ ch: 'c1', t: 'open', cols: 80, rows: 24, actorId: 'u1' });
    await until(() => textOf(r.legs[0]!.frames, 'c1') === 'nm $ ', 'the first prompt');
    await until(() => logs.some((l) => l.includes('took the new socket over')), 'the rotation');
    assert.equal(edge.detachedCount(), 0, 'a rotation detaches nothing');
    assert.equal(ptys.started[0]!.killed, false);
    ptys.started[0]!.out('ROTATED');
    const all = (): Frame[] => r.legs.flatMap((l) => on(l.frames, 'c1')).filter((f) => f.t === 'data').sort((a, b) => (a.o ?? 0) - (b.o ?? 0));
    await until(() => Buffer.concat(all().map((f) => Buffer.from(f.d!, 'base64'))).toString() === 'nm $ ROTATED', 'the bytes after the rotation');
    assert.ok(r.legs.slice(1).some((l) => textOf(l.frames, 'c1').includes('ROTATED')), 'they came through a newer socket');
    r.send({ ch: 'c1', t: 'data', d: b64('pwd\r') });
    await until(() => ptys.started[0]!.written.includes('pwd\r'), 'input through the newer socket');
    assert.ok(!r.legs.some((l) => l.frames.some((f) => f.t === 'detach' || f.t === 'close')), 'nothing closed');
  } finally { edge.close(); r.close(); }
});

test('a rotation the relay never takes over is given up, and the socket in use carries on', async () => {
  const r = await relay({ takeover: false });
  const ptys = fakePtys();
  const logs: string[] = [];
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', spawnPty: ptys.spawn, rotateMs: 300, handoverWaitMs: 200, log: (l) => logs.push(l) });
  try {
    await until(() => r.current?.hello != null, 'the hello');
    r.send({ ch: 'c1', t: 'open', cols: 80, rows: 24, actorId: 'u1' });
    await until(() => textOf(r.legs[0]!.frames, 'c1') === 'nm $ ', 'the first prompt');
    await until(() => logs.some((l) => l.includes('did not take the new socket over')), 'the rotation given up');
    ptys.started[0]!.out('STILL');
    await until(() => textOf(r.legs[0]!.frames, 'c1') === 'nm $ STILL', 'the bytes on the socket in use');
    assert.equal(edge.sessionCount(), 1);
  } finally { edge.close(); r.close(); }
});
