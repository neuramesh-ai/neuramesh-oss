// renderer runs/runs.ts (track A2). Named runs-ui because src/main/runs.ts (the daemon's run
// writer) owns runs.test.ts — same noun, different subject.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTrees, parseSeat, shortModel, rollupChips, isWatchableRun } from '../renderer/src/runs/runs';
import type { RunUI } from '../renderer/src/bridge/rows-board';

const row = (over: Partial<RunUI> = {}): RunUI =>
  ({ id: 'r1', parent_run_id: null, agent_id: 'a1', kind: 'work', state: 'running', title: 't',
     done: 0, total: 0, thread_id: null, task_id: null, seat: null, started_at: new Date().toISOString(),
     ended_at: null, tools: 0, ...over }) as RunUI;

test('runTrees scopes to ONE surface: task, else thread, else the room feed', () => {
  const rows = [row({ id: 'task', task_id: 'tk1' }), row({ id: 'thread', thread_id: 'th1' }), row({ id: 'feed' })];
  assert.deepEqual(runTrees(rows, { taskId: 'tk1' }).map((t) => t.run.id), ['task']);
  assert.deepEqual(runTrees(rows, { threadId: 'th1' }).map((t) => t.run.id), ['thread']);
  assert.deepEqual(runTrees(rows, {}).map((t) => t.run.id), ['feed'],
    'the room feed is runs born in the channel itself — never the thread/task ones');
});

test('a fan-out nests: legs hang off their parent, and a GRANDCHILD is not orphaned', () => {
  const rows = [row({ id: 'root', thread_id: 'th1' }),
                row({ id: 'leg', parent_run_id: 'root', thread_id: 'th1' }),
                row({ id: 'grand', parent_run_id: 'leg', thread_id: 'th1' })];
  const [tree] = runTrees(rows, { threadId: 'th1' });
  assert.equal(tree!.run.id, 'root');
  assert.equal(tree!.legs.length, 1);
  assert.equal(tree!.legs[0]!.legs[0]!.run.id, 'grand', 'depth is unbounded (docs/harness/04)');
});

test('isWatchableRun: a bare wake is the ghost’s twin and stays silent; one with legs speaks', () => {
  const bare = runTrees([row({ id: 'w', kind: 'wake', thread_id: 'th1' })], { threadId: 'th1' })[0]!;
  assert.equal(isWatchableRun(bare), false);
  const fanned = runTrees([row({ id: 'w', kind: 'wake', thread_id: 'th1' }), row({ id: 'l', parent_run_id: 'w', thread_id: 'th1' })], { threadId: 'th1' })[0]!;
  assert.equal(isWatchableRun(fanned), true);
  const work = runTrees([row({ id: 'k', kind: 'work', thread_id: 'th1' })], { threadId: 'th1' })[0]!;
  assert.equal(isWatchableRun(work), true, 'non-wake runs always render');
});

test('parseSeat reads role·model[·@specialist]; a specialist is never implied', () => {
  assert.deepEqual(parseSeat('developer·claude-fable-5'), { label: 'developer · fable-5', from: null, model: 'claude-fable-5' });
  assert.deepEqual(parseSeat('developer·claude-fable-5·@patch'), { label: 'patch · fable-5', from: 'patch', model: 'claude-fable-5' });
  assert.equal(parseSeat(null), null);
  assert.equal(parseSeat('developer'), null, 'a seat without a model is not a seat');
});

test('shortModel keeps the family, drops vendor and date', () => {
  assert.equal(shortModel('claude-fable-5'), 'fable-5');
  assert.equal(shortModel('claude-haiku-4-5-20251001'), 'haiku-4-5');
  assert.equal(shortModel('openai/gpt-5-codex-latest'), 'gpt-5-codex');
  assert.equal(shortModel('custom-model'), 'custom-model', 'an unknown shape passes through untouched');
});

test('rollupChips counts the subtree and REPORTS the holes', () => {
  const t = (rows: RunUI[]) => runTrees(rows, { threadId: 'th1' })[0]!;
  const base = [row({ id: 'root', thread_id: 'th1' })];
  assert.deepEqual(rollupChips(t(base)), [], 'no legs, no chips');
  assert.deepEqual(rollupChips(t([...base, row({ id: 'l1', parent_run_id: 'root', thread_id: 'th1' })])), ['1 subagent']);
  const many = [...base,
    row({ id: 'l1', parent_run_id: 'root', thread_id: 'th1', state: 'failed' }),
    row({ id: 'l2', parent_run_id: 'root', thread_id: 'th1', state: 'parked' }),
    row({ id: 'l3', parent_run_id: 'l1', thread_id: 'th1' })];
  assert.deepEqual(rollupChips(t(many)), ['3 subagents', 'depth 2', '1 failed', '1 waiting']);
});
