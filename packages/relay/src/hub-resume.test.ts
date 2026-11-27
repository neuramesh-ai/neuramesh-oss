// RESUME AT THE HUB (protocol.ts, RESUME; the session round, 2026-10), over REAL ws sockets on an
// ephemeral port with the validators stubbed. A departed client detaches its sessions on a machine
// that names `resume` (and closes them on one that does not); a resume open hands a channel to the
// same person's newer socket and never to another person's; a machine that cannot resume never sees a
// resume; a client cannot speak the relay's or the machine's words; and a takeover keeps the client
// attached and tells the new machine socket which channels still have one.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createHub, type Hub, type HubOptions } from './hub.js';
import { CLOSE, toB64, type ChannelFrame, type RelayMessage } from './protocol.js';

const M1 = 'b3c1e6f2-7a4d-4e0b-9c6a-2d8f1e5a7b90';

const validators: Pick<HubOptions, 'validateMachine' | 'validateClient'> = {
  validateMachine: async (token) => (token === 'nmm_good' ? { machineId: M1, workspaceId: 'ws1' } : null),
  validateClient: async (token) => (token === 'clerk-good' ? { allowed: true, userId: 'u1' }
    : token === 'clerk-other' ? { allowed: true, userId: 'u2' } : { allowed: false }),
};

const open: { servers: Server[]; socks: WebSocket[] } = { servers: [], socks: [] };
afterEach(() => {
  for (const s of open.socks.splice(0)) s.terminate();
  for (const srv of open.servers.splice(0)) srv.close();
});

function startRelay(): Promise<{ url: string; hub: Hub; logs: string[] }> {
  const logs: string[] = [];
  const hub = createHub({ ...validators, log: (l) => logs.push(l) });
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (sock, req) => hub.handleConnection(sock, req));
  open.servers.push(server);
  return new Promise((resolve) => server.listen(0, () => resolve({ url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, hub, logs })));
}

function connect(url: string, headers?: Record<string, string>): Promise<WebSocket> {
  const sock = new WebSocket(url, { headers });
  open.socks.push(sock);
  return new Promise((resolve, reject) => { sock.once('open', () => resolve(sock)); sock.once('error', reject); });
}

/** every frame a socket receives, in order */
function collect(sock: WebSocket): RelayMessage[] {
  const got: RelayMessage[] = [];
  sock.on('message', (raw) => got.push(JSON.parse(String(raw)) as RelayMessage));
  return got;
}

async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

/** a machine socket that says hello with `lanes` and records what the relay sends it */
async function machine(r: { url: string; hub: Hub }, lanes: string[]): Promise<{ sock: WebSocket; got: RelayMessage[] }> {
  const sock = await connect(r.url, { authorization: 'Bearer nmm_good' });
  const got = collect(sock);
  sock.send(JSON.stringify({ t: 'hello', machineId: M1, lanes }));
  await until(() => r.hub.stats().machines.includes(M1), 'machine registration');
  return { sock, got };
}

/** a client socket, attached, with the attached ack as the first frame it recorded */
async function client(url: string, token = 'clerk-good'): Promise<{ sock: WebSocket; got: RelayMessage[] }> {
  const sock = await connect(url);
  const got = collect(sock);
  sock.send(JSON.stringify({ t: 'attach', machineId: M1, token }));
  await until(() => got.some((m) => m.t === 'attached'), 'attached');
  return { sock, got };
}

const frame = (sock: WebSocket, f: ChannelFrame): void => sock.send(JSON.stringify(f));
const onCh = (got: RelayMessage[], ch: string): ChannelFrame[] => got.filter((m): m is ChannelFrame => 'ch' in m && m.ch === ch);
const RESUMES = ['terminal', 'engineering', 'stream', 'resume'];
const META = { threadId: 'th1' };

describe('relay hub: resume', () => {
  it('attached names `resume` when the machine does', async () => {
    const r = await startRelay();
    await machine(r, RESUMES);
    const c = await client(r.url);
    expect(c.got[0]).toEqual({ t: 'attached', machineId: M1, lanes: RESUMES });
  });

  it('a departed client detaches its sessions on a machine that resumes; a live-reply channel still ends', async () => {
    const r = await startRelay();
    const m = await machine(r, RESUMES);
    const c = await client(r.url);
    frame(c.sock, { ch: 't1', t: 'open', cols: 80, rows: 24 });
    frame(c.sock, { ch: 'e1', t: 'open', lane: 'engineering', meta: META });
    frame(c.sock, { ch: 's1', t: 'open', lane: 'stream', meta: { v: 1 } });
    await until(() => m.got.filter((f) => f.t === 'open').length === 3, 'three opens');
    c.sock.close();
    await until(() => m.got.length === 6, 'what the close costs');
    expect(onCh(m.got, 't1').at(-1)).toEqual({ ch: 't1', t: 'detach' });
    expect(onCh(m.got, 'e1').at(-1)).toEqual({ ch: 'e1', t: 'detach' });
    expect(onCh(m.got, 's1').at(-1)).toEqual({ ch: 's1', t: 'close' });
  });

  it('on a machine that cannot resume, a departed client closes its sessions as before', async () => {
    const r = await startRelay();
    const m = await machine(r, ['terminal']);
    const c = await client(r.url);
    frame(c.sock, { ch: 't1', t: 'open', cols: 80, rows: 24 });
    await until(() => m.got.length === 1, 'the open');
    c.sock.close();
    await until(() => m.got.length === 2, 'the close');
    expect(m.got[1]).toEqual({ ch: 't1', t: 'close' });
  });

  it('a resume hands the channel to the same person\'s newer socket, and the older socket\'s close costs it nothing', async () => {
    const r = await startRelay();
    const m = await machine(r, RESUMES);
    const a = await client(r.url);
    frame(a.sock, { ch: 't1', t: 'open', cols: 80, rows: 24 });
    await until(() => m.got.length === 1, 'the open');
    // a reconnect before the relay has seen the older socket go (a half-open socket, or a rotation)
    const b = await client(r.url);
    frame(b.sock, { ch: 't1', t: 'open', cols: 80, rows: 24, resume: true, from: 5, actorId: 'forged' });
    await until(() => m.got.length === 2, 'the resume open');
    expect(m.got[1]).toMatchObject({ ch: 't1', t: 'open', resume: true, from: 5, actorId: 'u1' });
    expect(r.logs.some((l) => l.startsWith('resume_handover') && l.includes('ch=t1'))).toBe(true);
    // the machine's frames now reach the newer socket only
    frame(m.sock, { ch: 't1', t: 'resumed', o: 5, dropped: 0 });
    frame(m.sock, { ch: 't1', t: 'data', d: toB64('after'), o: 5 });
    await until(() => onCh(b.got, 't1').length === 2, 'the frames at the newer socket');
    expect(onCh(b.got, 't1')).toEqual([{ ch: 't1', t: 'resumed', o: 5, dropped: 0 }, { ch: 't1', t: 'data', d: toB64('after'), o: 5 }]);
    expect(onCh(a.got, 't1')).toEqual([]);
    // the newer socket's input reaches the machine
    frame(b.sock, { ch: 't1', t: 'data', d: toB64('ls\r') });
    await until(() => m.got.length === 3, 'the input');
    a.sock.close();
    await settle();
    expect(m.got.length, 'no detach and no close for a channel that moved').toBe(3);
  });

  it('another person never takes a channel by resume', async () => {
    const r = await startRelay();
    const m = await machine(r, RESUMES);
    const a = await client(r.url);
    frame(a.sock, { ch: 't1', t: 'open', cols: 80, rows: 24 });
    await until(() => m.got.length === 1, 'the open');
    const other = await client(r.url, 'clerk-other');
    frame(other.sock, { ch: 't1', t: 'open', resume: true, from: 0 });
    await until(() => onCh(other.got, 't1').length === 1, 'the refusal');
    expect(onCh(other.got, 't1')[0]).toEqual({ ch: 't1', t: 'close' });
    await settle();
    expect(m.got.length, 'the machine never heard it').toBe(1);
  });

  it('a resume to a machine that cannot resume is refused with a reason, never forwarded (it would start a second shell)', async () => {
    const r = await startRelay();
    const m = await machine(r, ['terminal', 'engineering']);
    const c = await client(r.url);
    frame(c.sock, { ch: 't1', t: 'open', resume: true, from: 0 });
    await until(() => onCh(c.got, 't1').length === 1, 'the refusal');
    expect(onCh(c.got, 't1')[0]).toEqual({ ch: 't1', t: 'close', reason: 'This machine cannot resume a session. Open it again.' });
    await settle();
    expect(m.got).toEqual([]);
  });

  it('a client cannot speak the relay\'s or the machine\'s words', async () => {
    const r = await startRelay();
    const m = await machine(r, RESUMES);
    const c = await client(r.url);
    frame(c.sock, { ch: 't1', t: 'open', cols: 80, rows: 24 });
    await until(() => m.got.length === 1, 'the open');
    frame(c.sock, { ch: 't1', t: 'detach' });
    frame(c.sock, { ch: 't1', t: 'resumed', o: 0, dropped: 0 });
    await settle();
    expect(m.got.length).toBe(1);
    expect(r.logs.filter((l) => l.startsWith('drop_client_frame')).length).toBe(2);
  });

  it('a takeover keeps the client attached, tells the new socket which channels still have one, and frames flow through it', async () => {
    const r = await startRelay();
    const m1 = await machine(r, RESUMES);
    const c = await client(r.url);
    frame(c.sock, { ch: 't1', t: 'open', cols: 80, rows: 24 });
    frame(c.sock, { ch: 'e1', t: 'open', lane: 'engineering', meta: META });
    frame(c.sock, { ch: 's1', t: 'open', lane: 'stream', meta: { v: 1 } });
    await until(() => m1.got.length === 3, 'three opens');
    const oldClosed = new Promise<number>((resolve) => m1.sock.once('close', (code) => resolve(code)));
    const m2 = await connect(r.url, { authorization: 'Bearer nmm_good' });
    const got2 = collect(m2);
    m2.send(JSON.stringify({ t: 'hello', machineId: M1, lanes: RESUMES }));
    expect(await oldClosed).toBe(CLOSE.TAKEOVER);
    await until(() => got2.length === 3, 'the channels that still have a client');
    expect(got2).toEqual(expect.arrayContaining([
      { ch: 't1', t: 'open', resume: true, actorId: 'u1' },
      { ch: 'e1', t: 'open', resume: true, lane: 'engineering', actorId: 'u1' },
      { ch: 's1', t: 'open', resume: true, lane: 'stream', actorId: 'u1' },
    ]));
    frame(m2, { ch: 't1', t: 'resumed', o: 3, dropped: 0 });
    frame(m2, { ch: 't1', t: 'data', d: toB64('new'), o: 3 });
    await until(() => onCh(c.got, 't1').length === 2, 'the new socket\'s frames at the client');
    frame(c.sock, { ch: 't1', t: 'data', d: toB64('x') });
    await until(() => got2.some((f) => f.t === 'data'), 'the client\'s input at the new socket');
    expect(c.sock.readyState).toBe(WebSocket.OPEN);
  });

  it('a machine that cannot resume hears nothing more on a takeover', async () => {
    const r = await startRelay();
    const m1 = await machine(r, ['terminal']);
    const c = await client(r.url);
    frame(c.sock, { ch: 't1', t: 'open', cols: 80, rows: 24 });
    await until(() => m1.got.length === 1, 'the open');
    const m2 = await connect(r.url, { authorization: 'Bearer nmm_good' });
    const got2 = collect(m2);
    m2.send(JSON.stringify({ t: 'hello', machineId: M1, lanes: ['terminal'] }));
    await until(() => r.logs.some((l) => l.startsWith('takeover')), 'the takeover');
    await settle();
    expect(got2).toEqual([]);
  });
});
