// The plan strip: absent on a local connection, Free or Pro on a hosted one, no project count.
// Run from apps/desktop:  pnpm exec tsx --test src/renderer/src/views/planstrip.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_STRIP_COPY, planStripFor } from './planstrip';

test('a local connection draws no strip: Free is the whole product there', () => {
  assert.equal(planStripFor({ local: true, isCloud: false }), null);
  assert.equal(planStripFor({ local: true, isCloud: true }), null);
});

test('a hosted Pro workspace names Pro with no door', () => {
  assert.deepEqual(planStripFor({ local: false, isCloud: true }), { name: 'Pro', sub: 'The hosted cloud', door: null, pro: true });
});

test('a hosted Free workspace names Free and opens the Get Pro door', () => {
  const s = planStripFor({ local: false, isCloud: false });
  assert.equal(s?.name, 'Free');
  assert.equal(s?.door, 'Get Pro');
  assert.equal(s?.pro, false);
});

test('every word reads as Simplified Technical English and never counts projects', () => {
  for (const v of Object.values(PLAN_STRIP_COPY)) for (const s of Object.values(v)) {
    assert.ok(!/[—;]/.test(s), `no em dash and no semicolon: ${s}`);
    assert.ok(!/projects?/i.test(s), `no project count: ${s}`);
  }
});
