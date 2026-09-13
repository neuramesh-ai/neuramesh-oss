// TodoWrite→beats reducer (beats.ts, docs/17): the worker's native todo list becomes
// ONE clean beat set — declared once, advanced by position as statuses change, stable
// against re-wording/appending. Run from apps/desktop: pnpm exec tsx --test src/main/beats.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todoBeatReducer, beatMarkerReducer, stripBeatMarkers, createBeatRun, designerBeatTitles, architectBeatTitles, reviewerBeatTitles, type BeatOp } from './beats';

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status });

test('first non-empty list declares the set and marks the in_progress todo active', () => {
  const reduce = todoBeatReducer();
  const ops = reduce([
    todo('Reproduce the bug', 'in_progress'),
    todo('Write a failing test', 'pending'),
    todo('Fix it', 'pending'),
  ]);
  assert.deepEqual(ops[0], { op: 'declare', items: ['Reproduce the bug', 'Write a failing test', 'Fix it'] });
  // only the in_progress beat (seq 0) differs from the declared all-pending baseline
  assert.deepEqual(ops.slice(1), [{ op: 'advance', seq: 0, status: 'active' }]);
});

test('an empty todo list never declares — it waits for a real plan', () => {
  const reduce = todoBeatReducer();
  assert.deepEqual(reduce([]), []);
  assert.deepEqual(reduce([todo('', 'pending')]), []); // blank content filtered out → still empty
  // a real list after the empties still declares cleanly as the first set
  const ops = reduce([todo('Do the thing', 'pending')]);
  assert.deepEqual(ops, [{ op: 'declare', items: ['Do the thing'] }]);
});

test('status progression advances only the beat that changed', () => {
  const reduce = todoBeatReducer();
  reduce([todo('A', 'in_progress'), todo('B', 'pending')]); // declare + A active
  // A completes, B starts
  const ops = reduce([todo('A', 'completed'), todo('B', 'in_progress')]);
  assert.deepEqual(ops, [
    { op: 'advance', seq: 0, status: 'done' },
    { op: 'advance', seq: 1, status: 'active' },
  ]);
});

test('re-emitting the same list produces no ops (no duplicate advances)', () => {
  const reduce = todoBeatReducer();
  reduce([todo('A', 'in_progress'), todo('B', 'pending')]);
  assert.deepEqual(reduce([todo('A', 'in_progress'), todo('B', 'pending')]), []);
});

test('the set is declared once — later re-wording and appended todos never re-declare', () => {
  const reduce = todoBeatReducer();
  reduce([todo('Draft', 'in_progress'), todo('Ship', 'pending')]); // 2-beat set
  // the worker re-words item 2 and appends a third; still ONE stable set, no re-declare
  const ops = reduce([todo('Draft', 'completed'), todo('Ship it carefully', 'in_progress'), todo('Celebrate', 'pending')]);
  assert.ok(!ops.some((o: BeatOp) => o.op === 'declare'), 'must not re-declare');
  // seq 0 → done; seq 1 → active (matched by position, original title kept); the extra todo is ignored
  assert.deepEqual(ops, [
    { op: 'advance', seq: 0, status: 'done' },
    { op: 'advance', seq: 1, status: 'active' },
  ]);
});

test('all todos completed drives every beat to done', () => {
  const reduce = todoBeatReducer();
  reduce([todo('A', 'in_progress'), todo('B', 'pending'), todo('C', 'pending')]);
  const ops = reduce([todo('A', 'completed'), todo('B', 'completed'), todo('C', 'completed')]);
  assert.deepEqual(ops, [
    { op: 'advance', seq: 0, status: 'done' },
    { op: 'advance', seq: 1, status: 'done' },
    { op: 'advance', seq: 2, status: 'done' },
  ]);
});

test('a set is capped at 12 beats (matches the command surface)', () => {
  const reduce = todoBeatReducer();
  const big = Array.from({ length: 20 }, (_, i) => todo(`step ${i}`, 'pending'));
  const [declare] = reduce(big) as [Extract<BeatOp, { op: 'declare' }>];
  assert.equal(declare.op, 'declare');
  assert.equal(declare.items.length, 12);
});

// --- codex/gemini live-ticking markers (NM_BEAT_DONE <n>) ---

test('a NM_BEAT_DONE marker finishes that beat and lights the next', () => {
  const reduce = beatMarkerReducer();
  const ops = reduce('...working... NM_BEAT_DONE 1\nmoving on');
  assert.deepEqual(ops, [
    { op: 'advance', seq: 0, status: 'done' },
    { op: 'advance', seq: 1, status: 'active' },
  ]);
});

test('re-scanning cumulative stream output never double-advances a marker', () => {
  const reduce = beatMarkerReducer();
  reduce('step one done\nNM_BEAT_DONE 1\n'); // first flush
  // the stream arrives cumulatively — the same marker is present again, plus a new one
  const ops = reduce('step one done\nNM_BEAT_DONE 1\nstep two done\nNM_BEAT_DONE 2\n');
  assert.deepEqual(ops, [
    { op: 'advance', seq: 1, status: 'done' },
    { op: 'advance', seq: 2, status: 'active' },
  ]);
});

test('markers out of range (0, non-numeric, >12) are ignored', () => {
  const reduce = beatMarkerReducer();
  assert.deepEqual(reduce('NM_BEAT_DONE 0 NM_BEAT_DONE 13 NM_BEAT_DONE x'), []);
});

test('stripBeatMarkers removes the protocol lines but keeps the real summary', () => {
  const raw = 'Fixed the focus trap.\nNM_BEAT_DONE 1\n  NM_BEAT_DONE 2  \nAll tests green.';
  assert.equal(stripBeatMarkers(raw), 'Fixed the focus trap.\nAll tests green.');
});

// --- createBeatRun: the worker-run coordinator (nm tools + TodoWrite, first-declare-wins) ---

const runHarness = () => {
  const ops: string[] = [];
  const run = createBeatRun({
    declare: async (items) => { ops.push(`declare:${items.join('|')}`); },
    advance: async (seq, status) => { ops.push(`adv:${seq}:${status}`); },
  });
  return { ops, run };
};

test('tool path: declare lights beat 0; advance_beat completes and lights the next', async () => {
  const { ops, run } = runHarness();
  assert.match(run.declare(['Find the file', 'Convert to PDF', 'Attach it']), /3 steps/);
  assert.match(run.complete(1), /step 2 is now active/);
  assert.match(run.complete(3), /all steps complete/);
  await run.settle();
  assert.deepEqual(ops, [
    'declare:Find the file|Convert to PDF|Attach it',
    'adv:0:active',
    'adv:0:done', 'adv:1:active',
    'adv:2:done', // step 3 is the last — nothing after it to light
  ]);
});

test('tool path guards: complete-before-declare, out-of-range, duplicates, re-declare', async () => {
  const { ops, run } = runHarness();
  assert.match(run.complete(1), /no beat plan declared yet/);
  run.declare(['a', 'b']);
  assert.match(run.complete(5), /between 1 and 2/);
  assert.match(run.complete(1), /done/);
  assert.match(run.complete(1), /already marked/);
  assert.match(run.declare(['x']), /already active/);
  await run.settle();
  assert.deepEqual(ops, ['declare:a|b', 'adv:0:active', 'adv:0:done', 'adv:1:active']);
});

test('blocked step: marks blocked and does not light the next', async () => {
  const { ops, run } = runHarness();
  run.declare(['a', 'b', 'c']);
  assert.match(run.complete(2, true), /marked blocked/);
  await run.settle();
  assert.deepEqual(ops, ['declare:a|b|c', 'adv:0:active', 'adv:1:blocked']);
});

test('out-of-order completion never re-lights an already-completed next step', async () => {
  const { ops, run } = runHarness();
  run.declare(['a', 'b']);
  run.complete(2);
  run.complete(1);
  await run.settle();
  // completing 1 after 2: 2 is already done → no adv:1:active resurrection
  assert.deepEqual(ops, ['declare:a|b', 'adv:0:active', 'adv:1:done', 'adv:0:done']);
});

test('first-declare-wins: tools own the run — later todo snapshots are absorbed silently', async () => {
  const { ops, run } = runHarness();
  run.declare(['tool step 1', 'tool step 2']);
  run.absorbTodos([{ content: 'todo A', status: 'in_progress' }, { content: 'todo B', status: 'pending' }]);
  run.absorbTodos([{ content: 'todo A', status: 'completed' }, { content: 'todo B', status: 'in_progress' }]);
  await run.settle();
  assert.deepEqual(ops, ['declare:tool step 1|tool step 2', 'adv:0:active']);
});

test('first-declare-wins: todos own the run — declare_beats refuses, advance_beat still works', async () => {
  const { ops, run } = runHarness();
  run.absorbTodos([{ content: 'todo A', status: 'in_progress' }, { content: 'todo B', status: 'pending' }]);
  assert.match(run.declare(['x', 'y']), /already active/);
  assert.match(run.complete(1), /done/); // same set, same 1-based positions
  await run.settle();
  assert.deepEqual(ops, ['declare:todo A|todo B', 'adv:0:active', 'adv:0:done', 'adv:1:active']);
});

// --- phase-attempt titles: a rework round must be VISIBLY a new set (docs/17 §5) ---

test('designer titles: round 1 = the canonical milestones; a rework round names the rework', () => {
  assert.deepEqual(designerBeatTitles(1), ['Study the existing design system', 'Draft and render the mockups']);
  const r2 = designerBeatTitles(2);
  assert.equal(r2.length, 2, 'the flow advances exactly two milestones — the count must not change');
  assert.notDeepEqual(r2, designerBeatTitles(1), 'a rework set must not be indistinguishable from round 1');
  assert.match(r2[1]!, /round 2/);
});

test('architect titles: v1 = the canonical milestones; a re-plan names the version', () => {
  assert.equal(architectBeatTitles(1).length, 4);
  assert.deepEqual(architectBeatTitles(1)[0], 'Map the requirements and affected code');
  const v3 = architectBeatTitles(3);
  assert.equal(v3.length, 4, 'the mixture-of-agents flow advances exactly four milestones');
  assert.notDeepEqual(v3, architectBeatTitles(1));
  assert.match(v3[3]!, /plan v3/);
});

test('reviewer titles: repo-backed keeps the CI gate; a re-review names the round', () => {
  assert.deepEqual(reviewerBeatTitles(true, 1), ['Confirm the pull request is reviewable', 'Settle CI on the pull request', 'Review against the Definition of Done']);
  assert.deepEqual(reviewerBeatTitles(false, 1), ['Confirm the submission is reviewable', 'Review against the Definition of Done']);
  assert.equal(reviewerBeatTitles(true, 2).length, 3);
  assert.equal(reviewerBeatTitles(false, 2).length, 2);
  assert.match(reviewerBeatTitles(true, 2)[2]!, /round 2/);
  assert.match(reviewerBeatTitles(false, 3)[1]!, /round 3/);
});

// ── closeOut: the set must not keep spinning once the phase has moved ─────────────────────────
// Live defect: a worker declared 7 steps, ticked 4, submitted — and the tracker showed "4/7" with
// step 5 pulsing long after the task reached in_review. `settle()` flushes writes; it never closed
// the set, and the animation is driven by status === 'active'.

function runWith() {
  const ops: Array<[number, string]> = [];
  const run = createBeatRun({
    declare: async () => {},
    advance: async (seq, status) => { ops.push([seq, status]); },
  });
  return { run, ops };
}

test('closeOut retires the in-flight step and leaves untouched ones pending', async () => {
  const { run, ops } = runWith();
  run.declare(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  run.complete(1); run.complete(2); run.complete(3); run.complete(4);
  await run.settle();
  ops.length = 0;

  await run.closeOut();
  // step 5 was active (4 done → seq 4 activated); it is marked done, and 6/7 stay pending
  assert.deepEqual(ops, [[4, 'done']], 'exactly the in-flight step, nothing rounded up');
});

test('after closeOut nothing is left active — which is what stops the spinner', async () => {
  const { run, ops } = runWith();
  run.declare(['a', 'b', 'c']);
  run.complete(1);
  await run.settle();
  await run.closeOut();
  // an 'active' write after the final 'done' would re-arm the animation
  const last = ops[ops.length - 1];
  assert.equal(last?.[1], 'done', `last op was ${JSON.stringify(last)}`);
  assert.equal(ops.filter(([, s]) => s === 'active').filter((_, i, a) => i === a.length - 1).length <= 1, true);
});

test('closeOut is idempotent and safe on a fully ticked or undeclared run', async () => {
  const { run, ops } = runWith();
  run.declare(['a', 'b']);
  run.complete(1); run.complete(2);
  await run.settle();
  ops.length = 0;
  await run.closeOut();
  await run.closeOut();
  assert.deepEqual(ops, [], 'every step already done — nothing to retire');

  const bare = runWith();
  await bare.run.closeOut();
  assert.deepEqual(bare.ops, [], 'a run that never declared has no set to close');
});
