// Berth policy (worktree-berths round). Run: pnpm exec tsx --test src/main/harness/berths.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBerth, decideSweep, capsFromEnv, DEFAULT_CAPS, type BerthEntry, type DonorEntry, type CloneEntry } from './berths';

const berth = (n: number, state: string | null, mtimeMs: number, bytes = 1e9): BerthEntry =>
  ({ taskNumber: n, boardState: state, mtimeMs, bytes, repoId: 'r1', branch: `nm/${n}-x` });
const donor = (repoId: string, hash: string, createdAt: string, bytes = 1e9): DonorEntry => ({ repoId, hash, createdAt, bytes });
const clone = (repoId: string, openTasks: number, mtimeMs: number, bytes = 1e9): CloneEntry => ({ repoId, openTasks, mtimeMs, bytes });

test('classification: active work is leased, submitted is warm, settled is dead, no row is orphan', () => {
  for (const s of ['in_progress', 'todo', 'blocked', 'designing', 'planning', 'plan_review']) {
    assert.equal(classifyBerth(s), 'leased', s);
  }
  for (const s of ['in_review', 'done', 'shipping', 'releasing', 'verifying']) assert.equal(classifyBerth(s), 'warm', s);
  for (const s of ['accepted', 'closed']) assert.equal(classifyBerth(s), 'dead', s);
  assert.equal(classifyBerth(null), 'orphan');
});

test('a state this code has never heard of is LEASED — the safe reading of unknown is "someone may be working"', () => {
  assert.equal(classifyBerth('some_future_state'), 'leased');
  const actions = decideSweep([berth(1, 'some_future_state', 0, 100e9)], [], [], DEFAULT_CAPS);
  assert.deepEqual(actions, [], 'even 5× over budget, an unknown state is untouchable');
});

test('leased berths are never an action, whatever the budget says', () => {
  const actions = decideSweep(
    [berth(1, 'in_progress', 0, 50e9), berth(2, 'blocked', 0, 50e9)],
    [], [], DEFAULT_CAPS,
  );
  assert.deepEqual(actions, []);
});

test('dead and orphan berths are removed unconditionally', () => {
  const actions = decideSweep(
    [berth(1, 'accepted', 0), berth(2, null, 0), berth(3, 'in_progress', 0)],
    [], [], DEFAULT_CAPS,
  );
  assert.deepEqual(actions.map((a) => [a.kind, 'taskNumber' in a ? a.taskNumber : 0, a.reason]), [
    ['remove-berth', 1, 'dead'],
    ['remove-berth', 2, 'orphan'],
  ]);
});

test('the warm cap keeps the newest, evicts the oldest', () => {
  const actions = decideSweep(
    [berth(1, 'in_review', 100), berth(2, 'done', 200), berth(3, 'in_review', 300)],
    [], [], { warmMax: 2, budgetBytes: 1e15 },
  );
  assert.deepEqual(actions, [{ kind: 'evict-berth', taskNumber: 1, repoId: 'r1', branch: 'nm/1-x', reason: 'warm-cap' }]);
});

test('budget pressure: oldest warm → spare donors (newest survives) → idle clones, and stops once under', () => {
  const actions = decideSweep(
    [berth(1, 'in_review', 100, 6e9), berth(2, 'in_progress', 200, 6e9)],
    [donor('r1', 'new', '2026-08-09', 6e9), donor('r1', 'old', '2026-08-01', 6e9)],
    [clone('r1', 1, 100, 6e9), clone('r2', 0, 100, 6e9)],
    { warmMax: 10, budgetBytes: 12e9 },
  );
  assert.deepEqual(actions, [
    { kind: 'evict-berth', taskNumber: 1, repoId: 'r1', branch: 'nm/1-x', reason: 'budget' },
    { kind: 'drop-donor', repoId: 'r1', hash: 'old', reason: 'budget' },
    { kind: 'drop-clone', repoId: 'r2', reason: 'budget' },
  ]);
  // what survives: the leased berth, the NEWEST donor, the clone with open tasks — the floor.
  // 6+6+6 = 18e9 > budget 12e9, and that is the correct terminal state: protected state may
  // exceed the budget; the sweep never eats the newest donor or a leased berth to meet it.
});

test('convergence: applying the actions and re-sweeping yields none', () => {
  const berths = [berth(1, 'accepted', 0), berth(2, 'in_review', 100), berth(3, 'in_review', 200), berth(4, 'in_progress', 0)];
  const first = decideSweep(berths, [], [], { warmMax: 1, budgetBytes: 1e15 });
  const goneNumbers = new Set(first.filter((a) => 'taskNumber' in a).map((a) => (a as { taskNumber: number }).taskNumber));
  const second = decideSweep(berths.filter((b) => !goneNumbers.has(b.taskNumber)), [], [], { warmMax: 1, budgetBytes: 1e15 });
  assert.deepEqual(second, []);
});

test('capsFromEnv: numbers read, junk falls back to defaults', () => {
  assert.deepEqual(capsFromEnv({ NM_WARM_BERTHS: '2', NM_CACHE_BUDGET_GB: '5' } as NodeJS.ProcessEnv), { warmMax: 2, budgetBytes: 5e9 });
  assert.deepEqual(capsFromEnv({ NM_WARM_BERTHS: 'lots', NM_CACHE_BUDGET_GB: '-3' } as NodeJS.ProcessEnv), DEFAULT_CAPS);
  assert.deepEqual(capsFromEnv({} as NodeJS.ProcessEnv), DEFAULT_CAPS);
});
