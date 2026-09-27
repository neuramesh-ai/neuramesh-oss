// END TO END ACROSS THE REAL PIPE, MACHINE SIDE: the real hub, the real machine edge, and the tab's
// real transport (@neuramesh/relay-client). no mocks between them.
//
// the web client's own half of this file moved to apps/hq with the hq split (2026-09-26,
// docs/design/desktop-decoupling-2026-09/plan.md): hq drives its real stream client against a
// scripted machine there, and this half proves the machine end of the Code and live-reply lanes.
// the unit tests on either side both pass while the two disagree about a field name, a base64
// convention or the order of the handshake. these are the tests that would catch that.
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { WebSocket as WsSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { createHub } from '@neuramesh/relay';
import { openRelayJsonChannel, resetRelay, type RelayConfig } from '@neuramesh/relay-client';
import { LIVE_STREAM_LANE, applyLiveFrame, liveFrameOf, type LiveKeyState } from '@neuramesh/shared';
import { connectMachineEdge } from './machine-edge';
import type { EngineeringMachineHost } from './engineering-host';
import { createLiveStreams } from '../livestreams';

async function waitForMachine(hub: { stats(): { machines: string[] } }, machineId: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!hub.stats().machines.includes(machineId)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for machine registration: ${machineId}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const cfg = (url: string, machineId: string | null): RelayConfig => ({
  relayUrl: url,
  clientBearer: async () => 'clerk-token',
  machineId: async () => machineId,
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

test('a live reply streams machine -> relay -> a tab as deltas, and ends on the machine\'s word', async () => {
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
    // count what the relay hands out (the machine's frames, forwarded verbatim)
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
  // the tab: the real transport on the live lane, folding frames with the shared reducer the web client uses
  const held = new Map<string, LiveKeyState>();
  let ended = false;
  let updates = 0;
  let wholeTextBytes = 0;
  const channel = openRelayJsonChannel(cfg(url, machineId), {
    lane: LIVE_STREAM_LANE,
    meta: { v: 1 },
    onMessage: (message) => {
      const f = liveFrameOf(message);
      if (!f || !('k' in f)) return;
      const step = applyLiveFrame(held.get(f.k), f);
      if (step.kind === 'state') { held.set(f.k, step.state); updates += 1; wholeTextBytes += JSON.stringify(step.state.text).length; }
      else if (step.kind === 'end') ended = true;
      else if (step.kind === 'resync') void channel.send({ t: 'resync', k: f.k });
    },
    onError: () => {},
    onExit: () => {},
  });
  const until = async (cond: () => boolean, what: string): Promise<void> => {
    const deadline = Date.now() + 4000;
    while (!cond()) {
      if (Date.now() > deadline) throw new Error(`timed out: ${what}; updates=${updates} ended=${ended}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  try {
    await until(() => streams.stats().subscribers === 1, 'the tab subscribes to the machine');

    const key = 'c1:t1';
    const reply = 'Hello, world. café 🚀, every byte survives the lane. '.repeat(40);
    streams.publish(key, 'rex', '', false);
    for (let n = 8; n < reply.length; n += 37) { streams.publish(key, 'rex', reply.slice(0, n), false); await new Promise((r) => setTimeout(r, 5)); }
    streams.publish(key, 'rex', reply, false);
    await until(() => held.get(key)?.text === reply, 'the whole reply arrives');
    if (updates < 3) throw new Error(`expected a stream of updates, saw ${updates}`);
    if (wireBytes >= wholeTextBytes) throw new Error(`deltas cost ${wireBytes} B on the wire against ${wholeTextBytes} B of whole-text updates`);

    streams.publish(key, 'rex', '', true);
    await until(() => ended, 'the machine ends the stream on its key');
  } finally {
    channel.close();
    edge.close();
    resetRelay();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
