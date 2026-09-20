// THE HALF-OPEN SOCKET (2026-09-19). In production the load balancer closed the machine's idle
// relay socket at its 3600 s timeout; the relay logged machine_gone, the daemon never saw a close,
// and every browser terminal on a green machine answered "asleep" for hours. The edge now pings
// every keepalive period and terminates a socket that misses a pong, which is the close event
// its redial loop waits for. A relay that answers pongs keeps the socket for as long as it likes.
// Run: pnpm exec tsx --test src/main/relay/machine-edge-keepalive.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { connectMachineEdge } from './machine-edge';

async function until(cond: () => boolean, what: string, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** a relay stand-in: `autoPong: false` is the load balancer's silence, not a real relay's */
async function relay(autoPong: boolean): Promise<{ url: string; hellos: number; socks: WsSocket[]; close(): void }> {
  const server = createServer();
  const wss = new WebSocketServer({ server, autoPong });
  const state = { url: '', hellos: 0, socks: [] as WsSocket[], close: () => { for (const s of state.socks) s.terminate(); wss.close(); server.close(); } };
  wss.on('connection', (sock: WsSocket) => {
    state.socks.push(sock);
    sock.on('message', () => { state.hellos += 1; });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  state.url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  return state;
}

test('a relay that answers pings keeps the socket: no redial', async () => {
  const r = await relay(true);
  const logs: string[] = [];
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', keepaliveMs: 30, log: (l) => logs.push(l) });
  try {
    await until(() => r.hellos === 1, 'the hello');
    await new Promise((res) => setTimeout(res, 200)); // six beats
    assert.equal(r.hellos, 1, 'one dial, one hello');
    assert.ok(!logs.some((l) => l.startsWith('keepalive')), `no keepalive verdict: ${logs.join(' | ')}`);
  } finally { edge.close(); r.close(); }
});

test('a peer that stops answering is terminated and the edge redials', async () => {
  const r = await relay(false);
  const logs: string[] = [];
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_t', machineId: 'm1', keepaliveMs: 30, log: (l) => logs.push(l) });
  try {
    await until(() => r.hellos === 1, 'the first hello');
    await until(() => logs.some((l) => l.startsWith('keepalive: no pong')), 'the watchdog');
    await until(() => logs.some((l) => /disconnected code=\d+; redialling/.test(l)), 'the close and the redial plan');
    await until(() => r.hellos >= 2, 'the redial\'s hello', 6000);
  } finally { edge.close(); r.close(); }
});
