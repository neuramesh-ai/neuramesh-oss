// hub behaviour over REAL ws sockets on an ephemeral port, validators stubbed — the
// wire is the unit under test: registration, refusal codes, both-way forwarding
// (the echo machine client proves the full client→relay→machine→relay→client path),
// machine-gone teardown, and last-writer-wins takeover.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import {
  createHub, MAX_CHANNELS_PER_CLIENT, MAX_CLIENT_INGRESS_BYTES_PER_SECOND, MAX_ENGINEERING_CHANNELS_PER_ACTOR,
  MAX_RELAY_SOCKET_BUFFERED_BYTES, sendBounded, type Hub, type HubOptions,
} from './hub.js';
import { keepAlive } from './keepalive.js';
import { connectEchoMachine, type MachineClient } from './machine-client.js';
import { CLOSE, fromB64, toB64, type ChannelFrame, type RelayMessage } from './protocol.js';

const M1 = '3c9f8a04-8d2e-4d7b-9a51-0f6f0e1c2ab3';

const validators: Pick<HubOptions, 'validateMachine' | 'validateClient'> = {
  validateMachine: async (token) => (token === 'nmm_good' ? { machineId: M1, workspaceId: 'ws1' } : null),
  validateClient: async (token) => (token === 'clerk-good' ? { allowed: true, userId: 'u1' } : { allowed: false }),
};

interface Relay {
  url: string;
  hub: Hub;
  logs: string[];
  server: Server;
}

const open: { servers: Server[]; socks: WebSocket[]; machines: MachineClient[] } = { servers: [], socks: [], machines: [] };

function startRelay(overrides: Partial<HubOptions> = {}, keepaliveMs = 0): Promise<Relay> {
  const logs: string[] = [];
  const hub = createHub({ ...validators, ...overrides, log: (l) => logs.push(l) });
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (sock, req) => {
    // index.ts's own habit: the server keeps every socket alive (keepalive.ts), the hub routes
    if (keepaliveMs > 0) keepAlive(sock, keepaliveMs, () => logs.push('keepalive_reap: no pong, terminating'));
    hub.handleConnection(sock, req);
  });
  open.servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `ws://127.0.0.1:${port}`, hub, logs, server });
    });
  });
}

function connectClient(url: string, headers?: Record<string, string>): Promise<WebSocket> {
  const sock = new WebSocket(url, { headers });
  open.socks.push(sock);
  return new Promise((resolve, reject) => {
    sock.once('open', () => resolve(sock));
    sock.once('error', reject);
  });
}

function machine(url: string, token = 'nmm_good', machineId = M1): MachineClient {
  const m = connectEchoMachine({ relayUrl: url, token, machineId });
  open.machines.push(m);
  return m;
}

const nextMessage = (sock: WebSocket): Promise<RelayMessage> =>
  new Promise((resolve) => sock.once('message', (raw) => resolve(JSON.parse(String(raw)) as RelayMessage)));
const nextMessages = (sock: WebSocket, count: number): Promise<RelayMessage[]> => new Promise((resolve) => {
  const messages: RelayMessage[] = [];
  const receive = (raw: WebSocket.RawData): void => {
    messages.push(JSON.parse(String(raw)) as RelayMessage);
    if (messages.length === count) { sock.off('message', receive); resolve(messages); }
  };
  sock.on('message', receive);
});

const closedWith = (sock: WebSocket): Promise<{ code: number; reason: string }> =>
  new Promise((resolve) => sock.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));

async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** attach a client and consume the attached ack */
async function attach(url: string, token = 'clerk-good'): Promise<WebSocket> {
  const c = await connectClient(url);
  const ack = nextMessage(c);
  c.send(JSON.stringify({ t: 'attach', machineId: M1, token }));
  expect(await ack).toEqual({ t: 'attached', machineId: M1 });
  return c;
}

afterEach(() => {
  for (const m of open.machines.splice(0)) m.close();
  for (const s of open.socks.splice(0)) s.close();
  for (const srv of open.servers.splice(0)) srv.close();
});

describe('relay hub', () => {
  it('closes a slow outbound edge before its WebSocket buffer can grow without bound', () => {
    let closed = 0;
    const socket = {
      readyState: 1, OPEN: 1, bufferedAmount: MAX_RELAY_SOCKET_BUFFERED_BYTES,
      send: () => expect.unreachable('the over-budget frame must not be sent'),
      close: (code: number) => { expect(code).toBe(CLOSE.TOO_LARGE); closed += 1; },
    };
    expect(sendBounded(socket as never, { ch: 'code-1', t: 'close' })).toBe(false);
    expect(closed).toBe(1);
  });

  it('can reject the offending source without closing a shared slow destination', () => {
    let destinationClosed = 0;
    let sourceClosed = 0;
    const destination = {
      readyState: 1, OPEN: 1, bufferedAmount: MAX_RELAY_SOCKET_BUFFERED_BYTES,
      send: () => expect.unreachable('the over-budget frame must not be sent'),
      close: () => { destinationClosed += 1; },
    };
    expect(sendBounded(destination as never, { ch: 'code-1', t: 'close' }, () => { sourceClosed += 1; })).toBe(false);
    expect({ destinationClosed, sourceClosed }).toEqual({ destinationClosed: 0, sourceClosed: 1 });
  });

  it('machine hello registers the machine', async () => {
    const r = await startRelay();
    machine(r.url);
    await until(() => r.hub.stats().machines.includes(M1), 'machine registration');
    expect(r.logs.some((l) => l.startsWith(`machine_online machine=${M1}`))).toBe(true);
  });

  it('an unknown machine token is closed with UNAUTHORIZED', async () => {
    const r = await startRelay();
    const m = machine(r.url, 'nmm_wrong');
    const { code } = await closedWith(m.sock);
    expect(code).toBe(CLOSE.UNAUTHORIZED);
    expect(r.hub.stats().machines).toEqual([]);
  });

  it('client attach with allowed=false is refused and closed with FORBIDDEN', async () => {
    const r = await startRelay();
    machine(r.url);
    await until(() => r.hub.stats().machines.includes(M1), 'machine registration');
    const c = await connectClient(r.url);
    const done = closedWith(c);
    c.send(JSON.stringify({ t: 'attach', machineId: M1, token: 'clerk-bad' }));
    const { code, reason } = await done;
    expect(code).toBe(CLOSE.FORBIDDEN);
    expect(reason).toBe('forbidden');
    expect(r.hub.stats().clients).toBe(0);
  });

  it('attach to a machine with no live socket is refused with MACHINE_OFFLINE', async () => {
    const r = await startRelay();
    const c = await connectClient(r.url);
    const done = closedWith(c);
    c.send(JSON.stringify({ t: 'attach', machineId: M1, token: 'clerk-good' }));
    expect((await done).code).toBe(CLOSE.MACHINE_OFFLINE);
  });

  it('bounds frames received while client membership validation is pending', async () => {
    const gate: { release?: (verdict: { allowed: boolean; userId?: string }) => void } = {};
    const r = await startRelay({ validateClient: async () => new Promise((resolve) => { gate.release = resolve; }) });
    machine(r.url);
    await until(() => r.hub.stats().machines.includes(M1), 'machine registration');
    const c = await connectClient(r.url);
    const done = closedWith(c);
    c.send(JSON.stringify({ t: 'attach', machineId: M1, token: 'pending' }));
    const payload = JSON.stringify({ ch: 'code-1', t: 'data', d: 'x'.repeat(256 * 1024) });
    for (let index = 0; index < 20; index += 1) c.send(payload);
    expect((await done).code).toBe(CLOSE.TOO_LARGE);
    gate.release?.({ allowed: true, userId: 'u1' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(r.hub.stats().clients).toBe(0);
  });

  it('does not register a client that disconnects while membership validation is pending', async () => {
    const gate: { release?: (verdict: { allowed: boolean; userId?: string }) => void } = {};
    const r = await startRelay({ validateClient: async () => new Promise((resolve) => { gate.release = resolve; }) });
    machine(r.url);
    await until(() => r.hub.stats().machines.includes(M1), 'machine registration');
    const c = await connectClient(r.url);
    c.send(JSON.stringify({ t: 'attach', machineId: M1, token: 'pending' }));
    const done = closedWith(c);
    c.close();
    await done;
    gate.release?.({ allowed: true, userId: 'u1' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(r.hub.stats().clients).toBe(0);
  });

  it('allowed attach forwards data frames both directions (echo machine proves it)', async () => {
    const r = await startRelay();
    machine(r.url);
    await until(() => r.hub.stats().machines.includes(M1), 'machine registration');
    const c = await attach(r.url);

    const banner = nextMessage(c);
    c.send(JSON.stringify({ ch: 'c1', t: 'open', cols: 80, rows: 24 } satisfies ChannelFrame));
    const b = (await banner) as ChannelFrame;
    expect(b).toMatchObject({ ch: 'c1', t: 'data' });
    expect(fromB64(b.d!).toString('utf8')).toBe('echo pty ready\r\n');

    const echo = nextMessage(c);
    c.send(JSON.stringify({ ch: 'c1', t: 'data', d: toB64('ping') } satisfies ChannelFrame));
    const e = (await echo) as ChannelFrame;
    expect(e).toMatchObject({ ch: 'c1', t: 'data' });
    expect(fromB64(e.d!).toString('utf8')).toBe('ping');
  });

  it('rejects excess Engineering channels without forwarding their open to the machine', async () => {
    const r = await startRelay();
    machine(r.url);
    await until(() => r.hub.stats().machines.includes(M1), 'machine registration');
    const c = await attach(r.url);
    for (let index = 0; index < MAX_ENGINEERING_CHANNELS_PER_ACTOR; index += 1) {
      const response = nextMessage(c);
      c.send(JSON.stringify({ ch: `code-${index}`, t: 'open', lane: 'engineering', meta: {} } satisfies ChannelFrame));
      expect((await response as ChannelFrame).t).toBe('data');
    }
    const response = nextMessages(c, 2);
    c.send(JSON.stringify({ ch: 'code-overflow', t: 'open', lane: 'engineering', meta: {} } satisfies ChannelFrame));
    const responses = await response as ChannelFrame[];
    const rejected = responses[0]!;
    const closed = responses[1]!;
    expect(rejected).toMatchObject({ ch: 'code-overflow', t: 'data' });
    expect(JSON.parse(fromB64(rejected.d!).toString('utf8')).code).toBe('ENGINEERING_CHANNEL_LIMIT');
    expect(closed).toEqual({ ch: 'code-overflow', t: 'close' });
    expect(c.readyState).toBe(WebSocket.OPEN);
  });

  it('caps terminal channel fan-out without disturbing existing sessions', async () => {
    const r = await startRelay();
    machine(r.url);
    await until(() => r.hub.stats().machines.includes(M1), 'machine registration');
    const c = await attach(r.url);
    for (let index = 0; index < MAX_CHANNELS_PER_CLIENT; index += 1) {
      const response = nextMessage(c);
      c.send(JSON.stringify({ ch: `terminal-${index}`, t: 'open' } satisfies ChannelFrame));
      expect((await response as ChannelFrame).t).toBe('data');
    }
    const rejected = nextMessage(c);
    c.send(JSON.stringify({ ch: 'terminal-overflow', t: 'open' } satisfies ChannelFrame));
    expect(await rejected).toEqual({ ch: 'terminal-overflow', t: 'close' });
    const echo = nextMessage(c);
    c.send(JSON.stringify({ ch: 'terminal-0', t: 'data', d: toB64('still alive') } satisfies ChannelFrame));
    expect(fromB64((await echo as ChannelFrame).d!).toString('utf8')).toBe('still alive');
  });

  it('contains an ingress flood to its source client and keeps peers attached', async () => {
    const r = await startRelay();
    machine(r.url);
    await until(() => r.hub.stats().machines.includes(M1), 'machine registration');
    const noisy = await attach(r.url);
    const peer = await attach(r.url);
    const banner = nextMessage(noisy);
    noisy.send(JSON.stringify({ ch: 'flood', t: 'open' } satisfies ChannelFrame));
    await banner;
    const closed = closedWith(noisy);
    const data = toB64(Buffer.alloc(384 * 1024));
    const payload = JSON.stringify({ ch: 'flood', t: 'data', d: data } satisfies ChannelFrame);
    const count = Math.ceil(MAX_CLIENT_INGRESS_BYTES_PER_SECOND / Buffer.byteLength(payload)) + 1;
    for (let index = 0; index < count; index += 1) noisy.send(payload);
    expect((await closed).code).toBe(CLOSE.TOO_LARGE);
    await until(() => r.hub.stats().clients === 1, 'offending client cleanup');
    expect(peer.readyState).toBe(WebSocket.OPEN);
  });

  it('machine disconnect closes attached clients with MACHINE_GONE', async () => {
    const r = await startRelay();
    const m = machine(r.url);
    await until(() => r.hub.stats().machines.includes(M1), 'machine registration');
    const c = await attach(r.url);
    const done = closedWith(c);
    m.close();
    const { code, reason } = await done;
    expect(code).toBe(CLOSE.MACHINE_GONE);
    expect(reason).toBe('machine gone');
    expect(r.hub.stats()).toEqual({ machines: [], clients: 0 });
  });

  it('a newer machine socket takes over: logged, old socket closed, service continues', async () => {
    const r = await startRelay();
    const a = machine(r.url);
    await until(() => r.hub.stats().machines.includes(M1), 'first machine registration');
    const aClosed = closedWith(a.sock);
    const b = machine(r.url);
    const { code } = await aClosed;
    expect(code).toBe(CLOSE.TAKEOVER);
    expect(r.logs.some((l) => l === `takeover machine=${M1}`)).toBe(true);
    // the takeover never tore the registration down — and clients still get service
    expect(r.hub.stats().machines).toEqual([M1]);
    const c = await attach(r.url);
    const echo = nextMessage(c);
    c.send(JSON.stringify({ ch: 'c2', t: 'open' } satisfies ChannelFrame));
    expect(((await echo) as ChannelFrame).ch).toBe('c2');
    b.close();
  });

  // KEEPALIVE (2026-09-19): a machine that stops answering pings is a half-open socket (the load
  // balancer's idle timeout closed it without a close reaching the other side); the hub reaps it,
  // so the browser's next attach is refused with MACHINE_OFFLINE instead of routed into a void,
  // and a machine that answers stays online for as many beats as it likes.
  it('keepalive: a machine that answers pings stays online; one that does not is reaped as gone', async () => {
    // 200 ms, not 40: under the whole-repo check a pong can arrive tens of milliseconds late,
    // and a period that tight reaped a live machine once. Production beats every 30 s.
    const relay = await startRelay({}, 200);
    const live = machine(relay.url);
    await until(() => relay.hub.stats().machines.includes(M1), 'machine registration');
    await new Promise((r) => setTimeout(r, 700)); // three beats, every one answered by ws's auto-pong
    expect(relay.hub.stats().machines).toEqual([M1]);
    live.close();
    await until(() => !relay.hub.stats().machines.length, 'the live machine to leave');
    // the dead peer: a raw machine socket with the automatic pong switched off
    const dead = new WebSocket(relay.url, { headers: { authorization: 'Bearer nmm_good' }, autoPong: false });
    open.socks.push(dead);
    await new Promise<void>((resolve) => dead.once('open', () => { dead.send(JSON.stringify({ t: 'hello', machineId: M1 })); resolve(); }));
    await until(() => relay.hub.stats().machines.includes(M1), 'the dead peer to register');
    await until(() => relay.logs.some((l) => l.startsWith('keepalive_reap')), 'the reap');
    await until(() => !relay.hub.stats().machines.length, 'machine_gone after the reap');
    expect(relay.logs.some((l) => l.startsWith(`machine_gone machine=${M1}`))).toBe(true);
    const c = await connectClient(relay.url);
    const closed = closedWith(c);
    c.send(JSON.stringify({ t: 'attach', machineId: M1, token: 'clerk-good' }));
    expect((await closed).code).toBe(CLOSE.MACHINE_OFFLINE);
  });
});
