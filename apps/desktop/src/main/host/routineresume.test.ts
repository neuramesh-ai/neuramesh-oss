// The routine resume's picker (host/routineresume.ts): pure, so every reason a routine thread is
// or is not re-asked is a case here, without the host.
// Run from apps/desktop: pnpm exec tsx --test src/main/host/routineresume.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REASKS, REASK_GRACE_MS, REASK_PREFIX, RESUME_WINDOW_MS, pickStrandedRoutines, reaskBody, type RoutineThreadState } from './routineresume';
import { noComputeNotice, sleeperNotice } from '../computenotice';

const NOW = Date.parse('2026-09-13T06:34:00Z');
const ago = (ms: number) => NOW - ms;
const MIN = 60_000;
const H = 3600_000;

const cand = (over: Partial<RoutineThreadState>): RoutineThreadState => ({
  threadId: 'th-1', scheduleId: 'sch-1', bornMs: ago(15 * H), ownerId: 'geo', lastHumanAtMs: ago(15 * H),
  agentReplies: [], reasks: 0, anchoredUnits: 0, runningRuns: 0, newerRunExists: false,
  ...over,
});
const ids = (xs: RoutineThreadState[]) => xs.map((x) => x.threadId);

// --- the #1093 shape: the opener answered only by the no-compute notice, hours ago ---
test('a routine answered only by the no-compute notice is re-asked', () => {
  const c = cand({ agentReplies: [{ atMs: ago(15 * H - 1000), body: noComputeNotice({ label: 'Claude', reason: 'expired' }) }] });
  assert.deepEqual(ids(pickStrandedRoutines([c], NOW)), ['th-1']);
});

test('the old wording of the notice (em dash) counts as a notice too', () => {
  const c = cand({ agentReplies: [{ atMs: ago(15 * H - 1000), body: "I can't run this right now — no machine available to me can serve claude-code. Sign in to a provider on this machine, or ask a teammate to lend you theirs in Settings → Compute → Sharing." }] });
  assert.equal(pickStrandedRoutines([c], NOW).length, 1);
});

test('a real agent answer means the thread is alive — never re-asked', () => {
  const c = cand({ agentReplies: [{ atMs: ago(14 * H), body: 'Started #1094 for the seven-post Flowe X calendar.' }] });
  assert.equal(pickStrandedRoutines([c], NOW).length, 0);
});

test('a dead wake (no reply at all) waits out the grace, then is re-asked', () => {
  assert.equal(pickStrandedRoutines([cand({ lastHumanAtMs: ago(REASK_GRACE_MS - MIN) })], NOW).length, 0);
  assert.equal(pickStrandedRoutines([cand({ lastHumanAtMs: ago(REASK_GRACE_MS + MIN) })], NOW).length, 1);
});

test('the sleeper notice gets its grace from the NOTICE, not from the opener', () => {
  const fresh = cand({ lastHumanAtMs: ago(30 * MIN), agentReplies: [{ atMs: ago(2 * MIN), body: sleeperNotice('your cloud machine', 'codex') }] });
  assert.equal(pickStrandedRoutines([fresh], NOW).length, 0);
  const stale = cand({ lastHumanAtMs: ago(30 * MIN), agentReplies: [{ atMs: ago(REASK_GRACE_MS + MIN), body: sleeperNotice('your cloud machine', 'codex') }] });
  assert.equal(pickStrandedRoutines([stale], NOW).length, 1);
});

test('an anchored unit, a running run, or a newer run of the same routine all stop the re-ask', () => {
  assert.equal(pickStrandedRoutines([cand({ anchoredUnits: 1 })], NOW).length, 0);
  assert.equal(pickStrandedRoutines([cand({ runningRuns: 1 })], NOW).length, 0);
  assert.equal(pickStrandedRoutines([cand({ newerRunExists: true })], NOW).length, 0);
});

test('bounded: MAX_REASKS re-asks per thread, and nothing older than the window', () => {
  assert.equal(pickStrandedRoutines([cand({ reasks: MAX_REASKS - 1 })], NOW).length, 1);
  assert.equal(pickStrandedRoutines([cand({ reasks: MAX_REASKS })], NOW).length, 0);
  assert.equal(pickStrandedRoutines([cand({ bornMs: ago(RESUME_WINDOW_MS + H), lastHumanAtMs: ago(RESUME_WINDOW_MS + H) })], NOW).length, 0);
});

test('a re-ask that was itself answered by a notice is re-asked again (the count is what bounds it)', () => {
  const c = cand({ reasks: 1, lastHumanAtMs: ago(2 * H), agentReplies: [{ atMs: ago(2 * H - 1000), body: noComputeNotice({ label: 'OpenAI/Codex', reason: 'missing' }) }] });
  assert.equal(pickStrandedRoutines([c], NOW).length, 1);
});

test('the re-ask reads as the opener does: a plain first line, then the prompt', () => {
  const body = reaskBody('Flowe X Schedule for Upcoming Week', 'hey rex, draft the week');
  assert.equal(body.startsWith(`${REASK_PREFIX}Flowe X Schedule for Upcoming Week\n\n`), true);
  assert.equal(body.endsWith('hey rex, draft the week'), true);
  assert.equal(body.includes('—'), false);
});
