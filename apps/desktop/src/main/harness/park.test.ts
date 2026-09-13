// Park (docs/harness/05 §3.8). Run: pnpm exec tsx --test src/main/harness/park.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUN_STATES, RUN_TERMINAL_STATES, isRunOpen , TOOL_KINDS } from '@neuramesh/shared';
import { planPark, shouldWake, canPark, parkStepLine, resumeNote, ParkBook, MAX_PARK_MS, PARKABLE_KINDS, type ParkRequest, type ParkRecord } from './park';

const req = (over: Partial<ParkRequest> = {}): ParkRequest => ({
  turnId: 't1', kind: 'work', agentId: 'patch',
  subject: { taskId: 'task-1' },
  condition: { on: 'ci', prNumber: 231 },
  prompt: 'merge once CI is green',
  ...over,
});

// ── The state model: the single decision the whole feature rests on ───────────────────────────
test('parked is OPEN, not terminal — which is why nothing else in the UI had to change', () => {
  assert.ok((RUN_STATES as readonly string[]).includes('parked'));
  assert.ok(!(RUN_TERMINAL_STATES as readonly string[]).includes('parked'), 'a parked turn has not finished');
  assert.equal(isRunOpen('parked'), true, 'the rail row, the run dock and the phase ring keep painting it');
  assert.equal(isRunOpen('running'), true);
  assert.equal(isRunOpen('done'), false);
  assert.equal(isRunOpen('failed'), false);
});

// ── What may park ─────────────────────────────────────────────────────────────────────────────
test('only turns that own real work may park; a subagent may not', () => {
  for (const k of ['work', 'review', 'ship', 'deep'] as const) assert.equal(canPark(k), true);
  // a parked child holding its parent's turn open for an hour is a new failure shape (docs/harness/04 OQ2)
  assert.equal(canPark('leg'), false);
  assert.equal(canPark('chat'), false);
  assert.equal(canPark('triage'), false);
});

test('a leg park is refused with a reason that says what to do instead', () => {
  const r = planPark(req({ kind: 'leg' }), 0);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /finish or fail/);
});

test('a duration park is bounded — no park may wait forever', () => {
  assert.equal(planPark(req({ condition: { on: 'duration', afterMs: 0 } }), 0).ok, false);
  assert.equal(planPark(req({ condition: { on: 'duration', afterMs: -5 } }), 0).ok, false);
  const tooLong = planPark(req({ condition: { on: 'duration', afterMs: MAX_PARK_MS + 1 } }), 0);
  assert.equal(tooLong.ok, false);
  assert.match((tooLong as { reason: string }).reason, /may not exceed/);
  assert.equal(planPark(req({ condition: { on: 'duration', afterMs: 6 * 60_000 } }), 0).ok, true);
});

test('a signal park still gets an expiry, so an unresolved wait cannot hold a task silently', () => {
  const r = planPark(req(), 1_000);
  assert.equal(r.ok, true);
  assert.equal((r as { record: ParkRecord }).record.expiresAt, 1_000 + MAX_PARK_MS);
});

// ── Wake evaluation ───────────────────────────────────────────────────────────────────────────
const rec = (over: Partial<ParkRecord> = {}): ParkRecord => ({ ...req(), parkedAt: 0, expiresAt: MAX_PARK_MS, ...over });

test('CI — pending keeps waiting; a verdict wakes', () => {
  const r = rec();
  assert.equal(shouldWake(r, { ci: { 231: 'pending' } }, 1_000), null);
  assert.equal(shouldWake(r, {}, 1_000), null, 'no verdict yet is not a verdict');
  assert.equal(shouldWake(r, { ci: { 231: 'pass' } }, 1_000), 'ci');
  assert.equal(shouldWake(r, { ci: { 231: 'fail' } }, 1_000), 'ci', 'a failure is an answer too');
});

test('CI — `none` (no CI configured) is an ANSWER, not an absence', () => {
  // The reviewer path already treats no-CI as "proceed", so a park on it must not hang to expiry.
  assert.equal(shouldWake(rec(), { ci: { 231: 'none' } }, 1_000), 'ci');
});

test('duration wakes exactly when it is due, not before', () => {
  const r = rec({ condition: { on: 'duration', afterMs: 60_000 }, expiresAt: 60_000 });
  assert.equal(shouldWake(r, {}, 59_999), null);
  assert.equal(shouldWake(r, {}, 60_000), 'duration');
});

test('a subagents park wakes when the subtree closes', () => {
  const r = rec({ condition: { on: 'subagents', parentTurnId: 'p1' } });
  assert.equal(shouldWake(r, { subtreeClosed: { p1: false } }, 1), null);
  assert.equal(shouldWake(r, { subtreeClosed: { p1: true } }, 1), 'subagents');
});

test('an answer park wakes when the human answers', () => {
  const r = rec({ condition: { on: 'answer', questionId: 'q1' } });
  assert.equal(shouldWake(r, { answered: { q1: false } }, 1), null);
  assert.equal(shouldWake(r, { answered: { q1: true } }, 1), 'answer');
});

test('EXPIRY WINS — an expired park wakes regardless of its condition', () => {
  // A bounded wrong answer beats an unbounded silence: the agent reports what it has.
  const r = rec({ expiresAt: 5_000 });
  assert.equal(shouldWake(r, { ci: { 231: 'pending' } }, 5_000), 'timeout');
});

// ── Copy: the human must know what it waits on ────────────────────────────────────────────────
test('the step line names the wait in plain words', () => {
  assert.equal(parkStepLine(rec()), 'waiting on CI · PR #231');
  assert.equal(parkStepLine(rec({ condition: { on: 'duration', afterMs: 6 * 60_000 } })), 'waiting 6m');
  assert.equal(parkStepLine(rec({ condition: { on: 'subagents', parentTurnId: 'p' } })), 'waiting on its subagents');
  assert.equal(parkStepLine(rec({ condition: { on: 'answer', questionId: 'q' } })), 'waiting on your answer');
});

test('a resumed turn is told why it is running again — and a timeout says so honestly', () => {
  assert.match(resumeNote(rec(), 'ci'), /has now resolved \(ci\)/);
  assert.match(resumeNote(rec(), 'ci'), /merge once CI is green/, 'the original intent is carried back');
  const t = resumeNote(rec(), 'timeout');
  assert.match(t, /did not resolve/);
  assert.match(t, /say plainly what is unresolved/, 'a timeout must not be reported as success');
});

// ── The book ─────────────────────────────────────────────────────────────────────────────────
test('the book returns only what is due, oldest first', () => {
  const book = new ParkBook();
  book.park(rec({ turnId: 'early', parkedAt: 100, condition: { on: 'ci', prNumber: 1 } }));
  book.park(rec({ turnId: 'late', parkedAt: 900, condition: { on: 'ci', prNumber: 2 } }));
  book.park(rec({ turnId: 'waiting', parkedAt: 500, condition: { on: 'ci', prNumber: 3 } }));

  const due = book.due({ ci: { 1: 'pass', 2: 'fail', 3: 'pending' } }, 1_000);
  assert.deepEqual(due.map((d) => d.record.turnId), ['early', 'late'], 'pending stays parked; wakes drain fairly');
  assert.deepEqual(due.map((d) => d.why), ['ci', 'ci']);
});

test('release removes a turn from the book so it cannot wake twice', () => {
  const book = new ParkBook();
  book.park(rec({ turnId: 't1' }));
  assert.equal(book.due({ ci: { 231: 'pass' } }, 1).length, 1);
  book.release('t1');
  assert.equal(book.due({ ci: { 231: 'pass' } }, 1).length, 0);
  assert.equal(book.get('t1'), undefined);
});

test('an empty book is quiet', () => {
  assert.deepEqual(new ParkBook().due({}, Date.now()), []);
});

// ── The two park lists must not drift ─────────────────────────────────────────────────────────
// `TOOL_KINDS.park` (shared) decides whether the model is HANDED the park tool; `PARKABLE_KINDS`
// (here) decides whether a park it asks for is accepted. Disagree and you get the worst shape:
// a tool the model can see and call, that always refuses.
test('PARKABLE_KINDS and TOOL_KINDS.park are the same set', () => {
  assert.deepEqual([...PARKABLE_KINDS].sort(), [...TOOL_KINDS.park].sort());
});

test('an owning turn may park — it is the one left waiting on CI', () => {
  // under orchestrator ownership no worker holds the task, so the owner has to be the one that
  // waits for the checks on a PR its subagents pushed
  assert.equal(canPark('own'), true);
  assert.equal(canPark('leg'), false, 'a parked child holding its parent open stays impossible');
  assert.equal(canPark('triage'), false, 'a routing turn answers, it does not wait');
  assert.equal(canPark('chat'), false);
});
