// The NO_REPLY stand-down policy — the gate that keeps "nothing to report"
// sweeps out of the channel even when the model wraps the sentinel in
// narrative (the every-15-min orchestrator spam, 2026-07-02).
// Run from apps/desktop:
//   pnpm exec tsx --test src/main/replypolicy.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStandDown, ORCH_EMPTY_TURN } from './replypolicy';

test('exact sentinel and empty replies stand down', () => {
  assert.equal(isStandDown('NO_REPLY'), true);
  assert.equal(isStandDown('  NO_REPLY  '), true);
  assert.equal(isStandDown(''), true);
  assert.equal(isStandDown('  \n \n'), true);
});

// The "(no digest)" leak, 2026-07-19: a gemini-3.5-flash orchestrator (the Fast /
// gemini-core seat) produced no channel text on a research question, and every transport
// substituted the literal "(no digest)" — which is NOT a stand-down, so it POSTED to the
// channel. An empty orchestrator turn must return ORCH_EMPTY_TURN, which stands down.
test('an empty orchestrator turn (ORCH_EMPTY_TURN) stands down — no placeholder posts', () => {
  assert.equal(isStandDown(ORCH_EMPTY_TURN), true);
  // the placeholder that leaked is deliberately NOT a stand-down — which is exactly why a
  // transport must return ORCH_EMPTY_TURN for empty output, never a bare placeholder string.
  assert.equal(isStandDown('(no digest)'), false);
});

test('the observed failure: narrative followed by the sentinel stands down', () => {
  assert.equal(
    isStandDown('Board is empty; #1004 is accepted. No open tasks, no unanswered human questions, nothing blocked or awaiting routing.\n\nNO_REPLY'),
    true,
  );
});

test('sentinel-first with trailing narrative stands down (mixed signals never post)', () => {
  assert.equal(isStandDown('NO_REPLY\n\nEverything looks quiet on the board today.'), true);
});

test('markdown emphasis and trailing punctuation are tolerated', () => {
  assert.equal(isStandDown('**NO_REPLY**'), true);
  assert.equal(isStandDown('`NO_REPLY`'), true);
  assert.equal(isStandDown('no_reply.'), true);
  assert.equal(isStandDown('> NO_REPLY'), true);
});

test('a real note posts', () => {
  assert.equal(isStandDown('#1010 has sat in plan_review for 2 days — needs your approval.'), false);
  assert.equal(isStandDown('☀️ Morning status — #dev\n- #1012 in progress with patch\n- #1010 blocked on creds'), false);
});

test('a sentinel mentioned mid-message does not stand down', () => {
  assert.equal(isStandDown('Heads up: patch replied NO_REPLY to the intake question\nand the task is still unrouted — needs you.'), false);
  assert.equal(isStandDown('First line alert\nNO_REPLY appeared mid-transcript\nlast line still alerting'), false);
});
