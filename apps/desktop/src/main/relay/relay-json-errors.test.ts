import assert from 'node:assert/strict';
import test from 'node:test';
import { openRelayJsonChannel, resetRelay } from '@neuramesh/relay-client';

class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSED = 3;
  static latest: FakeSocket;
  readyState = 0; bufferedAmount = 0;
  frames: Record<string, unknown>[] = [];
  constructor(_url: string) { super(); FakeSocket.latest = this; queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }); }
  send(value: string): void { this.frames.push(JSON.parse(value) as Record<string, unknown>); }
  receive(value: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  close(code = 1000): void { this.readyState = 3; const event = new Event('close'); Object.assign(event, { code }); this.dispatchEvent(event); }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const cfg = { relayUrl: 'ws://test', machineId: async () => 'machine-a', clientBearer: async () => 'test-token' };

test('JSON lanes report the real socket refusal once and reject queued commands', async (t) => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  t.after(() => { resetRelay(); globalThis.WebSocket = original; });
  const errors: string[] = []; let exits = 0;
  const channel = openRelayJsonChannel(cfg, { lane: 'engineering', meta: {}, onMessage: () => assert.fail('No machine event exists'), onError: (message) => errors.push(message), onExit: () => { exits++; } });
  const queued = channel.send({ type: 'prompt', prompt: 'hello' });
  const rejected = assert.rejects(queued, /not on the relay/);
  await tick(); FakeSocket.latest.close(4404); await rejected; await tick();
  assert.deepEqual(errors, ['The machine is not on the relay yet. It reconnects within a minute. Try again.']);
  assert.equal(exits, 1);
  await assert.rejects(channel.send({ type: 'prompt', prompt: 'again' }), /channel is closed/);
  resetRelay();
});

test('a callback failure is not misreported as malformed JSON and later events remain readable', async (t) => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  t.after(() => { resetRelay(); globalThis.WebSocket = original; });
  t.mock.method(console, 'error', () => {});
  const errors: string[] = []; const events: unknown[] = []; let fail = true;
  const channel = openRelayJsonChannel(cfg, { lane: 'engineering', meta: {}, onMessage: (message) => { if (fail) { fail = false; throw new Error('Client reducer failed'); } events.push(message); }, onError: (message) => errors.push(message), onExit: () => {} });
  await tick(); const socket = FakeSocket.latest;
  socket.receive({ t: 'attached', lanes: ['engineering'] }); await tick();
  const ch = socket.frames.find((frame) => frame['t'] === 'open')!['ch'];
  socket.receive({ ch, t: 'data', d: btoa('{"type":"ready"}\n') });
  socket.receive({ ch, t: 'data', d: btoa('{"type":"status","status":"idle"}\n') });
  assert.deepEqual(errors, ['This client could not apply a machine update. Reload the thread.']);
  assert.deepEqual(events, [{ type: 'status', status: 'idle' }]);
  channel.close(); resetRelay();
});
