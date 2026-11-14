// THE DRAIN AND THE BROWSER TERMINALS (Cloud Run: cloudrun/lifecycle.ts through machined.ts). A terminal
// stands in the work dir the drain snapshots, so the drain tells every open terminal, opens no new one,
// and closes them before the snapshot. A frame for a channel this process does not hold (its shell died
// with an older socket or an older instance) is answered with close, so the browser's pane ends with a
// reason. And a relay URL the edge cannot dial is a log line, never a throw out of machined's boot.
// Run: pnpm exec tsx --test src/main/relay/machine-edge-drain.test.ts
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { connectMachineEdge, relayUrlProblem, DRAIN_CLOSED, DRAIN_REFUSED, DRAIN_WARNING, type PtyLike, type SpawnPty, type TerminalHost } from './machine-edge';

// an unnamed terminal opens in the brain root (resolveCwd): a scratch dir here, never a real profile
const brain = mkdtempSync(join(tmpdir(), 'nm-edge-drain-'));
process.env['NM_BRAIN'] = brain;
after(() => rmSync(brain, { recursive: true, force: true }));

async function until(cond: () => boolean, what: string, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface Frame { ch?: string; t: string; d?: string; [k: string]: unknown }

/** a relay stand-in: every frame the machine sent, and a way to send it one */
async function relay(): Promise<{ url: string; frames: Frame[]; send(f: Frame): void; close(): void }> {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  let sock: WsSocket | null = null;
  const state = {
    url: '',
    frames: [] as Frame[],
    send: (f: Frame): void => { sock?.send(JSON.stringify(f)); },
    close: (): void => { sock?.terminate(); wss.close(); server.close(); },
  };
  wss.on('connection', (s: WsSocket) => {
    sock = s;
    s.on('message', (raw) => { state.frames.push(JSON.parse(raw.toString()) as Frame); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  state.url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  return state;
}

/** shells that print a prompt and record their end: the CI install builds no node-pty */
function fakePtys(): { spawn: SpawnPty; started: Array<{ killed: boolean }> } {
  const started: Array<{ killed: boolean }> = [];
  const spawn: SpawnPty = () => {
    const rec = { killed: false };
    started.push(rec);
    let exit: () => void = () => {};
    const pty: PtyLike = {
      onData: (cb) => { setTimeout(() => cb('nm $ '), 0); },
      onExit: (cb) => { exit = cb; },
      write: () => {},
      resize: () => {},
      kill: () => { if (rec.killed) return; rec.killed = true; setTimeout(() => exit(), 0); },
    };
    return pty;
  };
  return { spawn, started };
}

const text = (f: Frame): string => (f.t === 'data' && typeof f.d === 'string' ? Buffer.from(f.d, 'base64').toString('utf8') : '');
const on = (frames: Frame[], ch: string): Frame[] => frames.filter((f) => f.ch === ch);

test('a drain tells the open terminals, refuses new ones, and closes them before the snapshot', async () => {
  const r = await relay();
  const ptys = fakePtys();
  let ended = 0;
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', spawnPty: ptys.spawn, onSessionEnd: () => { ended += 1; }, log: () => {} });
  try {
    await until(() => r.frames.some((f) => f.t === 'hello'), 'the hello');
    r.send({ ch: 'c1', t: 'open', cols: 80, rows: 24, actorId: 'u1' });
    await until(() => on(r.frames, 'c1').some((f) => text(f).includes('nm $')), 'the first prompt');
    assert.equal(edge.sessionCount(), 1);

    edge.hold();
    await until(() => on(r.frames, 'c1').some((f) => text(f) === DRAIN_WARNING), 'the warning in the open terminal');
    r.send({ ch: 'c2', t: 'open', cols: 80, rows: 24, actorId: 'u1' });
    await until(() => on(r.frames, 'c2').some((f) => f.t === 'close'), 'the refused open closed');
    assert.ok(on(r.frames, 'c2').some((f) => text(f) === DRAIN_REFUSED), 'the refusal says why');
    assert.equal(ptys.started.length, 1, 'no shell starts while the drain holds');

    assert.equal(edge.closeTerminals(), 1);
    await until(() => on(r.frames, 'c1').some((f) => f.t === 'close'), 'the close');
    const c1 = on(r.frames, 'c1');
    assert.ok(c1.slice(0, c1.findIndex((f) => f.t === 'close')).some((f) => text(f) === DRAIN_CLOSED), 'the reason lands before the close');
    assert.equal(ptys.started[0]!.killed, true);
    assert.equal(edge.sessionCount(), 0);
    assert.ok(ended >= 1, 'the runtime availability hears the session end');
    assert.equal(edge.closeTerminals(), 0, 'nothing is left to close');
  } finally { edge.close(); r.close(); }
});

test('a frame for a channel this process does not hold is answered with close', async () => {
  const r = await relay();
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', spawnPty: fakePtys().spawn, log: () => {} });
  try {
    await until(() => r.frames.some((f) => f.t === 'hello'), 'the hello');
    r.send({ ch: 'gone1', t: 'data', d: Buffer.from('ls\r').toString('base64') });
    r.send({ ch: 'gone2', t: 'resize', cols: 100, rows: 30 });
    r.send({ ch: 'gone3', t: 'close' });
    await until(() => on(r.frames, 'gone1').some((f) => f.t === 'close') && on(r.frames, 'gone2').some((f) => f.t === 'close'), 'the answers');
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(on(r.frames, 'gone3').length, 0, 'a close needs no answer');
  } finally { edge.close(); r.close(); }
});

test('a terminal host (a Cloud Run machine\'s agent box) runs the shell instead of a pty here, and its refusal reaches the pane', async () => {
  const r = await relay();
  const ptys = fakePtys();
  const asked: Array<{ cwd: string; cols: number; rows: number }> = [];
  let refuse: string | null = null;
  const terminals: TerminalHost = {
    open: (o) => {
      asked.push(o);
      return refuse ? { refused: refuse } : ptys.spawn('/bin/bash', [], { name: 'xterm-256color', cwd: o.cwd, cols: o.cols, rows: o.rows, env: {} });
    },
  };
  const neverHere: SpawnPty = () => { throw new Error('a Cloud Run terminal must not start a pty in the supervisor'); };
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', terminals, spawnPty: neverHere, log: () => {} });
  try {
    await until(() => r.frames.some((f) => f.t === 'hello'), 'the hello');
    r.send({ ch: 'b1', t: 'open', cols: 120, rows: 40, actorId: 'u1' });
    await until(() => on(r.frames, 'b1').some((f) => text(f).includes('nm $')), 'the box shell\'s prompt');
    assert.deepEqual(asked, [{ cwd: brain, cols: 120, rows: 40 }]);
    assert.equal(edge.sessionCount(), 1);
    refuse = 'the box is not running (sandbox run exited 1)';
    r.send({ ch: 'b2', t: 'open', cols: 80, rows: 24, actorId: 'u1' });
    await until(() => on(r.frames, 'b2').some((f) => f.t === 'close'), 'the refusal');
    assert.ok(on(r.frames, 'b2').some((f) => text(f).includes('the box is not running')), 'the pane says why');
    assert.equal(edge.sessionCount(), 1);
  } finally { edge.close(); r.close(); }
});

test('relayUrlProblem: the URLs a machine can dial, and the ones that threw out of machined\'s boot', () => {
  for (const ok of ['wss://nm-e2e-relay-abc123-uk.a.run.app', 'wss://relay.neuramesh.app/', 'ws://127.0.0.1:8787', 'https://nm-e2e-relay-abc123-uk.a.run.app']) {
    assert.equal(relayUrlProblem(ok), null, ok);
  }
  for (const bad of ['nm-e2e-relay-abc123-uk.a.run.app', 'ftp://relay.example', 'wss://relay.example/#x', 'wss://']) {
    assert.notEqual(relayUrlProblem(bad), null, bad);
  }
});

test('an edge handed a URL ws refuses logs it and never throws', () => {
  const logs: string[] = [];
  const edge = connectMachineEdge({ relayUrl: 'nm-e2e-relay.invalid', token: 'nmm_t', machineId: 'm1', log: (l) => logs.push(l) });
  try {
    assert.ok(logs.some((l) => l.startsWith('dial_refused')), logs.join(' | '));
  } finally { edge.close(); }
});
