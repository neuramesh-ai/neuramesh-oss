// The hub as one shard among two (shard.ts, HubOptions.shard): who it refuses, with what, and who it
// still serves. Real ws sockets on an ephemeral port, validators stubbed, as in hub.test.ts.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createHub, type Hub, type HubOptions } from './hub.js';
import { connectEchoMachine, type MachineClient } from './machine-client.js';
import { CLOSE, type MachineLane, type RelayMessage } from './protocol.js';
import { shardIndexFor } from './shard.js';

// 'a' hashes to shard 0 of 2 and 'm-e2e' to shard 1 (shard.test.ts pins both)
const HOME = 'a';
const AWAY = 'm-e2e';
const SHARD1 = 'ws://shard-1.invalid';

const open: { servers: Server[]; socks: WebSocket[]; machines: MachineClient[] } = { servers: [], socks: [], machines: [] };
afterEach(() => {
  for (const m of open.machines.splice(0)) m.close();
  for (const s of open.socks.splice(0)) s.close();
  for (const srv of open.servers.splice(0)) srv.close();
});

interface Relay { url: string; hub: Hub; logs: string[]; clientChecks: string[] }

/** shard 0 of [this hub, SHARD1] unless `shard` says otherwise ('none' = no shard list at all) */
async function startShard0(shard?: HubOptions['shard'] | 'none'): Promise<Relay> {
  const logs: string[] = [];
  const clientChecks: string[] = [];
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const hub = createHub({
    // the token names the machine: nmm_<id>
    validateMachine: async (token) => ({ machineId: token.slice(4), workspaceId: 'ws1' }),
    validateClient: async (_token, machineId) => { clientChecks.push(machineId); return { allowed: true, userId: 'u1' }; },
    log: (l) => logs.push(l),
    ...(shard === 'none' ? {} : { shard: shard ?? { index: 0, urls: [url, SHARD1] } }),
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (sock, req) => hub.handleConnection(sock, req));
  open.servers.push(server);
  return { url, hub, logs, clientChecks };
}

const closedWith = (sock: WebSocket): Promise<{ code: number; reason: string }> =>
  new Promise((resolve) => sock.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
const nextMessage = (sock: WebSocket): Promise<RelayMessage> =>
  new Promise((resolve) => sock.once('message', (raw) => resolve(JSON.parse(String(raw)) as RelayMessage)));

async function client(url: string): Promise<WebSocket> {
  const sock = new WebSocket(url);
  open.socks.push(sock);
  await new Promise<void>((resolve, reject) => { sock.once('open', () => resolve()); sock.once('error', reject); });
  return sock;
}

function machine(url: string, machineId: string, lanes?: MachineLane[]): MachineClient {
  const m = connectEchoMachine({ relayUrl: url, token: `nmm_${machineId}`, machineId, ...(lanes ? { lanes } : {}) });
  open.machines.push(m);
  return m;
}

async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe('a relay shard', () => {
  it('the fixtures sit where this file says', () => {
    expect(shardIndexFor(HOME, 2)).toBe(0);
    expect(shardIndexFor(AWAY, 2)).toBe(1);
  });

  it('refuses a browser for a machine on another shard with 4421 and that shard, before any credential is checked', async () => {
    const r = await startShard0();
    const c = await client(r.url);
    const closed = closedWith(c);
    c.send(JSON.stringify({ t: 'attach', machineId: AWAY, token: 'clerk-good' }));
    expect(await closed).toEqual({ code: CLOSE.WRONG_SHARD, reason: `shard 1/2 ${SHARD1}` });
    expect(r.clientChecks).toEqual([]);
    expect(r.logs).toContain(`refuse_wrong_shard machine=${AWAY} home=1`);
  });

  it('serves a browser for a machine that lives here', async () => {
    const r = await startShard0();
    machine(r.url, HOME, ['terminal', 'shard']);
    await until(() => r.hub.stats().machines.includes(HOME), 'the home machine');
    const c = await client(r.url);
    const ack = nextMessage(c);
    c.send(JSON.stringify({ t: 'attach', machineId: HOME, token: 'clerk-good' }));
    expect(await ack).toMatchObject({ t: 'attached', machineId: HOME });
    expect(r.clientChecks).toEqual([HOME]);
  });

  it('a machine that lives here and is offline is 4404, not a refusal', async () => {
    const r = await startShard0();
    const c = await client(r.url);
    const closed = closedWith(c);
    c.send(JSON.stringify({ t: 'attach', machineId: HOME, token: 'clerk-good' }));
    expect((await closed).code).toBe(CLOSE.MACHINE_OFFLINE);
  });

  it('refuses a machine that names `shard` on the wrong shard, so it dials its own', async () => {
    const r = await startShard0();
    const m = machine(r.url, AWAY, ['terminal', 'resume', 'shard']);
    expect(await closedWith(m.sock)).toEqual({ code: CLOSE.WRONG_SHARD, reason: `shard 1/2 ${SHARD1}` });
    expect(r.hub.stats().machines).toEqual([]);
    expect(r.logs).toContain(`refuse_machine_wrong_shard machine=${AWAY} home=1`);
  });

  it('serves an older machine where it is, since it cannot follow, and a browser that dials here meets it', async () => {
    const r = await startShard0();
    machine(r.url, AWAY, ['terminal', 'resume']);
    await until(() => r.hub.stats().machines.includes(AWAY), 'the older machine');
    expect(r.logs.some((l) => l.startsWith(`machine_off_shard machine=${AWAY} home=1`))).toBe(true);
    const c = await client(r.url);
    const ack = nextMessage(c);
    c.send(JSON.stringify({ t: 'attach', machineId: AWAY, token: 'clerk-good' }));
    expect(await ack).toMatchObject({ t: 'attached', machineId: AWAY });
  });

  it('without a shard list, or with a list of one, it refuses nobody', async () => {
    for (const shard of ['none' as const, { index: 0, urls: ['ws://only'] }]) {
      const r = await startShard0(shard);
      machine(r.url, AWAY, ['terminal', 'shard']);
      await until(() => r.hub.stats().machines.includes(AWAY), 'the machine');
      const c = await client(r.url);
      const ack = nextMessage(c);
      c.send(JSON.stringify({ t: 'attach', machineId: AWAY, token: 'clerk-good' }));
      expect(await ack).toMatchObject({ t: 'attached', machineId: AWAY });
    }
  });
});
