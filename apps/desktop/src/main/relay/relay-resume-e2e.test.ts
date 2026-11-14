// A SESSION OUTLIVES ITS SOCKET, END TO END (the session round, 2026-10): the real browser client
// (@neuramesh/relay-client), the real hub and the real machine edge, with a fake pty (CI builds no
// node-pty). A browser socket that drops comes back and takes its terminal and its Code session back
// with every byte once and no new shell; a relay restart drops both edges and both come back; the
// browser rotates its own socket before the relay's cut and the pane notices nothing; and against a
// machine that cannot resume a dropped socket still ends the pane with its reason, as before.
// Run: pnpm exec tsx --test src/main/relay/relay-resume-e2e.test.ts
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { createHub } from '@neuramesh/relay';
import { openRelayJsonChannel, openRelayPty, resetRelay, type RelayConfig } from '@neuramesh/relay-client';
import { connectMachineEdge, type PtyLike, type SpawnPty } from './machine-edge';
import type { EngineeringMachineHost } from './engineering-host';

const brain = mkdtempSync(join(tmpdir(), 'nm-relay-resume-'));
process.env['NM_BRAIN'] = brain;
after(() => { resetRelay(); rmSync(brain, { recursive: true, force: true }); });

async function until(cond: () => boolean, what: string, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const MACHINE = 'm-resume';

/** the real hub on a port, with the client sockets it holds (a test cuts them) */
async function hubOn(port = 0) {
  const logs: string[] = [];
  const hub = createHub({
    validateMachine: async (token) => token === 'nmm_resume' ? { machineId: MACHINE, workspaceId: 'w1' } : null,
    validateClient: async () => ({ allowed: true, userId: 'u1' }),
    log: (l) => logs.push(l),
  });
  const server = createServer();
  const wss = new WebSocketServer({ server });
  const clients: WsSocket[] = [];
  wss.on('connection', (sock: WsSocket, req: IncomingMessage) => {
    if (!req.headers.authorization) clients.push(sock);
    hub.handleConnection(sock, req);
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const bound = (server.address() as { port: number }).port;
  return {
    hub, logs, clients, port: bound, url: `ws://127.0.0.1:${bound}`,
    /** a restart: every socket drops at once */
    stop: async (): Promise<void> => {
      for (const s of wss.clients) s.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

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

/** a pane: what it printed, without the client's own `nm:` lines, and whether it ended */
function pane() {
  const state = { raw: '', exited: false };
  return {
    state,
    onData: (d: string): void => { state.raw += d; },
    onExit: (): void => { state.exited = true; },
    /** the shell's bytes alone */
    shell: (): string => state.raw.replace(/\r\n\x1b\[33mnm:\x1b\[0m \x1b\[2m[^\x1b]*\x1b\[0m\r\n/g, ''),
  };
}

const cfg = (url: string, extra: Partial<RelayConfig> = {}): RelayConfig => ({
  relayUrl: url, clientBearer: async () => 'clerk-token', machineId: async () => MACHINE, ...extra,
});

test('a browser socket that drops comes back: the terminal keeps every byte once, the same shell takes the next keystroke', async () => {
  resetRelay();
  const r = await hubOn();
  const ptys = fakePtys();
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_resume', machineId: MACHINE, spawnPty: ptys.spawn, log: () => {} });
  try {
    await until(() => r.hub.stats().machines.includes(MACHINE), 'the machine on the relay');
    const p = pane();
    const pty = openRelayPty(cfg(r.url), { cols: 80, rows: 24, onData: p.onData, onExit: p.onExit });
    await until(() => p.shell() === 'nm $ ', 'the prompt');
    r.clients.at(-1)!.terminate(); // the cut, on the browser's side
    ptys.started[0]!.out('DURING'); // bytes while nobody listens
    await until(() => p.shell() === 'nm $ DURING', 'the bytes produced while the socket was down');
    assert.equal(p.state.exited, false, 'the pane never ended');
    assert.equal(ptys.started.length, 1, 'no second shell');
    pty.input('ls\r');
    await until(() => ptys.started[0]!.written.includes('ls\r'), 'the keystroke on the same shell');
    ptys.started[0]!.out('AFTER');
    await until(() => p.shell() === 'nm $ DURINGAFTER', 'the bytes after the resume');
    assert.equal(edge.sessionCount(), 1);
    pty.close();
    await until(() => ptys.started[0]!.killed, 'a pane\'s close still ends its shell');
  } finally { resetRelay(); edge.close(); await r.stop(); }
});

test('a Code session survives its browser socket: events wait at the machine and arrive once, in order', async () => {
  resetRelay();
  const r = await hubOn();
  const hosts: Array<{ emit(e: Record<string, unknown>): void; commands: unknown[] }> = [];
  const engineering: EngineeringMachineHost = {
    open: async (_meta, emit) => {
      const h = { emit: (e: Record<string, unknown>) => emit(e as never), commands: [] as unknown[] };
      hosts.push(h);
      return { command: (v) => { h.commands.push(v); }, close: () => {} };
    },
  };
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_resume', machineId: MACHINE, spawnPty: fakePtys().spawn, engineering, log: () => {} });
  try {
    await until(() => r.hub.stats().machines.includes(MACHINE), 'the machine on the relay');
    const events: Array<Record<string, unknown>> = [];
    const errors: string[] = [];
    let exited = false;
    const channel = openRelayJsonChannel(cfg(r.url), {
      lane: 'engineering',
      meta: {
        threadId: 'th-resume', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'act',
        permissions: { read: true, edit: true, command: true, web: true, mcp: true }, policy: { read: true, edit: true, command: true, web: true, mcp: true },
      },
      onMessage: (m) => events.push(m as Record<string, unknown>),
      onError: (m) => errors.push(m),
      onExit: () => { exited = true; },
    });
    await channel.send({ type: 'prompt', prompt: 'one' });
    await until(() => hosts.length === 1 && hosts[0]!.commands.length === 1, 'the first prompt');
    hosts[0]!.emit({ type: 'status', status: 'a' });
    await until(() => events.length === 1, 'the first event');
    r.clients.at(-1)!.terminate();
    hosts[0]!.emit({ type: 'status', status: 'b' });
    hosts[0]!.emit({ type: 'status', status: 'c' });
    // a command sent while the socket is down waits for the next one. (One sent in the instant after the
    // relay cut the socket and before this side saw the close goes into the dead socket and is lost: the
    // lane has no command acknowledgement. The redial comes 500 ms after the close, so this is the wait)
    await new Promise((resolve) => setTimeout(resolve, 200));
    const late = channel.send({ type: 'prompt', prompt: 'two' });
    await until(() => events.length === 3, 'the events produced while the socket was down');
    await late;
    await until(() => hosts[0]!.commands.length === 2, 'the late command on the same session');
    assert.deepEqual(events.map((e) => e['status']), ['a', 'b', 'c']);
    assert.deepEqual(errors, []);
    assert.equal(exited, false);
    assert.equal(hosts.length, 1, 'no second Code session');
    channel.close();
  } finally { resetRelay(); edge.close(); await r.stop(); }
});

test('a relay restart drops both edges, and both come back to the same session', async () => {
  resetRelay();
  let r = await hubOn();
  const ptys = fakePtys();
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_resume', machineId: MACHINE, spawnPty: ptys.spawn, log: () => {} });
  try {
    await until(() => r.hub.stats().machines.includes(MACHINE), 'the machine on the relay');
    const p = pane();
    const pty = openRelayPty(cfg(r.url), { cols: 80, rows: 24, onData: p.onData, onExit: p.onExit });
    await until(() => p.shell() === 'nm $ ', 'the prompt');
    const port = r.port;
    await r.stop();
    ptys.started[0]!.out('RESTART');
    r = await hubOn(port);
    await until(() => r.hub.stats().machines.includes(MACHINE), 'the machine back on the new relay', 10_000);
    await until(() => p.shell() === 'nm $ RESTART', 'the bytes produced while the relay was down', 15_000);
    assert.equal(p.state.exited, false);
    assert.equal(ptys.started.length, 1);
    assert.ok(p.state.raw.includes('Reconnected.'), 'a drop longer than a moment is said, and so is its end');
    pty.input('pwd\r');
    await until(() => ptys.started[0]!.written.includes('pwd\r'), 'the keystroke after the restart');
    pty.close();
  } finally { resetRelay(); edge.close(); await r.stop(); }
});

test('the browser rotates its own socket before the relay\'s cut, and the pane notices nothing', async () => {
  resetRelay();
  const r = await hubOn();
  const ptys = fakePtys();
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_resume', machineId: MACHINE, spawnPty: ptys.spawn, log: () => {} });
  try {
    await until(() => r.hub.stats().machines.includes(MACHINE), 'the machine on the relay');
    const p = pane();
    const pty = openRelayPty(cfg(r.url, { rotateMs: 300 }), { cols: 80, rows: 24, onData: p.onData, onExit: p.onExit });
    await until(() => p.shell() === 'nm $ ', 'the prompt');
    await until(() => r.logs.some((l) => l.startsWith('resume_handover')), 'the rotation\'s handover');
    ptys.started[0]!.out('ROTATED');
    await until(() => p.shell() === 'nm $ ROTATED', 'the bytes after the rotation');
    assert.equal(p.state.raw, p.shell(), 'not one line about it in the pane');
    pty.input('id\r');
    await until(() => ptys.started[0]!.written.includes('id\r'), 'the keystroke through the newer socket');
    assert.equal(p.state.exited, false);
    pty.close();
  } finally { resetRelay(); edge.close(); await r.stop(); }
});

test('against a machine that cannot resume, a dropped socket ends the pane with its reason, as before', async () => {
  resetRelay();
  const r = await hubOn();
  const ptys = fakePtys();
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_resume', machineId: MACHINE, spawnPty: ptys.spawn, resumeGraceMs: 0, log: () => {} });
  try {
    await until(() => r.hub.stats().machines.includes(MACHINE), 'the machine on the relay');
    const p = pane();
    openRelayPty(cfg(r.url), { cols: 80, rows: 24, onData: p.onData, onExit: p.onExit });
    await until(() => p.shell() === 'nm $ ', 'the prompt');
    r.clients.at(-1)!.terminate();
    await until(() => p.state.exited, 'the pane ends');
    assert.match(p.state.raw, /The connection closed \(1006\)\./);
    await until(() => ptys.started[0]!.killed, 'the shell ends with its client, as before resume');
  } finally { resetRelay(); edge.close(); await r.stop(); }
});
