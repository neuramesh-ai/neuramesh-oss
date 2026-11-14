import test from 'node:test';
import assert from 'node:assert/strict';
import { withPermissionDeadline } from './permission-deadline';

test('overlapping approvals pause only their turn, then resume the remaining work budget', async t => {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  let first!: () => void, second!: () => void, finish!: () => void;
  const held = withPermissionDeadline(async wait => {
    await Promise.all([wait(() => new Promise<void>(r => { first = r; })), wait(() => new Promise<void>(r => { second = r; }))]);
    return new Promise<void>(r => { finish = r; });
  }, 100, 'held turn timed out');
  const other = withPermissionDeadline(() => new Promise(() => {}), 100, 'other turn timed out');
  const otherFailed = assert.rejects(other, /other turn timed out/);
  t.mock.timers.tick(200); await otherFailed;
  first(); await new Promise(r => setImmediate(r)); t.mock.timers.tick(1000);
  second(); await new Promise(r => setImmediate(r));
  t.mock.timers.tick(99); finish(); await held;
});
