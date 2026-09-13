// Wall policy (execpolicy.ts): a walled task never strands silently — below the
// budget it retries in-session with honest attempt numbering; at the budget it
// blocks with the reason so the board + Mission Control surface it to the human.
// Run from apps/desktop: pnpm exec tsx --test src/main/execpolicy.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWallOutcome, classifyExecError, isLimitNotice, isTurnExhaustion } from './execpolicy';

const base = { reason: 'no work product — nothing changed in the worktree', blockAfter: 2, taskNumber: 1006, agentName: 'patch' };

test('first wall retries with the next attempt number and says so in the thread', () => {
  const o = planWallOutcome({ ...base, priorWalls: 0 });
  assert.equal(o.action, 'retry');
  assert.equal((o as { attempt: number }).attempt, 2);
  assert.match(o.wallNote, /^Execution hit a wall: /); // the budget counts this prefix
  assert.match(o.wallNote, /retrying \(attempt 2 of 2\)/);
});

test('the budget-hitting wall blocks with the reason and tells the human what to do', () => {
  const o = planWallOutcome({ ...base, priorWalls: 1 });
  assert.equal(o.action, 'block');
  const b = o as { blockReason: string; blockNote: string; wallNote: string };
  assert.match(b.blockReason, /execution failed 2× — no work product/);
  assert.match(b.wallNote, /^Execution hit a wall: /);
  assert.match(b.blockNote, /Auto-blocked #1006 after 2 failed execution attempts/);
  assert.match(b.blockNote, /@patch/);
  assert.match(b.blockNote, /Unblock.*retry|retry.*Unblock/s);
});

test('walls beyond the budget (relaunch trails) still block, never retry', () => {
  for (const priorWalls of [2, 5]) {
    assert.equal(planWallOutcome({ ...base, priorWalls }).action, 'block');
  }
});

test('reasons are truncated so a stack trace never floods the thread or block reason', () => {
  const o = planWallOutcome({ ...base, priorWalls: 1, reason: 'x'.repeat(500) });
  const b = o as { blockReason: string; wallNote: string };
  assert.ok(b.blockReason.length <= 200, String(b.blockReason.length));
  assert.ok(b.wallNote.length <= 240, String(b.wallNote.length));
});

// ── classifyExecError (docs/22 capacity failover) — gated against REAL provider strings ──
// The corpus is the point: hand-written strings passed while real messages misclassified (audit).
// Each string below is a message an actual runtime emits; the class is what the failover flow needs.

test('hard usage / spend / quota / credit caps → exhausted (across all three providers)', () => {
  for (const r of [
    // Anthropic (incl. Fable's separate metered + Max windowed caps)
    "You've hit your monthly spend limit. Run /usage-credits to manage your limit or switch models",
    // …verbatim from a live thread (2026-07-19): the runtime finished the turn and put
    // this in the REPLY, so it was posted as bosun's own words with no card raised
    "You've hit your monthly spend limit. Run /usage-credits to manage your limit and keep using Fable 5 or switch models to continue this chat.",
    "You've reached your weekly limit · resets Monday 12:00 AM",
    '5-hour limit reached — your limit resets at 3:00 PM',
    'Your credit balance is too low to access the Anthropic API',
    // OpenAI / codex
    'insufficient_quota: You exceeded your current quota, please check your plan and billing details',
    '429 You have reached your usage limit for gpt-5.5 on your current plan',
    // Gemini (RESOURCE_EXHAUSTED daily / per-day — NOT a per-minute throttle)
    '429 Resource has been exhausted (e.g. check quota).',
    "RESOURCE_EXHAUSTED: Quota exceeded for metric 'GenerateRequestsPerDayPerProjectPerModel'",
  ]) assert.equal(classifyExecError(r), 'exhausted', r);
});

test('per-window throttles → transient, even when worded as "quota exceeded" (the Gemini trap)', () => {
  for (const r of [
    "Quota exceeded for quota metric 'Generate Content API requests per minute'",
    'Rate limit reached for gpt-5.5 in organization org-x on requests per min (RPM)',
    'rate_limit_error: Number of requests has exceeded your rate limit',
    'HTTP 429 Too Many Requests',
    'overloaded_error: Overloaded',
    'Service Unavailable (503), please try again',
    'api_error: Internal server error',
    '502 Bad gateway',
  ]) assert.equal(classifyExecError(r), 'transient', r);
});

test('a model decline → refusal, never a cap or a retry (checked first)', () => {
  for (const r of [
    'stop_reason: "refusal"',
    "I can't help with that request.",
    'The model declined to assist with this task.',
  ]) assert.equal(classifyExecError(r), 'refusal', r);
  // a decline must not be swallowed by cap/transient vocabulary…
  assert.equal(classifyExecError('stop_reason refusal — usage policy'), 'refusal');
  // …and network "refused" must NOT read as a model refusal
  assert.equal(classifyExecError('connect ECONNREFUSED 127.0.0.1:443'), 'other');
});

test('ordering: a per-day cap is exhausted but a per-minute throttle is transient', () => {
  assert.equal(classifyExecError('Quota exceeded … per day'), 'exhausted');
  assert.equal(classifyExecError('Quota exceeded … per minute'), 'transient');
  assert.equal(classifyExecError('Resource has been exhausted, quota exceeded per-minute'), 'transient'); // window guard wins
});

test('ordinary walls and garbage are none of refusal/exhausted/transient', () => {
  for (const r of [
    'no work product — nothing changed in the worktree',
    'submit 500: internal error', // our own submit failure — NOT a provider overload (phrase-based 5xx avoids this)
    'ENOENT: no such file or directory',
    '',
    'x'.repeat(300),
  ]) assert.equal(classifyExecError(r), 'other', r);
});

// The reply-path guard (v0.43.3): a cap that arrives as REPLY TEXT must raise the
// failover card instead of being posted as the agent's own words — without silencing
// an agent that merely TALKS about limits.
test('isLimitNotice catches a terse provider cap in reply text', () => {
  assert.equal(isLimitNotice("You've hit your monthly spend limit. Run /usage-credits to manage your limit and keep using Fable 5 or switch models to continue this chat."), true);
  assert.equal(isLimitNotice('5-hour limit reached — your limit resets at 3:00 PM'), true);
  assert.equal(isLimitNotice('  Your credit balance is too low to access the Anthropic API  '), true);
});

test('isLimitNotice does NOT swallow an agent explaining our own capacity handling', () => {
  // prose ABOUT caps — the exact false positive a bare classifyExecError would cause
  const explainer = 'Here is how our capacity failover works: when a provider reports that '
    + 'you have hit your monthly spend limit, the daemon classifies that as an exhausted '
    + 'cap rather than a transient throttle, parks whatever the agent was working on, and '
    + 'posts a card in the channel offering to re-seat the affected roles onto another '
    + 'model. Nothing switches without your confirmation, and pinned agents are called out '
    + 'by name because a pack switch cannot move them.';
  assert.ok(explainer.length > 400);
  assert.equal(classifyExecError(explainer), 'exhausted'); // the raw classifier DOES match…
  assert.equal(isLimitNotice(explainer), false);           // …the length gate is what saves the reply
});

test('isLimitNotice ignores empty and ordinary replies', () => {
  assert.equal(isLimitNotice(''), false);
  assert.equal(isLimitNotice('   '), false);
  assert.equal(isLimitNotice('Backlog has 3 parked items — want me to promote one?'), false);
});

// --- the retry budget must RESET on unblock (the "click Unblock, instantly blocked again" bug) ---

test('the budget is per-round: the same wall count blocks, but a reset round retries', () => {
  const p = { reason: 'no work product — nothing changed in the worktree', blockAfter: 2, taskNumber: 1034, agentName: 'patch' };
  // 1 prior wall THIS round → still has a retry left
  assert.equal(planWallOutcome({ ...p, priorWalls: 0 }).action, 'retry');
  // 1 prior + this one = 2 → blocks
  assert.equal(planWallOutcome({ ...p, priorWalls: 1 }).action, 'block');
  // after an unblock the caller passes 0 again, so the very next attempt RETRIES rather than
  // re-blocking — which is the whole point: an all-time count made Unblock a no-op
  assert.equal(planWallOutcome({ ...p, priorWalls: 0 }).action, 'retry');
});

test('turn exhaustion is named honestly and does NOT blame the credentials', () => {
  const out = planWallOutcome({
    reason: 'failed [error_max_turns] 568s', priorWalls: 1, blockAfter: 2, taskNumber: 1034, agentName: 'patch',
  });
  assert.equal(out.action, 'block');
  assert.ok(out.action === 'block' && /ran out of turns/.test(out.blockNote), out.action === 'block' ? out.blockNote : '');
  assert.ok(out.action === 'block' && !/key\/quota/.test(out.blockNote), 'must not send the human to check a key');
  assert.equal(isTurnExhaustion('failed [error_max_turns] 568s'), true);
  assert.equal(isTurnExhaustion('no work product — nothing changed in the worktree'), false);
});

test('a provider cap gets cap advice, not key advice', () => {
  const out = planWallOutcome({
    reason: 'reached your weekly limit', priorWalls: 1, blockAfter: 2, taskNumber: 7, agentName: 'patch',
  });
  assert.ok(out.action === 'block' && /provider cap/.test(out.blockNote), 'names the cap');
});
