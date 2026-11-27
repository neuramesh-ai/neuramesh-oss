// Truth table for the enforced honesty guards (no-fake-deliverable, no-rubber-stamp). Run:
//   node --import tsx --test apps/desktop/src/main/runtime/honesty.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldBlockEcho, shouldHoldReview, claimsPendingWork, announcesWork } from './honesty';

test('echo guard: a Claude agent with no credential BLOCKS (no silent echo fallback)', () => {
  // the regression this guard fixes — claude-code used to be exempt and would fake a RESULT
  assert.equal(shouldBlockEcho({ mode: 'echo', globalEchoGate: false }), true);
});

test('echo guard: any echo-mode runtime blocks when the dev gate is off', () => {
  assert.equal(shouldBlockEcho({ mode: 'echo', globalEchoGate: false }), true);
});

test('echo guard: the explicit dev gate (NM_AGENT_MODE=echo) still allows echo', () => {
  assert.equal(shouldBlockEcho({ mode: 'echo', globalEchoGate: true }), false);
});

test('echo guard: a live (credentialed) agent is never blocked by this guard', () => {
  assert.equal(shouldBlockEcho({ mode: 'claude', globalEchoGate: false }), false);
  assert.equal(shouldBlockEcho({ mode: 'claude', globalEchoGate: true }), false);
});

test('review guard: no credential + a Definition of Done → HOLD (never auto-approve unreviewed work)', () => {
  assert.equal(shouldHoldReview({ authMode: 'none', hasReviewCriteria: true, globalEchoGate: false }), true);
});

test('review guard: a live credential never triggers a hold (the real review runs)', () => {
  assert.equal(shouldHoldReview({ authMode: 'subscription', hasReviewCriteria: true, globalEchoGate: false }), false);
  assert.equal(shouldHoldReview({ authMode: 'apikey', hasReviewCriteria: true, globalEchoGate: false }), false);
});

test('review guard: no criteria to review → no hold (nothing to semantically review; structural gate stands)', () => {
  assert.equal(shouldHoldReview({ authMode: 'none', hasReviewCriteria: false, globalEchoGate: false }), false);
});

test('review guard: the dev echo gate bypasses the hold', () => {
  assert.equal(shouldHoldReview({ authMode: 'none', hasReviewCriteria: true, globalEchoGate: true }), false);
});

// ── "still waiting on my background agents" is not a deliverable (docs/29) ─────────────────
// The guard is deliberately NARROW: a false positive blocks finished work, which is worse
// than the bug it prevents. These pin both directions.

test('pending-work guard: the REAL #1032 sentence that got submitted for review', () => {
  assert.equal(
    claimsPendingWork('Waiting for the background research agents to complete (or the scheduled check-in) before proceeding to synthesis.'),
    true,
  );
});

test('pending-work guard: the other ways a turn ends without finishing', () => {
  for (const s of [
    'The background agents are still running; I will synthesize once they land.',
    "I'll report back when the parallel searches finish.",
    'Still waiting on the subagent results.',
    'My research tasks are in flight — checking back shortly.',
    'The parallel searches are still running.',   // plural nouns: `s?` missed "searches"/"queries"
    'Once they complete I will assemble the final report.',
  ]) assert.equal(claimsPendingWork(s), true, s);
});

test('pending-work guard: a FINISHED report is never blocked, even when it talks about waiting', () => {
  for (const s of [
    // the deliverable's SUBJECT is background work — must not fire
    'Recommendation: move onboarding emails to a background job so users are not waiting for the import to complete.',
    'Users abandon at minute 3 while waiting for the first breath cue; three fixes are proposed below.',
    'Finding: competitors run scheduled check-ins; Flowe does not. Full comparison attached.',
    // a plain, complete summary
    'Delivered 3 files: report.md, gaps.md, retention.md — attached for review.',
    'Done — 5 angles researched, 41 sources, report attached.',
    // past tense: the waiting already happened
    'I waited for the crawl to finish, then wrote up the results.',
    // a finished bug fix whose SUBJECT is waiting — caught pre-release by the stress pass, and
    // the reason pattern 1 is anchored to the start of a sentence
    'Fixed the race: the watcher was waiting on a promise that never resolved when the job was cancelled.',
    'Added a regression test for the case where the queue is still running at shutdown.',
    'The build is blocked on a missing env var — documented in the README; nothing else outstanding.',
    // a legitimate END state: content held for a human, not an unfinished turn
    'Scheduled the LinkedIn post for Monday 9am; the others are waiting for your approval before they publish.',
  ]) assert.equal(claimsPendingWork(s), false, s);
});

test('pending-work guard: empty/missing summaries are not a claim', () => {
  assert.equal(claimsPendingWork(''), false);
  assert.equal(claimsPendingWork(null), false);
  assert.equal(claimsPendingWork(undefined), false);
});

// ── announcesWork: a reply that says what it will do, and does not do it (2026-11-17) ──────────

test('announced work: the live 2026-11-17 reply fires', () => {
  assert.equal(announcesWork('I will check the connected platforms and deliver the posts for your chosen angle.'), true);
});

test('announced work: the other lead-ins fire, in the reply\'s last sentence', () => {
  for (const s of [
    "I'll draft the three posts now.",
    'Let me read the brand docs first.',
    'Great choice. Next I will draft the scripts for TikTok.',
    'Got it. Now I will schedule them for Monday.',
    "Read the profile. I'm going to write the drafts.",
    'Then I will post the angle card',
  ]) assert.equal(announcesWork(s), true, s);
});

test('announced work: a reply whose narrated tool calls were stripped fires, whatever its words', () => {
  assert.equal(announcesWork('Here are the drafts.', { strippedCalls: 1 }), true);
});

test('announced work: a reply that waits on the human never fires', () => {
  for (const s of [
    'Which platforms should I draft for?',
    "I'll draft them once you pick an angle.",
    'Drafted three posts above. Let me know what to change.',
    "I'll schedule them when you approve.",
    "I'll wait for your pick.",
    "I'll be here if you need more.",
    'Pick one below.\n\n```nmq\n{"question":"Which angle?"}\n```',
    'I will draft them on your word.',
  ]) assert.equal(announcesWork(s), false, s);
});

test('announced work: a finished answer that opens with a one-line plan never fires', () => {
  assert.equal(announcesWork('I will compare the two plans.\n\nPlan A costs less and ships in May. Plan B costs more and ships in March.'), false);
  assert.equal(announcesWork('I drafted three posts for the nervous system reset angle, one for each connected account.'), false);
  assert.equal(announcesWork(''), false);
  assert.equal(announcesWork(null), false);
});

test('announced work: a question card beats a stripped call', () => {
  assert.equal(announcesWork('```nmq\n{"question":"Which?"}\n```', { strippedCalls: 2 }), false);
});

test('announced work: follow-up pills after the promise do not hide it', () => {
  assert.equal(announcesWork('I will draft the posts now.\n\n```nms\n["Shorter","Add a hook"]\n```'), true);
});
