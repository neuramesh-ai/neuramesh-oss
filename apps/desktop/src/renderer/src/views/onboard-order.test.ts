// The wizard's order: a resumed workspace has no Workspace step on the desktop.
// Run from apps/desktop:  pnpm exec tsx --test src/renderer/src/views/onboard-order.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESKTOP_ORDER, WEB_ORDER, onboardOrderFor } from './onboard-order';

test('a fresh desktop wizard walks all five steps, the Workspace step third', () => {
  assert.deepEqual(onboardOrderFor({ web: false, resume: false }), DESKTOP_ORDER);
  assert.equal(onboardOrderFor({ web: false, resume: false })[2], 'workspace');
});

test('a desktop wizard that resumes a workspace has no Workspace step, and still ends at Launch', () => {
  const order = onboardOrderFor({ web: false, resume: true });
  assert.deepEqual(order, ['machine', 'keys', 'team', 'launch']);
  assert.ok(!order.includes('workspace'));
  assert.equal(order[order.length - 1], 'launch');
});

test('the browser keeps its order either way: it starts at step 2 on a resume instead', () => {
  assert.deepEqual(onboardOrderFor({ web: true, resume: false }), WEB_ORDER);
  assert.deepEqual(onboardOrderFor({ web: true, resume: true }), WEB_ORDER);
});
