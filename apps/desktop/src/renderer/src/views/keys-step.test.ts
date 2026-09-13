// The Keys step's local variant: no door, and Continue gated on a provider.
// Run from apps/desktop:  pnpm exec tsx --test src/renderer/src/views/keys-step.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYS_LOCAL_COPY, keysStepFor } from './keys-step';

test('a cloud connection keeps the starter door and never gates Continue', () => {
  assert.deepEqual(keysStepFor({ local: false, anyReady: false }), { door: true, canContinue: true, continueKind: 'primary' });
  assert.deepEqual(keysStepFor({ local: false, anyReady: true }), { door: true, canContinue: true, continueKind: 'primary' });
});

test('a local connection hides the door and holds Continue as a ghost until one provider is ready', () => {
  assert.deepEqual(keysStepFor({ local: true, anyReady: false }), { door: false, canContinue: false, continueKind: 'ghost' });
  assert.deepEqual(keysStepFor({ local: true, anyReady: true }), { door: false, canContinue: true, continueKind: 'primary' });
});

test('the local sentence is the artboard\'s, and reads as Simplified Technical English', () => {
  assert.equal(KEYS_LOCAL_COPY.sub, 'Sign in to one provider to continue. Nothing leaves this Mac.');
  for (const s of Object.values(KEYS_LOCAL_COPY)) {
    assert.ok(!/[—;]/.test(s), `no em dash and no semicolon: ${s}`);
  }
});
