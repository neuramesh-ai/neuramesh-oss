// The setup tracker's rows per connection: a local connection carries no cloud-machine and no phone row.
// Run from apps/desktop:  pnpm exec tsx --test src/renderer/src/views/setup-items.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OnboardingSignals } from '@neuramesh/shared';
import { setupItemsFor } from './setup-items';

const signals: OnboardingSignals = {
  machines: [{ kind: 'local' }],
  members: [{ user_id: 'u1' }],
  credentials: [],
  devices: null,
};

test('a cloud connection keeps the shared list whole: machine · subscription · team · desktop · mobile', () => {
  assert.deepEqual(setupItemsFor(signals, 'cloud').map((i) => i.id), ['machine', 'subscription', 'team', 'desktop', 'mobile']);
  assert.deepEqual(setupItemsFor(signals, undefined).map((i) => i.id), ['machine', 'subscription', 'team', 'desktop', 'mobile']);
});

test('a local connection has no cloud-machine row and no phone row — absent, never null-as-open', () => {
  const items = setupItemsFor(signals, 'local');
  assert.deepEqual(items.map((i) => i.id), ['subscription', 'team', 'desktop']);
  assert.ok(items.every((i) => i.id !== 'machine' && i.id !== 'mobile'));
  // the rows that stay keep the shared derivation: this Mac registered, so the desktop row is done
  assert.equal(items.find((i) => i.id === 'desktop')?.done, true);
  assert.equal(items.find((i) => i.id === 'subscription')?.done, false);
});

test('a custom server follows the cloud list — the rule is about the local stack, not about "not cloud"', () => {
  assert.equal(setupItemsFor(signals, 'custom').length, 5);
});
