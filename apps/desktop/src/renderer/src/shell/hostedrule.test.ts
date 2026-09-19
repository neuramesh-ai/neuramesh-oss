// The hosted gate's rule, STOOD DOWN 2026-09-19 (the first-run doors): a free hosted workspace writes
// again, so no connection and no plan gates. The cases stay so the day the ruling changes is one edit.
// Run from apps/desktop:  pnpm exec tsx --test src/renderer/src/shell/hostedrule.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostedGateFor } from './hostedrule';

const cloud = { kind: 'cloud', authMode: 'clerk' } as const;
const local = { kind: 'local', authMode: 'local' } as const;
const dev = { kind: 'custom', authMode: 'dev' } as const;
const customClerk = { kind: 'custom', authMode: 'clerk' } as const;
const customLocal = { kind: 'custom', authMode: 'local' } as const;

test('a cloud connection on a free workspace row is NOT gated: Free in the cloud starts with 500 credits', () => {
  assert.equal(hostedGateFor(cloud, 'free'), false);
});

test('a cloud connection on a Pro row is not — Pro is plan id `cloud`', () => {
  assert.equal(hostedGateFor(cloud, 'cloud'), false);
});

test('a local connection is never gated, whatever the row says', () => {
  assert.equal(hostedGateFor(local, 'free'), false);
  assert.equal(hostedGateFor(local, 'cloud'), false);
  assert.equal(hostedGateFor(customLocal, 'free'), false);
});

test('a custom server with a Clerk sign-in, and the dev lane, follow the row like the cloud: nothing gates', () => {
  assert.equal(hostedGateFor(customClerk, 'free'), false);
  assert.equal(hostedGateFor(dev, 'free'), false);
  assert.equal(hostedGateFor(dev, 'cloud'), false);
});

test('an unread plan gates nothing — the composer must not flash into a gate while the fetch is in flight', () => {
  assert.equal(hostedGateFor(cloud, ''), false);
  assert.equal(hostedGateFor(cloud, null), false);
  assert.equal(hostedGateFor(cloud, undefined), false);
  assert.equal(hostedGateFor(null, 'free'), false);
});
