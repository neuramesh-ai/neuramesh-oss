// WHEN A JSON LANE HEARS `onDisconnect` (the upstream 2026-11 relay-client signal, merged with the session round).
// Upstream fires it on every socket close, and shared/engineering/remote.ts then marks a streaming Code session
// failed. On Cloud Run every relay socket ends within the hour, so here it fires only when the connection is gone
// for good: a drop no resume takes back, or a resume that gave up. A refusal still uses onError.
// Run: pnpm exec tsx --test src/main/relay/relay-disconnect.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { openRelayJsonChannel, resetRelay } from '@neuramesh/relay-client';

class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSED = 3;
  static all: FakeSocket[] = [];
  readyState = 0; bufferedAmount = 0;
  frames: Record<string, unknown>[] = [];
  constructor(_url: string) { super(); FakeSocket.all.push(this); queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }); }
  send(value: string): void { this.frames.push(JSON.parse(value) as Record<string, unknown>); }
  receive(value: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  close(code = 1000): void { if (this.readyState === 3) return; this.readyState = 3; const event = new Event('close'); Object.assign(event, { code }); this.dispatchEvent(event); }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(t: { after(fn: () => void): void }, resumeWindowMs: number) {
  const original = globalThis.WebSocket;
  FakeSocket.all = [];
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  t.after(() => { resetRelay(); globalThis.WebSocket = original; });
  const heard: string[] = [];
  const cfg = { relayUrl: 'ws://test', machineId: async () => 'machine-a', clientBearer: async () => 'test-token', resumeWindowMs };
  const channel = openRelayJsonChannel(cfg, {
    lane: 'engineering', meta: {}, onMessage: () => {},
    onError: (m) => heard.push(`error:${m}`), onDisconnect: (m) => heard.push(`disconnect:${m}`), onExit: () => heard.push('exit'),
  });
  return { heard, channel };
}

test('a machine that cannot resume: a network drop is a disconnect, not an error', async (t) => {
  const { heard } = harness(t, 60_000);
  await tick(); const socket = FakeSocket.all[0]!;
  socket.receive({ t: 'attached', lanes: ['engineering'] }); await tick();
  socket.close(1006); await tick();
  assert.equal(heard.length, 2);
  assert.match(heard[0]!, /^disconnect:/);
  assert.equal(heard[1], 'exit');
});

test('a refusal is still an error', async (t) => {
  const { heard } = harness(t, 60_000);
  await tick(); FakeSocket.all[0]!.close(4401); await tick();
  assert.match(heard[0]!, /^error:/);
  assert.ok(!heard.some((h) => h.startsWith('disconnect:')));
});

test('a drop the client resumes says nothing, and a resume that gives up is a disconnect', async (t) => {
  const { heard } = harness(t, 60_000);
  await tick(); const socket = FakeSocket.all[0]!;
  socket.receive({ t: 'attached', lanes: ['engineering', 'resume'] }); await tick();
  socket.close(1006); await tick();
  // the session runs on at the machine: the pane hears nothing while the client dials again
  assert.deepEqual(heard, []);
  resetRelay();
});

test('a resume window that runs out ends the session with onDisconnect and the reason', async (t) => {
  const { heard } = harness(t, 1);
  await tick(); const socket = FakeSocket.all[0]!;
  socket.receive({ t: 'attached', lanes: ['engineering', 'resume'] }); await tick();
  socket.close(1006); await tick();
  assert.match(heard[0]!, /^disconnect:The connection to the machine dropped and did not come back\./);
  assert.equal(heard.at(-1), 'exit');
});

test('before the first attach, an ordinary close is a disconnect and a relay refusal is an error', async (t) => {
  const a = harness(t, 60_000);
  await tick(); FakeSocket.all[0]!.close(1001); await tick(); await tick();
  assert.match(a.heard[0]!, /^disconnect:/);
  resetRelay();
  const b = harness(t, 60_000);
  await tick(); FakeSocket.all[0]!.close(4404); await tick(); await tick();
  assert.match(b.heard[0]!, /^error:/);
});
