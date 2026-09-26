// The compute notices say the real reason, and are recognised on the way back in — the routine
// resume treats them as "nobody could answer", never as an answer (host/routineresume.ts).
// Run from apps/desktop: pnpm exec tsx --test src/main/computenotice.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isComputeNotice, isNoCreditsError, noComputeNotice, noComputeReasonOf, noCreditsNotice, sleeperNotice } from './computenotice';

test('the reason comes from the credential probe: expired login, no login, or unknown', () => {
  assert.equal(noComputeReasonOf({ authMode: 'none', blocked: { provider: 'anthropic', reason: 'expired' } }), 'expired');
  assert.equal(noComputeReasonOf({ authMode: 'none', blocked: { provider: 'anthropic', reason: 'unavailable' } }), 'missing');
  assert.equal(noComputeReasonOf({ authMode: 'none' }), 'missing');
  assert.equal(noComputeReasonOf({ authMode: 'subscription' }), null); // the probe says it CAN serve — nothing to explain
  assert.equal(noComputeReasonOf(null), null);
});

test('the notice names the reason and the fix, in one breath', () => {
  const expired = noComputeNotice({ label: 'Claude', reason: 'expired' });
  assert.equal(expired, "I can't run this now. The Claude login on this machine expired. Sign in to Claude again on this machine, or ask a teammate to lend you a machine in Settings › Compute › Sharing.");
  const missing = noComputeNotice({ label: 'Claude', reason: 'missing', cloudLacksLogin: true });
  assert.equal(missing.includes('This machine has no Claude login. Your cloud machine has no Claude login either.'), true);
  const unknown = noComputeNotice({ label: 'OpenAI/Codex', reason: null });
  assert.equal(unknown.startsWith("I can't run this now. No machine available to me can serve OpenAI/Codex."), true);
});

test('every wording is a notice — the new ones, the sleeper, the old em-dash one, the auth card', () => {
  for (const reason of ['expired', 'missing', null] as const) assert.equal(isComputeNotice(noComputeNotice({ label: 'Claude', reason })), true);
  assert.equal(isComputeNotice(sleeperNotice('your cloud machine', 'codex')), true);
  assert.equal(isComputeNotice(sleeperNotice("a teammate's cloud machine", 'codex')), true);
  assert.equal(isComputeNotice("I can't run this right now — no machine available to me can serve claude-code. Sign in to a provider on this machine, or ask a teammate to lend you theirs in Settings → Compute → Sharing."), true);
  assert.equal(isComputeNotice('⚠️ @rex can\'t reply — your **Claude** subscription login on this machine has expired.\n\n```nmauth\n{"provider":"anthropic"}\n```'), true);
});

test('a real answer is not a notice', () => {
  assert.equal(isComputeNotice('Started #1094 for the seven-post Flowe X calendar.'), false);
  assert.equal(isComputeNotice(''), false);
  assert.equal(isComputeNotice(null), false);
});

test('the notices carry no em dash — user-facing text is STE', () => {
  for (const reason of ['expired', 'missing', null] as const) assert.equal(noComputeNotice({ label: 'Claude', reason, cloudLacksLogin: true }).includes('—'), false);
  assert.equal(sleeperNotice('your cloud machine', 'codex').includes('—'), false);
});

test('the out-of-credits notice is a notice, and it names both ways on', () => {
  const n = noCreditsNotice();
  assert.equal(isComputeNotice(n), true); // the routine resume re-answers once credits return
  assert.match(n, /Add credits in Credits/);
  assert.match(n, /connect your own brain in Settings/);
  assert.equal(n.includes('—') || n.includes(';'), false);
});

test('only the metered lane refusal counts as out of credits', () => {
  assert.equal(isNoCreditsError(new Error('out of credits: add credits in Credits, or connect your own brain in Settings')), true);
  assert.equal(isNoCreditsError(new Error('starter brain unavailable (503)')), false);
  // a provider's own cap wording goes to the capacity failover, not to this notice
  assert.equal(isNoCreditsError(new Error('You have run out of credits on your Anthropic plan')), false);
  assert.equal(isNoCreditsError('out of credits'), false);
});
