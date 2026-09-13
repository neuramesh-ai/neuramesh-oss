import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EngineeringSessionLeases, MAX_ENGINEERING_SESSIONS_PER_ACTOR, MAX_ENGINEERING_SESSIONS_PER_MACHINE,
} from './engineering-session-leases';

test('Code session leases reject duplicate and per-actor fan-out before machine work begins', () => {
  const leases = new EngineeringSessionLeases();
  const claimed: string[] = [];
  for (let index = 0; index < MAX_ENGINEERING_SESSIONS_PER_ACTOR; index += 1) {
    const result = leases.claim('actor-1', `thread-${index}`);
    assert.equal(result.ok, true);
    if (result.ok) claimed.push(result.lease);
  }
  assert.deepEqual(leases.claim('actor-1', 'thread-0'), { ok: false, reason: 'active' });
  assert.deepEqual(leases.claim('actor-1', 'overflow'), { ok: false, reason: 'limit' });
  leases.release(claimed[0]!);
  assert.equal(leases.claim('actor-1', 'replacement').ok, true);
});

test('Code session leases cap aggregate machine fan-out across actors', () => {
  const leases = new EngineeringSessionLeases();
  for (let index = 0; index < MAX_ENGINEERING_SESSIONS_PER_MACHINE; index += 1) {
    assert.equal(leases.claim(`actor-${index}`, `thread-${index}`).ok, true);
  }
  assert.deepEqual(leases.claim('another-actor', 'overflow'), { ok: false, reason: 'limit' });
});
