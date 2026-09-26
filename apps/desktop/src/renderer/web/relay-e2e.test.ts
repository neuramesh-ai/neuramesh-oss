// END TO END ACROSS THE REAL PIPE: the real hub, the real machine edge, and the real
// browser client this repo will ship — no mocks between them.
//
// The unit tests on either side both pass while the two disagree about a field name, a
// base64 convention or the order of the handshake. This is the test that would catch that,
// so it drives the actual `openRelayPty` a terminal pane calls, over a socket, into the
// actual `createHub`, out to the actual `connectEchoMachine`.
import { test, after, beforeEach } from 'node:test';
import { createServer } from 'node:http';
import type { WebSocket as WsSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { createHub, connectEchoMachine } from '@neuramesh/relay';
import { connectMachineEdge } from '../../main/relay/machine-edge';
import type { EngineeringMachineHost } from '../../main/relay/engineering-host';
import { openRelayJsonChannel, openRelayPty, resetRelay, waitForRelayCapacity, type RelayConfig } from '@neuramesh/relay-client';
import { createLiveStreams } from '../../main/livestreams';
import { streamOverrides, type StreamDb, type StreamEvent } from './webnm-stream';

test('Engineering relay upload waits above its bounded send high-water mark', async () => {
  const socket = { bufferedAmount: 1024, readyState: WebSocket.OPEN };
  let waits = 0;
  await waitForRelayCapacity(socket, 512, async () => { waits += 1; socket.bufferedAmount = 0; });
  if (waits !== 1) throw new Error(`expected one backpressure wait, got ${waits}`);
});

// NOTE ON ASSERTIONS: every `await p.waitFor(...)` IS the assertion — it rejects on timeout
// with the bytes the pane actually received, which is a better failure message than an
// equality check on a buffer that may legitimately arrive in several frames.

const MACHINE_ID = 'm-e2e';
let allow = true;

// LAZY, MEMOISED SETUP RATHER THAN a before() HOOK. Top-level `test()` calls do not reliably
// wait on a root-level `before()` here — the first version of this file did exactly that and
// every test dialled `new WebSocket('')`, failing with "Invalid URL" that looked like a client
// bug and was a harness bug. Awaiting the boot explicitly makes the dependency impossible to
// get wrong, and it is the same shape each test needs anyway.
let booted: Promise<{ url: string }> | null = null;
let teardown: (() => void) | null = null;

async function waitForMachine(hub: { stats(): { machines: string[] } }, machineId: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!hub.stats().machines.includes(machineId)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for machine registration: ${machineId}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function boot(): Promise<{ url: string }> {
  booted ??= (async () => {
    const hub = createHub({
      validateMachine: async (token) =>
        token === 'nmm_good' ? { machineId: MACHINE_ID, workspaceId: 'w1' } : null,
      validateClient: async () => ({ allowed: allow, userId: 'u1' }),
    });
    const server = createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (sock: WsSocket, req) => hub.handleConnection(sock, req));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
    const machine = connectEchoMachine({ relayUrl: url, token: 'nmm_good', machineId: MACHINE_ID });
    // the machine must be REGISTERED (hello accepted) before a client attaches, or attach
    // legitimately gets MACHINE_OFFLINE and the test blames the wrong thing
    await waitForMachine(hub, MACHINE_ID);
    teardown = () => { resetRelay(); machine.close(); wss.close(); server.close(); };
    return { url };
  })();
  return booted;
}

// resetRelay closes the shared client socket: without it the final test's socket keeps the
// event loop alive and a fully PASSING suite hangs instead of exiting
after(() => teardown?.());
beforeEach(() => { allow = true; resetRelay(); });

const cfg = (url: string, machineId: string | null): RelayConfig => ({
  relayUrl: url,
  clientBearer: async () => 'clerk-token',
  machineId: async () => machineId,
});

/** a pane: everything the terminal has printed, with a way to wait for the next thing.
 *  Modelled on one channel because that is what a terminal IS — the earlier shape opened a
 *  second pty to watch for the echo, which tested two channels and no terminal. */
function pane(): { onData: (d: string) => void; onExit: () => void; waitFor(re: RegExp, ms?: number): Promise<void> } {
  let seen = '';
  let exited = false;
  const waiters: Array<{ re: RegExp; ok: () => void; bad: (e: Error) => void }> = [];
  const sweep = (): void => {
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i]!.re.test(seen)) { waiters[i]!.ok(); waiters.splice(i, 1); }
    }
  };
  return {
    onData: (d) => { seen += d; sweep(); },
    onExit: () => { exited = true; sweep(); for (const w of waiters.splice(0)) w.bad(new Error(`exited before ${w.re}; saw ${JSON.stringify(seen)}`)); },
    waitFor: (re, ms = 4000) =>
      new Promise<void>((ok, bad) => {
        if (re.test(seen)) return ok();
        if (exited) return bad(new Error(`already exited; saw ${JSON.stringify(seen)}`));
        const t = setTimeout(() => bad(new Error(`timed out waiting for ${re}; saw ${JSON.stringify(seen)}`)), ms);
        waiters.push({ re, ok: () => { clearTimeout(t); ok(); }, bad: (e) => { clearTimeout(t); bad(e); } });
      }),
  };
}

test('a keystroke travels browser -> relay -> machine -> relay -> browser', async () => {
  const { url } = await boot();
  const p = pane();
  const pty = openRelayPty(cfg(url, MACHINE_ID), { cols: 80, rows: 24, onData: p.onData, onExit: p.onExit });
  await p.waitFor(/echo pty ready/);
  // the echo machine returns exactly what it is sent, so seeing this come back proves every
  // hop: encode, socket, hub routing by channel ownership, machine decode, and the reverse
  pty.input('NM_RELAY_E2E_OK\r');
  await p.waitFor(/NM_RELAY_E2E_OK/);
  pty.close();
});

test('non-ASCII input survives the whole round trip', async () => {
  const { url } = await boot();
  const p = pane();
  const pty = openRelayPty(cfg(url, MACHINE_ID), { cols: 80, rows: 24, onData: p.onData, onExit: p.onExit });
  await p.waitFor(/echo pty ready/);
  // btoa alone would have thrown on these; a per-frame decoder would have mangled them
  pty.input('café 🚀 naïve');
  await p.waitFor(/café 🚀 naïve/);
  pty.close();
});

test('a malformed relay origin says so in the pane instead of throwing into the console', async () => {
  const p = pane();
  openRelayPty({ relayUrl: 'not a url', clientBearer: async () => 't', machineId: async () => MACHINE_ID },
    { cols: 80, rows: 24, onData: p.onData, onExit: p.onExit });
  await p.waitFor(/nm:/);
});

test('no machine yet is a sentence in the pane, not an empty terminal', async () => {
  const { url } = await boot();
  const p = pane();
  openRelayPty(cfg(url, null), { cols: 80, rows: 24, onData: p.onData, onExit: p.onExit });
  await p.waitFor(/No cloud machine yet/);
});

test('a refused member sees the forbidden sentence, not silence', async () => {
  const { url } = await boot();
  allow = false;
  const p = pane();
  openRelayPty(cfg(url, MACHINE_ID), { cols: 80, rows: 24, onData: p.onData, onExit: p.onExit });
  await p.waitFor(/do not have access/);
});

test('attaching to a machine the relay does not hold says it is not on the relay yet', async () => {
  const { url } = await boot();
  const p = pane();
  openRelayPty(cfg(url, 'm-does-not-exist'), { cols: 80, rows: 24, onData: p.onData, onExit: p.onExit });
  // never "asleep" (2026-09-19): ensureMachine runs before every attach, so the machine is
  // online by the API's account when 4404 arrives; it is a socket the balancer closed
  await p.waitFor(/not on the relay yet/);
});

test('Engineering JSON crosses the real browser, hub, and machine edges', async () => {
  resetRelay();
  const machineId = 'm-engineering';
  const hub = createHub({
    validateMachine: async (token) => token === 'nmm_engineering' ? { machineId, workspaceId: 'w1' } : null,
    validateClient: async () => ({ allowed: true, userId: 'u1' }),
  });
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (sock: WsSocket, req) => hub.handleConnection(sock, req));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  const engineering: EngineeringMachineHost = {
    async open(meta, emit) {
      emit({ type: 'ready', provider: 'test', model: 'cline-test', cwd: `/work/${meta.repoId}`, modelId: meta.modelId ?? null, brainPack: meta.brainPack ?? null });
      return {
        command(value) {
          const command = value as { type?: string; prompt?: string };
          if (command.type === 'prompt' && command.prompt === 'large event') emit({ type: 'error', recoverable: true, message: 'x'.repeat(1_100_000) });
          else if (command.type === 'prompt') emit({ type: 'status', status: `received:${command.prompt}` });
        },
        close() {},
      };
    },
  };
  const edge = connectMachineEdge({ relayUrl: url, token: 'nmm_engineering', machineId, engineering, log: () => {} });
  await waitForMachine(hub, machineId);
  const events: Array<Record<string, unknown>> = [];
  let wake: (() => void) | null = null;
  const next = () => new Promise<void>((resolve, reject) => {
    if (events.some((event) => event['status'] === 'received:inspect the repo')) return resolve();
    wake = resolve;
    setTimeout(() => reject(new Error(`timed out; events=${JSON.stringify(events)}`)), 4000);
  });
  const channel = openRelayJsonChannel(cfg(url, machineId), {
    lane: 'engineering',
    meta: {
      threadId: 'eng-e2e', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'plan',
      permissions: { read: true, edit: false, command: false, web: false, mcp: false },
      policy: { read: true, edit: true, command: true, web: true, mcp: true },
    },
    onMessage: (event) => { events.push(event as Record<string, unknown>); if ((event as Record<string, unknown>)['status'] === 'received:inspect the repo') wake?.(); },
    onError: (message) => events.push({ type: 'error', message }),
    onExit: () => {},
  });
  channel.send({ type: 'prompt', prompt: 'inspect the repo' });
  await next();
  const duplicateLease = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out waiting for duplicate Engineering lease rejection')), 4000);
    const duplicate = openRelayJsonChannel(cfg(url, machineId), {
      lane: 'engineering',
      meta: {
        threadId: 'eng-e2e', repoId: 'r-other', repoName: 'other-app', branch: 'main', mode: 'plan',
        permissions: { read: true, edit: false, command: false, web: false, mcp: false },
        policy: { read: true, edit: true, command: true, web: true, mcp: true },
      },
      onMessage: (event) => {
        if ((event as Record<string, unknown>)['code'] !== 'SESSION_ACTIVE') return;
        clearTimeout(timeout); duplicate.close(); resolve();
      },
      onError: (message) => { clearTimeout(timeout); reject(new Error(message)); },
      onExit: () => {},
    });
  });
  await duplicateLease;
  const large = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out waiting for chunked Engineering event')), 4000);
    const probe = openRelayJsonChannel(cfg(url, machineId), {
      lane: 'engineering',
      meta: {
        threadId: 'eng-large', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'plan',
        permissions: { read: true, edit: false, command: false, web: false, mcp: false },
        policy: { read: true, edit: true, command: true, web: true, mcp: true },
      },
      onMessage: (event) => {
        const value = event as Record<string, unknown>;
        if (value['type'] === 'error' && String(value['message']).length === 1_100_000) {
          clearTimeout(timeout); probe.close(); resolve();
        }
      },
      onError: (message) => { clearTimeout(timeout); reject(new Error(message)); },
      onExit: () => {},
    });
    probe.send({ type: 'prompt', prompt: 'large event' });
  });
  await large;
  const survived = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`machine connection did not survive large event; events=${JSON.stringify(events)}`)), 4000);
    wake = () => { clearTimeout(timeout); resolve(); };
  });
  channel.send({ type: 'prompt', prompt: 'still alive' });
  const survivalPoll = setInterval(() => {
    if (events.some((event) => event['status'] === 'received:still alive')) wake?.();
  }, 10);
  await survived.finally(() => clearInterval(survivalPoll));
  const parallelEvents: Array<Record<string, unknown>> = [];
  const parallel = openRelayJsonChannel(cfg(url, machineId), {
    lane: 'engineering',
    meta: {
      threadId: 'eng-parallel-upload', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'plan',
      permissions: { read: true, edit: false, command: false, web: false, mcp: false },
      policy: { read: true, edit: true, command: true, web: true, mcp: true },
    },
    onMessage: (event) => parallelEvents.push(event as Record<string, unknown>),
    onError: (message) => parallelEvents.push({ type: 'error', message }),
    onExit: () => {},
  });
  const chunkBody = 'eA=='.repeat(43_691);
  await Promise.all(Array.from({ length: 20 }, (_, index) => Promise.all([
    channel.send({ type: 'attachment_chunk', id: 'upload-a', index, data: chunkBody }),
    parallel.send({ type: 'attachment_chunk', id: 'upload-b', index, data: chunkBody }),
  ])));
  await Promise.all([
    channel.send({ type: 'prompt', prompt: 'after aggregate upload a' }),
    parallel.send({ type: 'prompt', prompt: 'after aggregate upload b' }),
  ]);
  const uploadDeadline = Date.now() + 4000;
  while (!events.some((event) => event['status'] === 'received:after aggregate upload a')
    || !parallelEvents.some((event) => event['status'] === 'received:after aggregate upload b')) {
    if (Date.now() >= uploadDeadline) throw new Error(`shared relay did not survive parallel uploads: ${JSON.stringify({ events, parallelEvents })}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  parallel.close();
  channel.close();
  edge.close();
  resetRelay();
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('a live reply streams machine -> relay -> web bridge as deltas, and the synced message replaces it', async () => {
  resetRelay();
  const machineId = 'm-stream';
  const hub = createHub({
    validateMachine: async (token) => token === 'nmm_stream' ? { machineId, workspaceId: 'w1' } : null,
    validateClient: async () => ({ allowed: true, userId: 'u1' }),
  });
  const server = createServer();
  const wss = new WebSocketServer({ server });
  let wireBytes = 0;
  wss.on('connection', (sock: WsSocket, req) => {
    // count what the relay hands the browser (the machine's frames, forwarded verbatim)
    const send = sock.send.bind(sock);
    sock.send = ((data: unknown, ...rest: unknown[]) => { wireBytes += String(data).length; return (send as (...a: unknown[]) => void)(data, ...rest); }) as typeof sock.send;
    hub.handleConnection(sock, req);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  // the machine: the SAME registry emitStream feeds, behind the real edge
  const streams = createLiveStreams();
  const edge = connectMachineEdge({ relayUrl: url, token: 'nmm_stream', machineId, streams, log: () => {} });
  await waitForMachine(hub, machineId);
  // the browser: the real bridge over a stand-in replica (the runner is up; the reply lands on cue)
  let latestReply: string | null = '2026-09-24 10:00:00.000Z';
  const onChange: Array<{ tables: string[]; fn: () => void }> = [];
  const db: StreamDb = {
    getAll: async <T,>(sql: string) => (sql.includes('from machines')
      ? [{ id: machineId, kind: 'runner', owner_user_id: 'owner', last_seen_at: new Date().toISOString() }]
      : [{ at: latestReply }]) as T[],
    onChangeWithCallback: (handler, options) => { onChange.push({ tables: options.tables, fn: handler.onChange }); return () => {}; },
  };
  const bridge = streamOverrides({ workspaceId: () => 'w1', actorId: () => 'u1', relayBearer: async () => 'clerk-token' }, db, url);
  const events: StreamEvent[] = [];
  const stop = bridge.watchAgentStream!((e) => events.push(e));
  const until = async (cond: () => boolean, what: string): Promise<void> => {
    const deadline = Date.now() + 4000;
    while (!cond()) {
      if (Date.now() > deadline) throw new Error(`timed out: ${what}; events=${JSON.stringify(events.slice(-3))}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  await until(() => streams.stats().subscribers === 1, 'the tab subscribes to the online runner');

  const key = 'c1:t1';
  const reply = 'Hello, world. café 🚀, every byte survives the lane. '.repeat(40);
  streams.publish(key, 'rex', '', false);
  for (let n = 8; n < reply.length; n += 37) { streams.publish(key, 'rex', reply.slice(0, n), false); await new Promise((r) => setTimeout(r, 5)); }
  streams.publish(key, 'rex', reply, false);
  await until(() => events.at(-1)?.text === reply, 'the whole reply arrives');
  const updates = events.filter((e) => e.key === key && e.text).length;
  const fullTextBytes = events.filter((e) => e.key === key && e.text).reduce((sum, e) => sum + JSON.stringify(e).length, 0);
  if (wireBytes >= fullTextBytes) throw new Error(`deltas cost ${wireBytes} B on the wire against ${fullTextBytes} B of whole-text updates`);

  streams.publish(key, 'rex', '', true);
  await new Promise((r) => setTimeout(r, 50));
  if (events.at(-1)?.done) throw new Error('the bubble must hold its text until the synced reply is in the replica');
  latestReply = '2026-09-24 10:00:30.000Z';
  for (const l of onChange) if (l.tables.includes('messages')) l.fn();
  await until(() => events.at(-1)?.done === true, 'the synced message replaces the bubble');
  if (updates < 3) throw new Error(`expected a stream of updates, saw ${updates}`);

  stop();
  edge.close();
  resetRelay();
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('a tab never opens the stream lane on a machine whose relay does not name it (an older daemon would start a shell)', async () => {
  resetRelay();
  const machineId = 'm-old';
  const logs: string[] = [];
  const hub = createHub({
    validateMachine: async (token) => token === 'nmm_old' ? { machineId, workspaceId: 'w1' } : null,
    validateClient: async () => ({ allowed: true, userId: 'u1' }),
    log: (line) => logs.push(line),
  });
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (sock: WsSocket, req) => hub.handleConnection(sock, req));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  // an older daemon: its hello names no lanes, and it would answer any OPEN with a shell
  const machine = connectEchoMachine({ relayUrl: url, token: 'nmm_old', machineId });
  await waitForMachine(hub, machineId);
  const db: StreamDb = {
    getAll: async <T,>(sql: string) => (sql.includes('from machines')
      ? [{ id: machineId, kind: 'runner', owner_user_id: 'owner', last_seen_at: new Date().toISOString() }]
      : [{ at: null }]) as T[],
    onChangeWithCallback: () => () => {},
  };
  const bridge = streamOverrides({ workspaceId: () => 'w1', actorId: () => 'u1', relayBearer: async () => 'clerk-token' }, db, url);
  const stop = bridge.watchAgentStream!(() => {});
  try {
    const deadline = Date.now() + 4000;
    while (!logs.some((l) => l.startsWith('client_attached'))) {
      if (Date.now() > deadline) throw new Error(`the tab never attached; logs=${JSON.stringify(logs)}`);
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 200));
    // the client read `attached` and sent no OPEN at all, so the hub never had to refuse one
    const refused = logs.filter((l) => l.startsWith('refuse_stream_open'));
    if (refused.length) throw new Error(`the tab sent a stream OPEN: ${JSON.stringify(refused)}`);
  } finally {
    stop();
    machine.close();
    resetRelay();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
