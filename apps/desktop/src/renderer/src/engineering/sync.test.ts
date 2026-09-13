import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleEngineeringSync } from './sync';

test('streaming updates coalesce into one persistence or shell sync', async () => {
  let calls = 0;
  let cancel = () => {};
  for (let index = 0; index < 100; index += 1) {
    cancel();
    cancel = scheduleEngineeringSync(() => { calls += 1; }, 5);
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 1);
});
