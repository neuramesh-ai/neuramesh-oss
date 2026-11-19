// THE DESKTOP CODE PANE ACROSS A RELAY DROP (round 6): the desktop's relay lanes (relay-lanes.ts, the
// copy of hq's webnm-relay.ts) through the real hub, the real machine edge and the real relay client.
//   · a drop longer than a moment says the same two lines hq's Code pane says, as notices
//   · a command sent in the instant after a cut goes into the dead socket and never reaches the
//     machine (the lane has no command id to resend by), so the pane says it may not have arrived
//   · a command the machine answered before the cut earns no such line
// Run: pnpm exec tsx --test src/renderer/src/bridge/relay-lanes-resume.test.ts
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { createHub } from '@neuramesh/relay';
import { resetRelay } from '@neuramesh/relay-client';
import { CODE_COMMAND_MAY_BE_LOST, CODE_RECONNECTING, createCommandGapWatch, type EngineeringCommand } from '@neuramesh/shared';
import { connectMachineEdge } from '../../../main/relay/machine-edge';
import type { EngineeringMachineHost } from '../../../main/relay/engineering-host';
import { relayOverrides } from './relay-lanes';

const brain = mkdtempSync(join(tmpdir(), 'nm-lanes-resume-'));
process.env['NM_BRAIN'] = brain;
after(() => { resetRelay(); rmSync(brain, { recursive: true, force: true }); });

const MACHINE = 'm-lanes';

async function until(cond: () => boolean, what: string, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function hubOn(port = 0) {
  const hub = createHub({
    validateMachine: async (token) => token === 'nmm_lanes' ? { machineId: MACHINE, workspaceId: 'w1' } : null,
    validateClient: async () => ({ allowed: true, userId: 'u1' }),
    log: () => {},
  });
  const server = createServer();
  const wss = new WebSocketServer({ server });
  const clients: WsSocket[] = [];
  wss.on('connection', (sock: WsSocket, req: IncomingMessage) => {
    if (!req.headers.authorization) clients.push(sock);
    hub.handleConnection(sock, req);
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const bound = (server.address() as { port: number }).port;
  return {
    hub, clients, port: bound, url: `ws://127.0.0.1:${bound}`,
    stop: async (): Promise<void> => {
      for (const s of wss.clients) s.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** a Code host that answers a prompt with a status, except the word `quiet` */
function codeHost() {
  const commands: Array<{ type?: string; prompt?: string }> = [];
  const engineering: EngineeringMachineHost = {
    open: async (_meta, emit) => ({
      command: (v) => {
        const c = v as { type?: string; prompt?: string };
        commands.push(c);
        if (c.type === 'prompt' && c.prompt !== 'quiet') emit({ type: 'status', status: `got:${c.prompt}` });
      },
      close: () => {},
    }),
  };
  return { engineering, commands };
}

const realFetch = globalThis.fetch;
function lanes(url: string) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u.startsWith('http://api.test/v1/machines/usage')) {
      return new Response(JSON.stringify({ machines: [{ id: MACHINE, name: 'runner', desiredReplicas: 1, lastSeenAt: new Date().toISOString(), lastWakeAt: null, lifecycle: 'running' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(input as string, init);
  }) as typeof fetch;
  return relayOverrides({ apiUrl: 'http://api.test', workspaceId: () => 'w1', authHeaders: async () => ({}), relayBearer: async () => 'dev-token' }, url);
}

const META = {
  threadId: 'th-lanes', repoId: 'r1', repoName: 'app', branch: 'main', mode: 'act',
  permissions: { read: true, edit: true, command: true, web: true, mcp: true }, policy: { read: true, edit: true, command: true, web: true, mcp: true },
};
const notices = (events: Array<Record<string, unknown>>): string[] => events.flatMap((e) => {
  const inner = ((e['event'] as Record<string, unknown> | undefined)?.['payload'] as Record<string, unknown> | undefined)?.['event'] as Record<string, unknown> | undefined;
  return e['type'] === 'agent_event' && inner?.['type'] === 'notice' ? [String(inner['message'])] : [];
});

test('a drop longer than a moment: the desktop Code pane says hq\'s two lines, as notices, and the session carries on', async () => {
  resetRelay();
  let r = await hubOn();
  const host = codeHost();
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_lanes', machineId: MACHINE, engineering: host.engineering, log: () => {} });
  try {
    await until(() => r.hub.stats().machines.includes(MACHINE), 'the machine on the relay');
    const nm = lanes(r.url);
    const events: Array<Record<string, unknown>> = [];
    let exited = false;
    const h = nm.openEngineering!(META as never, (e) => events.push(e as Record<string, unknown>), () => { exited = true; });
    await h.send({ type: 'prompt', prompt: 'one' });
    await until(() => events.some((e) => e['status'] === 'got:one'), 'the first answer');
    const port = r.port;
    await r.stop();
    await new Promise((res) => setTimeout(res, 2_500)); // past the client's 2 s before it says anything
    r = await hubOn(port);
    await until(() => notices(events).includes('Reconnected.'), 'the end of the drop said', 20_000);
    assert.deepEqual(notices(events).slice(0, 2), [CODE_RECONNECTING, 'Reconnected.']);
    assert.equal(exited, false);
    await h.send({ type: 'prompt', prompt: 'two' });
    await until(() => events.some((e) => e['status'] === 'got:two'), 'the session answers after the drop');
    assert.ok(!notices(events).includes(CODE_COMMAND_MAY_BE_LOST), 'every command before the drop was answered');
    h.close();
  } finally { globalThis.fetch = realFetch; resetRelay(); edge.close(); await r.stop(); }
});

test('a command sent in the instant after a cut never reaches the machine, and the pane says to send it again', async () => {
  resetRelay();
  const r = await hubOn();
  const host = codeHost();
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_lanes', machineId: MACHINE, engineering: host.engineering, log: () => {} });
  try {
    await until(() => r.hub.stats().machines.includes(MACHINE), 'the machine on the relay');
    const nm = lanes(r.url);
    const events: Array<Record<string, unknown>> = [];
    const h = nm.openEngineering!(META as never, (e) => events.push(e as Record<string, unknown>), () => {});
    await h.send({ type: 'prompt', prompt: 'one' });
    await until(() => events.some((e) => e['status'] === 'got:one'), 'the first answer');
    // the cut, and a send in the same tick: this client has not seen the close yet
    r.clients.at(-1)!.terminate();
    const lost = h.send({ type: 'prompt', prompt: 'lost' });
    await lost;
    await until(() => notices(events).includes(CODE_COMMAND_MAY_BE_LOST), 'the note after the resume');
    assert.ok(!host.commands.some((c) => c.prompt === 'lost'), 'the machine never heard it: there is nothing to resend by');
    // the person sends it again, and it arrives
    await h.send({ type: 'prompt', prompt: 'again' });
    await until(() => events.some((e) => e['status'] === 'got:again'), 'the resent command answered');
    assert.equal(notices(events).filter((n) => n === CODE_COMMAND_MAY_BE_LOST).length, 1);
    h.close();
  } finally { globalThis.fetch = realFetch; resetRelay(); edge.close(); await r.stop(); }
});

test('the gap watch: only a meant command with no machine event after it, inside the window, is reported', () => {
  let now = 0;
  const w = createCommandGapWatch({ now: () => now, windowMs: 30_000 });
  const prompt: EngineeringCommand = { type: 'prompt', prompt: 'x' };
  assert.equal(w.resumed(), false, 'nothing sent');
  w.sent(prompt); now = 1_000;
  assert.equal(w.resumed(), true);
  assert.equal(w.resumed(), false, 'said once');
  w.sent(prompt); w.received();
  assert.equal(w.resumed(), false, 'the machine answered after it');
  w.sent({ type: 'attachment_chunk', id: 'a', index: 0, data: '' });
  assert.equal(w.resumed(), false, 'an upload part has its own ack');
  w.sent({ type: 'approval', approvalId: 'p1', approved: true }); now = 40_000;
  assert.equal(w.resumed(), false, 'older than the window: a quiet machine, not a lost command');
});
