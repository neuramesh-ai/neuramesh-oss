// the browser lane end to end, machine side: the tab's real transport (@neuramesh/relay-client), the
// real hub and the real machine edge, with a scripted browser service behind the edge. the unit tests
// on each side pass while the two disagree about a field, a base64 convention or the handshake, and this
// is the test that catches that. and a machine whose hello never named the lane never sees a browser
// open, because an older daemon would answer one with a shell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { createHub } from '@neuramesh/relay';
import { openRelayJsonChannel, resetRelay, type RelayConfig } from '@neuramesh/relay-client';
import type { BrowserOutput } from '@neuramesh/shared';
import { connectMachineEdge } from './machine-edge';
import type { BrowserService } from '../browser/service';
import type { BrowserPage, Frame } from '../browser/page';

async function relay(machineId: string) {
  const hub = createHub({
    validateMachine: async (token) => (token === 'nmm_browser' ? { machineId, workspaceId: 'w1' } : null),
    validateClient: async () => ({ allowed: true, userId: 'u-verified' }),
  });
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (sock: WsSocket, req) => hub.handleConnection(sock, req));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  const waitForMachine = async (): Promise<void> => {
    for (let i = 0; i < 400 && !hub.stats().machines.includes(machineId); i += 1) await new Promise((r) => setTimeout(r, 10));
  };
  return { url, waitForMachine, close: () => { wss.close(); server.close(); } };
}

const cfg = (url: string, machineId: string): RelayConfig => ({ relayUrl: url, clientBearer: async () => 'clerk-token', machineId: async () => machineId });

/** a browser service with one scripted person page: it records what the pane asks for */
function scripted() {
  const frames = new Set<(f: Frame) => void>();
  const asked: string[] = [];
  const page = {
    state: { url: 'https://x.com/home', title: 'Startseite · 日本語', canBack: true, canForward: false, loading: false },
    watchState: () => () => {}, onGone: () => () => {}, shrink: () => {},
    watchFrames: (fn: (f: Frame) => void) => { frames.add(fn); return () => { frames.delete(fn); }; },
    resize: async (w: number, h: number) => { asked.push(`resize ${w}x${h}`); },
    navigate: async (url: string) => { asked.push(`navigate ${url}`); return { ok: true as const }; },
    insertText: async (t: string) => { asked.push(`text ${t}`); },
  };
  const people: string[] = [];
  const svc = {
    person: async (actorId: string) => { people.push(actorId); return { page: page as unknown as BrowserPage, release: () => {} }; },
    watchAgent: (fn: (p: BrowserPage | null, a: string | null) => void) => { fn(null, null); return () => {}; },
    touch: () => {},
  } as unknown as BrowserService;
  return { svc, asked, people, push: (f: Frame) => { for (const fn of frames) fn(f); } };
}

test('a browser pane crosses the real tab transport, hub and machine edge: state, frames, acks and input', async () => {
  resetRelay();
  const machineId = 'm-browser';
  const r = await relay(machineId);
  const browser = scripted();
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_browser', machineId, browser: browser.svc, log: () => {} });
  await r.waitForMachine();
  const got: BrowserOutput[] = [];
  let wake: () => void = () => {};
  const until = (pred: () => boolean): Promise<void> => new Promise((resolve, reject) => {
    if (pred()) return resolve();
    const timer = setTimeout(() => reject(new Error(`timed out; got=${JSON.stringify(got).slice(0, 400)}`)), 4000);
    wake = () => { if (pred()) { clearTimeout(timer); resolve(); } };
  });
  const errors: string[] = [];
  const channel = openRelayJsonChannel(cfg(r.url, machineId), {
    lane: 'browser', meta: { v: 1, tab: 'person', width: 812, height: 640, actorId: 'someone-else' },
    onMessage: (m) => { got.push(m as BrowserOutput); wake(); },
    onError: (message) => errors.push(message), onExit: () => {},
  });
  try {
    await until(() => got.some((m) => m.t === 'state'));
    assert.deepEqual(got.find((m) => m.t === 'state'), { t: 'state', tab: 'person', url: 'https://x.com/home', title: 'Startseite · 日本語', canBack: true, canForward: false, loading: false });
    assert.deepEqual(browser.people, ['u-verified'], 'the person is the hub\'s verified user, never a name in the meta');
    const jpeg = Buffer.alloc(150_000, 7).toString('base64');
    browser.push({ jpeg, w: 812, h: 640 });
    await until(() => got.some((m) => m.t === 'frame'));
    const frame = got.find((m) => m.t === 'frame') as Extract<BrowserOutput, { t: 'frame' }>;
    assert.equal(frame.jpeg, jpeg);
    assert.deepEqual([frame.n, frame.w, frame.h], [1, 812, 640]);
    await channel.send({ t: 'ack', n: 1 });
    await channel.send({ t: 'navigate', url: 'https://news.ycombinator.com/' });
    await channel.send({ t: 'text', text: 'naïve 🙂' });
    for (let i = 0; i < 200 && browser.asked.length < 3; i += 1) await new Promise((res) => setTimeout(res, 10));
    assert.deepEqual(browser.asked, ['resize 812x640', 'navigate https://news.ycombinator.com/', 'text naïve 🙂']);
    assert.deepEqual(errors, []);
  } finally { channel.close(); edge.close(); r.close(); resetRelay(); }
});

test('a tab never opens the browser lane on a machine whose hello did not name it (an older daemon would start a shell)', async () => {
  resetRelay();
  const machineId = 'm-old';
  const r = await relay(machineId);
  const edge = connectMachineEdge({ relayUrl: r.url, token: 'nmm_browser', machineId, log: () => {} }); // no browser service
  await r.waitForMachine();
  const errors: string[] = [];
  let exited = false;
  openRelayJsonChannel(cfg(r.url, machineId), {
    lane: 'browser', meta: { v: 1, tab: 'person', width: 800, height: 600 },
    onMessage: () => {}, onError: (message) => errors.push(message), onExit: () => { exited = true; },
  });
  try {
    for (let i = 0; i < 200 && !exited; i += 1) await new Promise((res) => setTimeout(res, 10));
    assert.equal(exited, true);
    assert.deepEqual(errors, ['This cloud machine does not have a browser yet. It gets one at its next update.']);
    assert.equal(edge.sessionCount(), 0, 'no shell started for a lane the machine does not serve');
  } finally { edge.close(); r.close(); resetRelay(); }
});
