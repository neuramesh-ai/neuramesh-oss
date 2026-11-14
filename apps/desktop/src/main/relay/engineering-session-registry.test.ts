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

test('a drain holds new sessions, counts busy ones, and closes every session', async () => {
  const registry = new EngineeringSessionRegistry<{ busy: boolean; close(): Promise<void> }>();
  const closed: string[] = [];
  await registry.open('a', async () => ({ busy: true, close: async () => { closed.push('a'); } }));
  await registry.open('b', async () => ({ busy: false, close: async () => { closed.push('b'); } }));
  assert.equal(registry.busyCount(), 1);
  registry.hold();
  await assert.rejects(registry.open('c', async () => ({ busy: false, close: async () => {} })), /stops soon/);
  await registry.closeAll();
  assert.deepEqual(closed.sort(), ['a', 'b']);
  assert.equal(registry.busyCount(), 0);
});

test('get finds the open session, and workingCount counts only turns that wait on nobody', async () => {
  const registry = new EngineeringSessionRegistry<{ busy: boolean; working: boolean; close(): Promise<void> }>();
  const running = await registry.open('a', async () => ({ busy: true, working: true, close: async () => {} }));
  await registry.open('b', async () => ({ busy: true, working: false, close: async () => {} }));
  await registry.open('c', async () => ({ busy: false, working: false, close: async () => {} }));
  assert.equal(registry.get('a'), running);
  assert.equal(registry.get('zz'), undefined);
  assert.equal(registry.busyCount(), 2);
  assert.equal(registry.workingCount(), 1, 'a turn held on an approval is not work');
  await running.close();
  assert.equal(registry.get('a'), undefined);
  assert.equal(registry.workingCount(), 0);
});
