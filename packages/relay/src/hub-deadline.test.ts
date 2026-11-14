// AN UNIDENTIFIED SOCKET HAS A DEADLINE (R10 lane A, NM-007). Before: a socket that never sent its
// attach (or a machine that never said hello) was held forever, so idle connections could fill a
// shard's socket budget and keep every machine and browser off the relay. Over real ws sockets.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createHub, type Hub, type HubOptions } from './hub.js';
import { connectEchoMachine, type MachineClient } from './machine-client.js';
import { CLOSE } from './protocol.js';

const M1 = '3c9f8a04-8d2e-4d7b-9a51-0f6f0e1c2ab3';
const validators: Pick<HubOptions, 'validateMachine' | 'validateClient'> = {
  validateMachine: async (token) => (token === 'nmm_good' ? { machineId: M1, workspaceId: 'ws1' } : null),
  validateClient: async (token) => (token === 'clerk-good' ? { allowed: true, userId: 'u1' } : { allowed: false }),
};
const open: { servers: Server[]; socks: WebSocket[]; machines: MachineClient[] } = { servers: [], socks: [], machines: [] };

function startRelay(overrides: Partial<HubOptions>): Promise<{ url: string; hub: Hub }> {
  const hub = createHub({ ...validators, ...overrides });
  const server = createServer();
  new WebSocketServer({ server }).on('connection', (sock, req) => hub.handleConnection(sock, req));
  open.servers.push(server);
  return new Promise((resolve) => server.listen(0, () => resolve({ url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, hub })));
}
function connect(url: string, headers?: Record<string, string>): Promise<WebSocket> {
  const sock = new WebSocket(url, { headers });
  open.socks.push(sock);
  return new Promise((resolve, reject) => { sock.once('open', () => resolve(sock)); sock.once('error', reject); });
}
const closedWith = (sock: WebSocket): Promise<{ code: number; reason: string }> =>
  new Promise((resolve) => sock.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 300; i++) { if (cond()) return; await sleep(10); }
  throw new Error(`timed out waiting for ${what}`);
}

afterEach(() => {
  for (const m of open.machines.splice(0)) m.close();
  for (const s of open.socks.splice(0)) s.close();
  for (const srv of open.servers.splice(0)) srv.close();
});

describe('unidentified sockets', () => {
  it('a browser socket that never attaches is closed at the deadline', async () => {
    const r = await startRelay({ attachDeadlineMs: 150 });
    const idle = await connect(r.url);
    const closed = await closedWith(idle);
    expect(closed).toEqual({ code: CLOSE.VALIDATE_UNAVAILABLE, reason: 'attach timeout, try again' });
    expect(r.hub.pending()).toBe(0);
  });

  it('a machine socket that authenticates but never says hello is closed at the deadline', async () => {
    const r = await startRelay({ attachDeadlineMs: 150 });
    const silent = await connect(r.url, { authorization: 'Bearer nmm_good' });
    expect(await closedWith(silent)).toEqual({ code: CLOSE.VALIDATE_UNAVAILABLE, reason: 'attach timeout, try again' });
  });

  it('an attached browser and a registered machine outlive the deadline', async () => {
    const r = await startRelay({ attachDeadlineMs: 150 });
    const m = connectEchoMachine({ relayUrl: r.url, token: 'nmm_good', machineId: M1 });
    open.machines.push(m);
    await until(() => r.hub.stats().machines.includes(M1), 'machine registration');
    const c = await connect(r.url);
    const ack = new Promise((resolve) => c.once('message', (raw) => resolve(JSON.parse(String(raw)))));
    c.send(JSON.stringify({ t: 'attach', machineId: M1, token: 'clerk-good' }));
    expect(await ack).toMatchObject({ t: 'attached', machineId: M1 });
    await sleep(400);
    expect(c.readyState).toBe(WebSocket.OPEN);
    expect(r.hub.stats().machines).toContain(M1);
    expect(r.hub.pending()).toBe(0);
  });

  it('refuses more unidentified sockets than the cap with 1013, and frees the slot when one goes', async () => {
    const r = await startRelay({ attachDeadlineMs: 5_000, maxPending: 2 });
    const a = await connect(r.url);
    await connect(r.url);
    await until(() => r.hub.pending() === 2, 'two pending');
    const third = await connect(r.url);
    expect(await closedWith(third)).toMatchObject({ code: CLOSE.VALIDATE_UNAVAILABLE });
    a.close();
    await until(() => r.hub.pending() === 1, 'a freed slot');
    const fourth = await connect(r.url);
    await sleep(100);
    expect(fourth.readyState).toBe(WebSocket.OPEN);
  });
});
