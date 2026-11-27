// A MESSAGE BOARDS TOKEN BUYS NOTHING ON THE RELAY (docs/design/message-boards-2026-11/plan.md §7.5).
// A socket whose bearer starts with nmbd_ closes at once with the unauthorized code: it holds no
// pending slot, it never becomes a machine or a browser socket, and control-api is never asked.
// Over real ws sockets, the hub-deadline.test.ts way.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createHub, type Hub, type HubOptions } from './hub.js';
import { CLOSE } from './protocol.js';

const M1 = '3c9f8a04-8d2e-4d7b-9a51-0f6f0e1c2ab3';
// the shape of a real one (nmbd_<lookup 8>_<secret 36>), and plainly not one
const BOARD_TOKEN = `nmbd_${'a'.repeat(8)}_${'b'.repeat(36)}`;
const open: { servers: Server[]; socks: WebSocket[] } = { servers: [], socks: [] };

function startRelay(overrides: Partial<HubOptions> = {}): Promise<{ url: string; hub: Hub; asked: string[]; lines: string[] }> {
  const asked: string[] = [];
  const lines: string[] = [];
  const hub = createHub({
    validateMachine: async (token) => { asked.push(`machine:${token}`); return token === 'nmm_good' ? { machineId: M1, workspaceId: 'ws1' } : null; },
    validateClient: async (token) => { asked.push(`client:${token}`); return { allowed: false }; },
    log: (line) => lines.push(line),
    ...overrides,
  });
  const server = createServer();
  new WebSocketServer({ server }).on('connection', (sock, req) => hub.handleConnection(sock, req));
  open.servers.push(server);
  return new Promise((resolve) => server.listen(0, () => resolve({ url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, hub, asked, lines })));
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
  for (const s of open.socks.splice(0)) s.close();
  for (const srv of open.servers.splice(0)) srv.close();
});

describe('a Message boards token on the relay', () => {
  it('closes the socket at once with the unauthorized code, and control-api is never asked', async () => {
    const r = await startRelay({ attachDeadlineMs: 5_000 });
    for (const authorization of [`Bearer ${BOARD_TOKEN}`, `bearer ${BOARD_TOKEN}`, 'Bearer nmbd_x']) {
      const sock = await connect(r.url, { authorization });
      expect(await closedWith(sock)).toEqual({ code: CLOSE.UNAUTHORIZED, reason: 'a Message boards token does not work on the relay' });
    }
    expect(r.asked).toEqual([]);
    expect(r.hub.pending()).toBe(0);
    expect(r.hub.stats()).toEqual({ machines: [], clients: 0 });
    // the log says that it refused, and never what it refused
    expect(r.lines).toEqual(['refuse_board_token', 'refuse_board_token', 'refuse_board_token']);
  });

  it('holds no pending slot: with the cap full, it still closes as unauthorized, not as busy', async () => {
    const r = await startRelay({ attachDeadlineMs: 5_000, maxPending: 1 });
    await connect(r.url);
    await until(() => r.hub.pending() === 1, 'one pending socket');
    // a socket with no token meets the cap
    expect(await closedWith(await connect(r.url))).toMatchObject({ code: CLOSE.VALIDATE_UNAVAILABLE });
    const board = await connect(r.url, { authorization: `Bearer ${BOARD_TOKEN}` });
    expect(await closedWith(board)).toMatchObject({ code: CLOSE.UNAUTHORIZED });
    expect(r.hub.pending()).toBe(1);
  });

  it('a board token in a browser attach is no credential either: control-api answers, and the socket closes', async () => {
    const r = await startRelay({ attachDeadlineMs: 5_000 });
    const sock = await connect(r.url);
    sock.send(JSON.stringify({ t: 'attach', machineId: M1, token: BOARD_TOKEN }));
    expect(await closedWith(sock)).toMatchObject({ code: CLOSE.FORBIDDEN });
  });

  it('leaves a machine token to the machine lane', async () => {
    const r = await startRelay({ attachDeadlineMs: 5_000 });
    await connect(r.url, { authorization: 'Bearer nmm_good' });
    await until(() => r.asked.includes('machine:nmm_good'), 'the machine validation');
    expect(r.hub.pending()).toBe(1);
  });
});
