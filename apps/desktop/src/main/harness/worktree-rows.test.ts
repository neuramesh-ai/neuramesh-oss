// The Worktrees row policy. Run: pnpm exec tsx --test src/main/harness/worktree-rows.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BerthEntry } from './berths';
import {
  classifyThreadWorktree, engineeringBranchName, engineeringWorktreeName, removalVerdict, safeSegment,
  settledBerths, threadForWorktreeName,
} from './worktree-rows';

const berth = (n: number, state: string | null, bytes = 1e9): BerthEntry =>
  ({ taskNumber: n, boardState: state, mtimeMs: 1, bytes, repoId: 'r1', branch: `nm/${n}-x` });

test('a coding thread row reads the runtime: working, waits for you, idle, and no thread when the thread is gone', () => {
  assert.equal(classifyThreadWorktree({ state: 'streaming' }, true), 'working');
  assert.equal(classifyThreadWorktree({ state: 'awaiting_approval' }, true), 'waits');
  for (const s of ['idle', 'completed', 'resumable', 'error', null]) assert.equal(classifyThreadWorktree({ state: s }, true), 'idle', String(s));
  assert.equal(classifyThreadWorktree(null, true), 'idle');
  // a directory whose thread left the replica is an orphan whatever its last session said
  assert.equal(classifyThreadWorktree({ state: 'streaming' }, false), 'orphan');
});

test('the engineering names: one spelling for the directory and the branch', () => {
  assert.equal(safeSegment('a b/c'), 'a-b-c');
  assert.equal(safeSegment('x'.repeat(100)).length, 80);
  assert.equal(engineeringWorktreeName('u-1', 'repo/one', 'th-9'), 'engineering-u-1-repo-one-th-9');
  assert.equal(engineeringBranchName('u 1', 'th-9'), 'nm/engineering/u-1/th-9');
});

test('a worktree name resolves to the thread it ends with, and to nothing else', () => {
  const ids = ['th-9', 'th-10', 'bae30b5b-c5f6-49e8-a051-26ddba54f348'];
  assert.equal(threadForWorktreeName('engineering-u-1-repo-one-th-9', ids), 'th-9');
  assert.equal(threadForWorktreeName('engineering-u-1-repo-one-th-10', ids), 'th-10');
  assert.equal(threadForWorktreeName('engineering-0000-acc5-bae30b5b-c5f6-49e8-a051-26ddba54f348', ids), 'bae30b5b-c5f6-49e8-a051-26ddba54f348');
  // a thread id that is a suffix of another never wins over the longer, exact one
  assert.equal(threadForWorktreeName('engineering-u-1-r-a-th-10', ['th-10', '10']), 'th-10');
  assert.equal(threadForWorktreeName('engineering-u-1-repo-one-th-77', ids), null);
  assert.equal(threadForWorktreeName('nm-1046', ids), null);
});

test('the settled set is the sweeper\'s remove verdict: settled and no-task berths, never an eviction', () => {
  const berths = [berth(1, 'in_progress'), berth(2, 'in_review', 3e9), berth(3, 'accepted', 2e9), berth(4, null, 0.5e9), berth(5, 'closed', 1e9)];
  const s = settledBerths(berths);
  assert.deepEqual(s.taskNumbers.sort(), [3, 4, 5]);
  assert.equal(s.bytes, 3.5e9);
  // many warm berths trip the warm cap in decideSweep, and those evictions stay out of this set
  const warm = [1, 2, 3, 4, 5, 6, 7].map((n) => berth(n, 'done', 9e9));
  assert.deepEqual(settledBerths(warm), { taskNumbers: [], bytes: 0 });
});

test('a held worktree is refused unless the person forced it', () => {
  assert.deepEqual(removalVerdict({ held: false, force: false }), { ok: true });
  assert.deepEqual(removalVerdict({ held: true, force: false }), { ok: false, code: 'WORKTREE_BUSY' });
  assert.deepEqual(removalVerdict({ held: true, force: true }), { ok: true });
});
