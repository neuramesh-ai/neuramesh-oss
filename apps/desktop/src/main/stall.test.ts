// Stall watchdog classifier (stall.ts): deterministic detection of stuck work,
// pure so every class and suppression is unit-testable without the host.
// Run from apps/desktop: pnpm exec tsx --test src/main/stall.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRoutineStalls, classifyStalls, stallKey, routineStallKey, fmtAge, STALL_AFTER, MAX_STALLS_PER_SWEEP, type RoutineCandidate, type StallCandidate } from './stall';

const NOW = Date.parse('2026-07-08T08:20:00Z');
const ago = (ms: number) => NOW - ms;
const MIN = 60_000;
const H = 3600_000;

const cand = (over: Partial<StallCandidate>): StallCandidate => ({
  id: 't-1',
  number: 1011,
  title: 'create x marketing posts for latest flowe features',
  state: 'design_review',
  assignee: 'iris',
  offered: null,
  createdAtMs: ago(24 * H),
  updatedAtMs: ago(20 * MIN),
  lastMsgAtMs: null,
  lastHumanMsgAtMs: null,
  lastBeatAtMs: null,
  lastRunAtMs: null,
  runOpen: false,
  hostSeenAtMs: ago(1 * MIN),
  hasOpenDecision: false,
  liveLocal: false,
  ...over,
});

// --- the #1011 case: human feedback sat on a design review overnight ---

test('design_review with human feedback newer than the transition → feedback_unactioned, even when an agent chatted after', () => {
  const [s] = classifyStalls([cand({
    updatedAtMs: ago(10 * H),           // proposed 10h ago (design_review since)
    lastHumanMsgAtMs: ago(10 * H - 2 * MIN), // feedback 2min after the proposal
    lastMsgAtMs: ago(10 * H - 3 * MIN), // the designer replied after — must NOT mask the stall
  })], NOW);
  assert.ok(s, 'must flag');
  assert.equal(s!.cls, 'feedback_unactioned');
  assert.equal(s!.number, 1011);
  // idle is measured from the unactioned human feedback, not the last agent chatter
  assert.ok(Math.abs(s!.idleMs - (10 * H - 2 * MIN)) < 1000, `idle ${s!.idleMs}`);
});

test('fresh human feedback (under the threshold) is not yet a stall', () => {
  assert.deepEqual(classifyStalls([cand({
    updatedAtMs: ago(30 * MIN),
    lastHumanMsgAtMs: ago(STALL_AFTER.feedback - MIN),
  })], NOW), []);
});

test('review gates with no feedback stall only past their waiting threshold', () => {
  assert.equal(classifyStalls([cand({ updatedAtMs: ago(3 * H) })], NOW).length, 0); // design_review waits 4h
  assert.equal(classifyStalls([cand({ updatedAtMs: ago(5 * H) })], NOW)[0]?.cls, 'awaiting_human');
  assert.equal(classifyStalls([cand({ state: 'plan_review', updatedAtMs: ago(2.5 * H) })], NOW)[0]?.cls, 'awaiting_human');
});

// --- suppressions: the ball is verifiably somewhere already ---

test('an open decision card on the task suppresses every class', () => {
  assert.deepEqual(classifyStalls([cand({
    updatedAtMs: ago(10 * H),
    lastHumanMsgAtMs: ago(9 * H),
    hasOpenDecision: true,
  })], NOW), []);
});

test('a live local run suppresses agent-active detection', () => {
  const base = { state: 'in_progress', updatedAtMs: ago(2 * H), lastBeatAtMs: ago(1 * H) };
  assert.deepEqual(classifyStalls([cand({ ...base, liveLocal: true })], NOW), []);
  const [s] = classifyStalls([cand({ ...base, liveLocal: false, hostSeenAtMs: ago(1 * H) })], NOW);
  assert.equal(s!.cls, 'stalled_active');
  assert.equal(s!.hostOffline, true, 'a host silent past the heartbeat window reads offline');
});

test('recent beats or thread activity keep an active phase un-flagged', () => {
  assert.deepEqual(classifyStalls([cand({ state: 'designing', updatedAtMs: ago(2 * H), lastBeatAtMs: ago(5 * MIN) })], NOW), []);
  assert.deepEqual(classifyStalls([cand({ state: 'in_review', updatedAtMs: ago(2 * H), lastMsgAtMs: ago(10 * MIN) })], NOW), []);
});

// --- the activity feed replaces the execution cap + the "still working" heartbeat ---

test('a run still stepping keeps a HOURS-long execution un-flagged (no time cap any more)', () => {
  // Nothing else has moved for three hours — no transition, no message, no beat. Before runs,
  // this was indistinguishable from a wedged agent, which is why execution needed a 15m wall.
  assert.deepEqual(classifyStalls([cand({
    state: 'in_progress', updatedAtMs: ago(3 * H), lastMsgAtMs: ago(3 * H),
    lastRunAtMs: ago(20_000), runOpen: true,
  })], NOW), [], 'a live run IS the progress signal');
});

test('a run row that reads running but stopped writing → stalled_active, and says so', () => {
  const [s] = classifyStalls([cand({
    state: 'in_progress', updatedAtMs: ago(3 * H), lastRunAtMs: ago(40 * MIN), runOpen: true,
  })], NOW);
  assert.equal(s!.cls, 'stalled_active');
  assert.ok(/still reads as running/.test(s!.detail), `detail names the dead run: ${s!.detail}`);
  // idle is measured from the last run write, not the transition
  assert.ok(Math.abs(s!.idleMs - 40 * MIN) < 1000, `idle ${s!.idleMs}`);
});

test('a settled run leaves the plain no-activity report', () => {
  const [s] = classifyStalls([cand({
    state: 'in_progress', updatedAtMs: ago(3 * H), lastRunAtMs: ago(2 * H), runOpen: false,
  })], NOW);
  assert.equal(s!.cls, 'stalled_active');
  assert.ok(/no run activity/.test(s!.detail), s!.detail);
});

// --- offers and routing ---

test('an offered todo nobody claimed → unclaimed_offer; an unoffered idle todo → unrouted', () => {
  assert.equal(classifyStalls([cand({ state: 'todo', offered: 'patch', updatedAtMs: ago(30 * MIN) })], NOW)[0]?.cls, 'unclaimed_offer');
  assert.deepEqual(classifyStalls([cand({ state: 'todo', offered: 'patch', updatedAtMs: ago(10 * MIN) })], NOW), []);
  assert.equal(classifyStalls([cand({ state: 'todo', updatedAtMs: ago(2 * H) })], NOW)[0]?.cls, 'unrouted');
  // intake conversation counts as routing activity — no flag while the thread moves
  assert.deepEqual(classifyStalls([cand({ state: 'todo', updatedAtMs: ago(2 * H), lastMsgAtMs: ago(10 * MIN) })], NOW), []);
});

// --- blocked and stale approvals ---

test('blocked sits past its threshold → blocked_stale; thread discussion resets the clock', () => {
  assert.equal(classifyStalls([cand({ state: 'blocked', updatedAtMs: ago(3 * H) })], NOW)[0]?.cls, 'blocked_stale');
  assert.deepEqual(classifyStalls([cand({ state: 'blocked', updatedAtMs: ago(3 * H), lastMsgAtMs: ago(30 * MIN) })], NOW), []);
});

test('done awaiting acceptance nags only after a full day', () => {
  assert.deepEqual(classifyStalls([cand({ state: 'done', updatedAtMs: ago(20 * H) })], NOW), []);
  assert.equal(classifyStalls([cand({ state: 'done', updatedAtMs: ago(30 * H) })], NOW)[0]?.cls, 'stale_done');
});

test('terminal/parked states are never a stall, whatever their age', () => {
  for (const state of ['backlog', 'accepted', 'closed']) {
    assert.deepEqual(classifyStalls([cand({ state, updatedAtMs: ago(100 * H) })], NOW), [], state);
  }
});

// --- ordering + cap ---

test('stalls sort by priority (feedback first) and cap per sweep', () => {
  const many: StallCandidate[] = [
    cand({ id: 'a', number: 1, state: 'done', updatedAtMs: ago(30 * H) }),
    cand({ id: 'b', number: 2, state: 'design_review', updatedAtMs: ago(10 * H), lastHumanMsgAtMs: ago(9 * H) }),
    cand({ id: 'c', number: 3, state: 'in_progress', updatedAtMs: ago(2 * H), hostSeenAtMs: ago(2 * H) }),
    cand({ id: 'd', number: 4, state: 'todo', offered: 'patch', updatedAtMs: ago(1 * H) }),
    cand({ id: 'e', number: 5, state: 'blocked', updatedAtMs: ago(3 * H) }),
    cand({ id: 'f', number: 6, state: 'plan_review', updatedAtMs: ago(3 * H) }),
    cand({ id: 'g', number: 7, state: 'todo', updatedAtMs: ago(2 * H) }),
  ];
  const stalls = classifyStalls(many, NOW);
  assert.equal(stalls.length, MAX_STALLS_PER_SWEEP);
  assert.equal(stalls[0]!.cls, 'feedback_unactioned');
  assert.equal(stalls[1]!.cls, 'stalled_active');
});

// --- refire keys: once per signal; slow classes re-arm by bucket ---

test('feedback keys are stable per signal — a new human message mints a new key', () => {
  const s1 = classifyStalls([cand({ updatedAtMs: ago(10 * H), lastHumanMsgAtMs: ago(9 * H) })], NOW)[0]!;
  const later = classifyStalls([cand({ updatedAtMs: ago(10 * H), lastHumanMsgAtMs: ago(9 * H) })], NOW + 30 * MIN)[0]!;
  assert.equal(stallKey(s1, NOW), stallKey(later, NOW + 30 * MIN), 'same signal → same key, whenever scanned');
  const fresh = classifyStalls([cand({ updatedAtMs: ago(10 * H), lastHumanMsgAtMs: ago(1 * H) })], NOW)[0]!;
  assert.notEqual(stallKey(s1, NOW), stallKey(fresh, NOW), 'new feedback → new key');
});

test('awaiting_human re-arms across its refire bucket; within one bucket the key holds', () => {
  const s = classifyStalls([cand({ updatedAtMs: ago(10 * H) })], NOW)[0]!;
  assert.equal(s.cls, 'awaiting_human');
  assert.equal(stallKey(s, NOW), stallKey(s, NOW + 5 * MIN));
  assert.notEqual(stallKey(s, NOW), stallKey(s, NOW + 13 * H));
});

test('fmtAge renders compact human ages', () => {
  assert.equal(fmtAge(5 * MIN), '5m');
  assert.equal(fmtAge(90 * MIN), '1.5h');
  assert.equal(fmtAge(10 * H), '10h');
  assert.equal(fmtAge(55 * H), '2.3d');
});

// --- routines (failure-alerts round): last_error is the signal, settle keeps rex out of the way ---

const rcand = (over: Partial<RoutineCandidate> = {}): RoutineCandidate => ({
  id: 's-1', title: 'Research flowe.ai competitors', status: 'active',
  lastError: 'no compute available — anthropic seats at their usage cap', lastRunAtMs: ago(2 * H), ...over,
});

test('a failed run stalls only once SETTLED — inside the window the attention bar is enough', () => {
  assert.equal(classifyRoutineStalls([rcand({ lastRunAtMs: ago(5 * MIN) })], NOW).length, 0, 'fresh failure: no rex');
  const [s] = classifyRoutineStalls([rcand()], NOW);
  assert.ok(s, 'settled failure stalls');
  assert.equal(s!.detail, 'no compute available — anthropic seats at their usage cap', 'the detail is the row’s own words');
});

test('paused rows and clean rows never stall — pausing IS the human’s mute', () => {
  assert.equal(classifyRoutineStalls([rcand({ status: 'paused' })], NOW).length, 0);
  assert.equal(classifyRoutineStalls([rcand({ lastError: null })], NOW).length, 0);
});

test('a never-claimed routine (pre-claim stall, null last_run_at) stalls on the error alone', () => {
  const [s] = classifyRoutineStalls([rcand({ lastRunAtMs: null, lastError: 'no hosted agent for this room — the run cannot start until one is online' })], NOW);
  assert.ok(s);
  assert.equal(s!.signalMs, 0, 'the never-ran episode is one stable signal');
});

test('one firing per failed run: the claim moves last_run_at, which mints a new key', () => {
  const first = classifyRoutineStalls([rcand()], NOW)[0]!;
  assert.equal(routineStallKey(first), routineStallKey(classifyRoutineStalls([rcand()], NOW + H)[0]!), 'same failed run → same key, whenever scanned');
  const next = classifyRoutineStalls([rcand({ lastRunAtMs: ago(1 * H) })], NOW)[0]!;
  assert.notEqual(routineStallKey(first), routineStallKey(next), 'a newer run’s failure → a new key');
});

test('the routine shortlist honours the sweep cap', () => {
  const many = Array.from({ length: 9 }, (_, i) => rcand({ id: `s-${i}` }));
  assert.equal(classifyRoutineStalls(many, NOW).length, MAX_STALLS_PER_SWEEP);
});

// --- an APPROVED plan is past the human gate (2026-09-16, the #1093 class) ---

test('plan_review with the approval stamp is never awaiting_human — it is a todo waiting on its offer', () => {
  const approved = cand({ state: 'plan_review', assignee: null, updatedAtMs: ago(3 * H), planApprovedAtMs: ago(3 * H) });
  assert.equal(classifyStalls([approved], NOW)[0]?.cls, 'unrouted');
  const offered = cand({ state: 'plan_review', assignee: null, offered: 'plume', updatedAtMs: ago(30 * MIN), planApprovedAtMs: ago(30 * MIN) });
  assert.equal(classifyStalls([offered], NOW)[0]?.cls, 'unclaimed_offer');
  const gated = cand({ state: 'plan_review', assignee: null, updatedAtMs: ago(3 * H), planApprovedAtMs: null });
  assert.equal(classifyStalls([gated], NOW)[0]?.cls, 'awaiting_human');
});
