// An echo refresh stores no fact (the Cloud Run feature suite, 2026-10-30): on the starter brain the
// sleep-time refresh has no model, and it stored a message count as a fact on every pass.
// Run from apps/desktop: pnpm exec tsx --test src/main/host/factcandidates.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { factCandidates } from './factcandidates';

test('with no model reading the room there is no fact to store', () => {
  assert.deepEqual(factCandidates(null), []);
});

test('a model\'s lines become facts: trimmed, 12 to 300 characters, at most five', () => {
  const raw = ['  The team ships on Fridays.  ', 'too short', 'x'.repeat(301), 'Atlas owns the public API plan.', '',
    'The launch is set for 12 November.', 'Reviews need two approvals.', 'Docs live in the brand library.', 'One more decision that is cut.'].join('\n');
  assert.deepEqual(factCandidates(raw), [
    'The team ships on Fridays.', 'Atlas owns the public API plan.', 'The launch is set for 12 November.',
    'Reviews need two approvals.', 'Docs live in the brand library.',
  ]);
  assert.deepEqual(factCandidates(''), []);
});
