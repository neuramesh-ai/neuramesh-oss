// THE MACHINE SIDE OF THE RELAY SHARDS, END TO END (gate A2, @neuramesh/relay shard.ts): two real hubs,
// each told the shard list and its own index, the real machine edge with a fake pty (CI builds no
// node-pty), and the real browser client. A machine given the list dials its own shard and nothing is
// refused. A machine stamped with the wrong shard (a pool from before the list grew) is refused with
// 4421, follows the shard the refusal names, and a browser that dials by the list reaches its shell.
// Run: pnpm exec tsx --test src/main/relay/relay-shard-e2e.test.ts
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { createHub, shardIndexFor, type Hub } from '@neuramesh/relay';
import { openRelayPty, resetRelay, type RelayConfig } from '@neuramesh/relay-client';
import { connectMachineEdge, type PtyLike, type SpawnPty } from './machine-edge';

const brain = mkdtempSync(join(tmpdir(), 'nm-relay-shard-'));
process.env['NM_BRAIN'] = brain;

// the pinned vectors (packages/relay/src/shard.test.ts) put these on shard 0 and shard 1 of two
const ON_0 = 'm-shard-0';
const ON_1 = 'm-shard-1';

const servers: Array<{ server: Server; wss: WebSocketServer }> = [];
after(() => {
  resetRelay();
  for (const { server, wss } of servers.splice(0)) { for (const c of wss.clients) c.terminate(); wss.close(); server.close(); }
  rmSync(brain, { recursive: true, force: true });
});

async function until(cond: () => boolean, what: string, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface Shard { url: string; hub: Hub; logs: string[] }

/** two hubs, shard 0 and shard 1, each told the true list */
async function twoShards(): Promise<[Shard, Shard]> {
  const made = await Promise.all([0, 1].map(async () => {
    const server = createServer();
    const wss = new WebSocketServer({ server });
    servers.push({ server, wss });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return { server, wss, url: `ws://127.0.0.1:${(server.address() as { port: number }).port}` };
  }));
  const urls = made.map((m) => m.url);
  const shards = made.map(({ wss, url }, index) => {
    const logs: string[] = [];
    const hub = createHub({
      // the token names the machine: nmm_<id>
      validateMachine: async (token) => ({ machineId: token.slice(4), workspaceId: 'w1' }),
      validateClient: async () => ({ allowed: true, userId: 'u1' }),
      log: (l) => logs.push(l),
      shard: { index, urls },
    });
    wss.on('connection', (sock: WsSocket, req) => hub.handleConnection(sock, req));
    return { url, hub, logs };
  });
  return [shards[0]!, shards[1]!];
}

const spawnPty: SpawnPty = () => {
  let data: (d: string) => void = () => {};
  const pty: PtyLike = {
    onData: (cb) => { data = cb; setTimeout(() => cb('nm $ '), 0); },
    onExit: () => {},
    write: (d) => data(d),
    resize: () => {},
    kill: () => {},
  };
  return pty;
};

function pane() {
  const state = { raw: '', exited: false };
  return { state, onData: (d: string): void => { state.raw += d; }, onExit: (): void => { state.exited = true; } };
}

const cfg = (relayUrl: string, machineId: string): RelayConfig => ({ relayUrl, clientBearer: async () => 'tok', machineId: async () => machineId });

test('the fixtures sit on the shards this file says', () => {
  assert.equal(shardIndexFor(ON_0, 2), 0);
  assert.equal(shardIndexFor(ON_1, 2), 1);
});

test('a machine given the shard list dials its own shard, and a browser with the list reaches its shell, with no refusal anywhere', async () => {
  resetRelay();
  const [s0, s1] = await twoShards();
  const list = `${s0.url},${s1.url}`;
  const lines: string[] = [];
  const edges = [ON_0, ON_1].map((id) => connectMachineEdge({ relayUrl: list, token: `nmm_${id}`, machineId: id, spawnPty, log: (l) => lines.push(`${id} ${l}`) }));
  try {
    await until(() => s0.hub.stats().machines.includes(ON_0) && s1.hub.stats().machines.includes(ON_1), 'each machine on its shard');
    assert.deepEqual(s0.hub.stats().machines, [ON_0]);
    assert.deepEqual(s1.hub.stats().machines, [ON_1]);
    const p0 = pane();
    const p1 = pane();
    const t0 = openRelayPty(cfg(list, ON_0), { cols: 80, rows: 24, onData: p0.onData, onExit: p0.onExit });
    const t1 = openRelayPty(cfg(list, ON_1), { cols: 80, rows: 24, onData: p1.onData, onExit: p1.onExit });
    await until(() => p0.state.raw.includes('nm $ ') && p1.state.raw.includes('nm $ '), 'both prompts');
    t1.input('ON_SHARD_ONE');
    await until(() => p1.state.raw.includes('ON_SHARD_ONE'), 'the keystroke echoed by shard 1\'s machine');
    assert.ok(!p0.state.raw.includes('ON_SHARD_ONE'));
    assert.deepEqual([...s0.logs, ...s1.logs].filter((l) => l.includes('wrong_shard')), []);
    t0.close();
    t1.close();
  } finally { resetRelay(); for (const e of edges) e.close(); }
});

test('a machine stamped with the wrong shard is refused with 4421, follows the named shard, and its browser finds it there', async () => {
  resetRelay();
  const [s0, s1] = await twoShards();
  const lines: string[] = [];
  // the stamp from before the list grew: one relay, which is shard 0 now
  const edge = connectMachineEdge({ relayUrl: s0.url, token: `nmm_${ON_1}`, machineId: ON_1, spawnPty, log: (l) => lines.push(l) });
  try {
    await until(() => s1.hub.stats().machines.includes(ON_1), 'the machine on its own shard');
    assert.ok(s0.logs.includes(`refuse_machine_wrong_shard machine=${ON_1} home=1`), s0.logs.join('\n'));
    assert.deepEqual(s0.hub.stats().machines, []);
    assert.ok(lines.some((l) => l === `wrong shard: ${s0.url} sent this machine to ${s1.url}`), lines.join('\n'));
    // it moved at once, not after the redial backoff
    assert.ok(lines.includes('redialling its own shard now'), lines.join('\n'));
    const p = pane();
    const t = openRelayPty(cfg(`${s0.url},${s1.url}`, ON_1), { cols: 80, rows: 24, onData: p.onData, onExit: p.onExit });
    await until(() => p.state.raw.includes('nm $ '), 'the prompt through shard 1');
    t.close();
  } finally { resetRelay(); edge.close(); }
});
