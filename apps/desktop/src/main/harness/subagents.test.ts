// Subagents (docs/harness/04). Run: pnpm exec tsx --test src/main/harness/subagents.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TURN_BUDGETS, toolsForKind, buildRunTrees, flattenRunTree, subtreeSize, deepestActive } from '@neuramesh/shared';
import { planSpawn, planFanout, Subtree, childKind, narrowPolicy, type SpawnSpec } from './subagents';

const spec = (role: string, label = role): SpawnSpec => ({ role: role as SpawnSpec['role'], prompt: `do the ${label} work`, label });

// ── Budget as the recursion terminator ───────────────────────────────────────────────────────
test('a parent can afford a child, and the child gets a slice of the remainder', () => {
  const d = planSpawn(TURN_BUDGETS.work, spec('designer'));
  assert.equal(d.ok, true);
  assert.ok(d.budget!.wallMs < TURN_BUDGETS.work.wallMs, 'a child never gets the whole parent');
  assert.ok(d.budget!.wallMs > 0);
});

test('an explicit budget request may only NARROW what the parent affords', () => {
  const generous = planSpawn(TURN_BUDGETS.work, { ...spec('designer'), budget: { wallMs: 999 * 60_000 } });
  assert.ok(generous.budget!.wallMs < 999 * 60_000, 'a child cannot ask its way past its parent');
  const modest = planSpawn(TURN_BUDGETS.work, { ...spec('designer'), budget: { wallMs: 60_000 } });
  assert.equal(modest.budget!.wallMs, 60_000, 'a smaller request is honoured');
});

test('TERMINATION — depth halts on budget, at whatever depth that happens to be', () => {
  let remaining = { ...TURN_BUDGETS.work };
  let depth = 0;
  for (;;) {
    const d = planSpawn(remaining, spec('developer'));
    if (!d.ok) break;
    remaining = d.budget!;
    depth += 1;
    assert.ok(depth < 100, 'must terminate');
  }
  assert.ok(depth > 1, 'and not immediately — real nesting is possible');
  const refused = planSpawn(remaining, spec('developer'));
  assert.match(refused.reason!, /not enough budget/);
});

test('a wide fan-out divides the remainder and REFUSES the overflow rather than dropping it', () => {
  const many = Array.from({ length: 12 }, (_, i) => spec('designer', `angle-${i}`));
  const plan = planFanout(TURN_BUDGETS.work, many);
  assert.equal(plan.length, 12, 'every request is accounted for — none vanishes');
  const ok = plan.filter((p) => p.decision.ok);
  const refused = plan.filter((p) => !p.decision.ok);
  assert.ok(ok.length > 0 && refused.length > 0, 'some run, the rest are explicitly refused');
  const totalWall = ok.reduce((n, p) => n + p.decision.budget!.wallMs, 0);
  assert.ok(totalWall <= TURN_BUDGETS.work.wallMs, 'a subtree cannot exceed its root');
  for (const r of refused) assert.match(r.decision.reason!, /not enough budget/);
});

// ── Identity + toolset: the enforcement that needs no new FSM guard ───────────────────────────
test('a subagent is always a `leg` turn, whatever role it is seated as', () => {
  assert.equal(childKind(), 'leg');
  // a "designer subagent" must not inherit a design TURN's board tools just because its role says so
  const legTools = toolsForKind('leg');
  assert.ok(!legTools.includes('add_subtask'), 'a board row belongs to the parent');
  assert.ok(!legTools.includes('add_backlog_item'));
  assert.ok(legTools.includes('record_lesson'));
});

test('a subagent policy may only narrow — a locked rule is locked all the way down', () => {
  type Rule = { capability: string; verdict: 'allow' | 'ask' | 'deny'; locked?: boolean };
  const parent: Rule[] = [
    { capability: 'shell.exec', verdict: 'ask' },
    { capability: 'fs.read', verdict: 'deny', locked: true },
    { capability: 'net.egress', verdict: 'allow' },
  ];
  const merged = narrowPolicy<Rule>(parent, [
    { capability: 'shell.exec', verdict: 'deny' },   // narrower → wins
    { capability: 'fs.read', verdict: 'allow' },      // tries to widen a LOCKED rule
    { capability: 'net.egress', verdict: 'allow' },   // same → unchanged
  ]);
  assert.equal(merged.find((r) => r.capability === 'shell.exec')!.verdict, 'deny');
  assert.equal(merged.find((r) => r.capability === 'fs.read')!.verdict, 'deny', 'a locked rule cannot be relaxed by a child');
  assert.equal(merged.find((r) => r.capability === 'net.egress')!.verdict, 'allow');
});

test('a child cannot mint a locked rule of its own', () => {
  type Rule = { capability: string; verdict: 'allow' | 'ask' | 'deny'; locked?: boolean };
  const merged = narrowPolicy<Rule>([{ capability: 'shell.exec', verdict: 'allow' }], [{ capability: 'vcs.push', verdict: 'deny', locked: true }]);
  assert.ok(!merged.some((r) => r.capability === 'vcs.push'), 'only a workspace mints locked rules');
});

// ── Ownership ────────────────────────────────────────────────────────────────────────────────
test('a parent cannot settle while anything below it is still running', () => {
  const st = new Subtree('parent-1');
  st.add({ turnId: 'c1', role: 'designer', label: 'direction A', state: 'running' });
  st.add({ turnId: 'c2', role: 'designer', label: 'direction B', state: 'running' });
  assert.equal(st.closed, false);
  st.settle('c1', 'done', '3 mockups');
  assert.equal(st.closed, false, 'one open child still holds the parent');
  st.settle('c2', 'failed', 'budget exhausted');
  assert.equal(st.closed, true);
});

test('a failed child is NAMED in the rollup, never quietly omitted', () => {
  const st = new Subtree('p');
  st.add({ turnId: 'c1', role: 'designer', label: 'direction A', state: 'running' });
  st.add({ turnId: 'c2', role: 'designer', label: 'direction B', state: 'running' });
  st.add({ turnId: 'c3', role: 'reviewer', label: 'a11y pass', state: 'running' });
  st.settle('c1', 'done');
  st.settle('c2', 'done');
  st.settle('c3', 'failed');
  const line = st.rollup();
  assert.match(line, /2 designers/);
  assert.match(line, /1 reviewer\b/);
  assert.match(line, /2\/3 done/);
  assert.match(line, /1 failed \(a11y pass\)/, 'the human can see the hole');
});

test('an empty subtree rolls up to nothing, and is closed', () => {
  const st = new Subtree('p');
  assert.equal(st.rollup(), '');
  assert.equal(st.closed, true);
});

// ── The recursive run tree (the UI fix) ──────────────────────────────────────────────────────
const run = (id: string, parent: string | null, started: string, state = 'running', title = id) =>
  ({ id, parent_run_id: parent, started_at: started, state, title });

test('THE ORPHAN BUG — a grandchild now renders; before, it appeared nowhere at all', () => {
  const rows = [
    run('root', null, '01'),
    run('child', 'root', '02'),
    run('grandchild', 'child', '03'),
  ];
  const trees = buildRunTrees(rows, () => true);
  assert.equal(trees.length, 1, 'one root');
  assert.equal(trees[0]!.legs.length, 1);
  assert.equal(trees[0]!.legs[0]!.legs.length, 1, 'the grandchild is placed');
  assert.equal(trees[0]!.legs[0]!.legs[0]!.run.id, 'grandchild');
  assert.deepEqual(flattenRunTree(trees[0]!).map((n) => n.run.id), ['root', 'child', 'grandchild']);
  assert.deepEqual(flattenRunTree(trees[0]!).map((n) => n.depth), [0, 1, 2], 'depth drives the indent');
});

test('legs sort by start time at every level, and never appear as roots', () => {
  const trees = buildRunTrees([
    run('root', null, '01'),
    run('b', 'root', '03'),
    run('a', 'root', '02'),
  ], () => true);
  assert.deepEqual(trees.map((t) => t.run.id), ['root']);
  assert.deepEqual(trees[0]!.legs.map((l) => l.run.id), ['a', 'b']);
});

test('a leg whose parent was pruned by retention becomes a root instead of vanishing', () => {
  const trees = buildRunTrees([run('orphan', 'long-gone-parent', '01')], () => true);
  assert.equal(trees.length, 1);
  assert.equal(trees[0]!.run.id, 'orphan');
});

test('isRoot scopes a surface — a task tree does not pick up a thread run', () => {
  const rows = [
    { ...run('taskrun', null, '01'), task_id: 't1' },
    { ...run('threadrun', null, '02'), task_id: null },
  ];
  const trees = buildRunTrees(rows, (r) => r.task_id === 't1');
  assert.deepEqual(trees.map((t) => t.run.id), ['taskrun']);
});

test('a corrupt cyclic parent chain cannot hang the renderer', () => {
  const trees = buildRunTrees([
    { id: 'a', parent_run_id: 'b', started_at: '01' },
    { id: 'b', parent_run_id: 'a', started_at: '02' },
  ], () => true);
  // neither is a root by the parent test, so the surface renders nothing rather than looping forever
  assert.equal(trees.length, 0);
});

test('subtreeSize counts every descendant — the collapse affordance\'s number', () => {
  const trees = buildRunTrees([
    run('root', null, '01'), run('c1', 'root', '02'), run('c2', 'root', '03'), run('g1', 'c1', '04'),
  ], () => true);
  assert.equal(subtreeSize(trees[0]!), 3);
  assert.equal(subtreeSize(trees[0]!.legs[0]!), 1);
});

test('the dock names the DEEPEST running leaf, not the root', () => {
  const trees = buildRunTrees([
    run('root', null, '01', 'running', 'three directions'),
    run('c1', 'root', '02', 'done', 'direction A'),
    run('c2', 'root', '03', 'running', 'direction B'),
    run('g1', 'c2', '04', 'running', 'empty + error states'),
  ], () => true);
  const deepest = deepestActive(trees[0]!);
  assert.equal(deepest!.node.run.id, 'g1');
  assert.equal(deepest!.node.depth, 2);
  assert.deepEqual(deepest!.path, ['direction B', 'empty + error states'], 'the path is what makes a scrolled-away tree true');
});

test('a settled tree has no active leaf', () => {
  const trees = buildRunTrees([run('root', null, '01', 'done')], () => true);
  assert.equal(deepestActive(trees[0]!), null);
});
