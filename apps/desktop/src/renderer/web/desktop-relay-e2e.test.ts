// END TO END FOR THE DESKTOP CODE BRIDGE: the real hub, the real machine edge, and the real relay
// bridge — composed the way the desktop composes it (src/bridge/desktop-relay.ts), from the three
// facts main answers over IPC, not from a browser config. If the desktop and the browser ever
// disagree about what the relay bridge needs, this is the test that says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { WebSocket as WsSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { createHub } from '@neuramesh/relay';
import { connectMachineEdge } from '../../main/relay/machine-edge';
import type { EngineeringMachineHost } from '../../main/relay/engineering-host';
import { attachDesktopRelay } from '../src/bridge/desktop-relay';
import type { NMBridge } from '../src/bridge/nm';
import { resetRelay } from '@neuramesh/relay-client';

async function waitForMachine(hub: { stats(): { machines: string[] } }, machineId: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!hub.stats().machines.includes(machineId)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for machine registration: ${machineId}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('a desktop-shaped bridge reaches an engineering host through the real hub and machine edge', async () => {
  resetRelay();
  const machineId = 'm-desktop';
  const seenBearers: string[] = [];
  const hub = createHub({
    validateMachine: async (token) => token === 'nmm_desktop' ? { machineId, workspaceId: 'w1' } : null,
    validateClient: async (bearer) => { seenBearers.push(String(bearer)); return { allowed: true, userId: 'u1' }; },
  });
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (sock: WsSocket, req) => hub.handleConnection(sock, req));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const relayUrl = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  const engineering: EngineeringMachineHost = {
    async open(meta, emit) {
      emit({ type: 'ready', provider: 'test', model: 'cline-test', cwd: `/work/${meta.repoId}`, modelId: meta.modelId ?? null, brainPack: meta.brainPack ?? null });
      return {
        command(value) {
          const command = value as { type?: string; prompt?: string };
          if (command.type === 'prompt') emit({ type: 'status', status: `received:${command.prompt}` });
        },
        close() {},
      };
    },
  };
  const edge = connectMachineEdge({ relayUrl, token: 'nmm_desktop', machineId, engineering, log: () => {} });
  await waitForMachine(hub, machineId);

  // the usage read the relay bridge resolves its target from — served by a stub API, and asked
  // with the headers MAIN handed over, which is the whole point of the desktop composition
  const seenHeaders: Array<Record<string, string>> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('http://api.test/v1/machines/usage')) {
      seenHeaders.push({ ...(init?.headers as Record<string, string>) });
      return new Response(JSON.stringify({ minutes: 0, capMinutes: null, machines: [{ id: machineId, desiredReplicas: 1, lastSeenAt: new Date().toISOString(), lastWakeAt: null, lifecycle: 'running' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(input as string, init);
  }) as typeof fetch;

  const nm = {
    relayEnv: async () => ({ relayUrl, apiUrl: 'http://api.test', workspaceId: 'w1' }),
    relayHeaders: async () => ({ 'x-nm-actor': '{"kind":"human","id":"u1"}' }),
    relayBearer: async () => 'desktop-dev-token',
  } as unknown as NMBridge;
  try {
    const out = await attachDesktopRelay(nm);
    assert.deepEqual(out.attached, ['engineeringInfo', 'openEngineering']);
    assert.deepEqual(await nm.engineeringInfo!(), { available: true });
    assert.deepEqual(seenHeaders[0], { 'x-nm-actor': '{"kind":"human","id":"u1"}' }, 'main\'s headers reached the API');

    const events: Array<Record<string, unknown>> = [];
    const got = (pred: (e: Record<string, unknown>) => boolean) => new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out; events=${JSON.stringify(events)}`)), 4000);
      const tick = () => { if (events.some(pred)) { clearTimeout(t); resolve(); } else setTimeout(tick, 10); };
      tick();
    });
    const channel = nm.openEngineering!({
      threadId: 'eng-desktop', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'plan',
      permissions: { read: true, edit: false, command: false, web: false, mcp: false },
      policy: { read: true, edit: true, command: true, web: true, mcp: true },
    } as Parameters<NonNullable<NMBridge['openEngineering']>>[0], (event) => { events.push(event as unknown as Record<string, unknown>); }, () => {});
    await got((e) => e['type'] === 'ready');
    await channel.send({ type: 'prompt', prompt: 'hello from the desktop' } as Parameters<typeof channel.send>[0]);
    await got((e) => e['status'] === 'received:hello from the desktop');
    assert.ok(seenBearers.includes('desktop-dev-token'), 'the relay saw main\'s attach credential');
    channel.close();
  } finally {
    globalThis.fetch = realFetch;
    resetRelay();
    (edge as unknown as { close?: () => void }).close?.();
    wss.close(); server.close();
  }
});
