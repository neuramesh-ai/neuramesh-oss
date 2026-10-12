import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineeringSessionRegistry } from './engineering-session-registry';

test('a reconnect awaits shutdown before the next recorder opens', async () => {
  let drain!: () => void;
  const finished = new Promise<void>((r) => { drain = r; });
  const order: string[] = [];
  const registry = new EngineeringSessionRegistry<{ close(): Promise<void> }>();
  await registry.open('thread', async () => ({ close: async () => { order.push('closing'); await finished; order.push('closed'); } }));
  const reopen = registry.open('thread', async () => { order.push('open'); return { close: async () => {} }; });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['closing']);
  drain(); await reopen;
  assert.deepEqual(order, ['closing', 'closed', 'open']);
});

test('concurrent opens serialize and a live turn is never displaced', async () => {
  const registry = new EngineeringSessionRegistry<{ busy: boolean; close(): Promise<void> }>();
  let firstClosed = false;
  const first = registry.open('thread', async () => ({ busy: true, close: async () => { firstClosed = true; } }));
  const second = registry.open('thread', async () => { throw new Error('must not create another writer'); });
  await first;
  await assert.rejects(second, /still working/);
  assert.equal(firstClosed, false);
});
