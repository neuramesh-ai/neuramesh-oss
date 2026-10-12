import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canContinueEngineering, createEngineeringSession, engineeringModeHandoff, engineeringUnifiedDiff } from '@neuramesh/shared';
import { reviewFiles, reviewLines, reviewSource } from './change-review';
import { codeReviewArrival } from './useCodeReview';

const base = () => createEngineeringSession({ id: 'repo', name: 'repo', owner: 'test', branch: 'main', root: null });
test('handoffs require a completed turn and a typed action, never streaming, errored, or legacy guesses', () => {
  const session = { ...base(), pendingModeHandoff: engineeringModeHandoff('edit', 'apply_patch') };
  assert.equal(canContinueEngineering({ ...session, state: 'completed' }), true);
  for (const state of ['idle', 'streaming', 'awaiting_approval', 'error', 'resumable']) assert.equal(canContinueEngineering({ ...session, state }), false);
  assert.equal(canContinueEngineering({ ...session, state: 'completed', activeActivity: { phase: 'thinking' } }), false);
  const { actionable: _, ...legacy } = session.pendingModeHandoff;
  assert.equal(canContinueEngineering({ ...session, state: 'completed', pendingModeHandoff: legacy }), false);
});

test('approval arrivals open once, handle fast and restored proposals, and wait for actual files', () => {
  const seen = new Set<string>();
  const session = { ...base(), pendingApproval: { id: 'a1', title: '', detail: '', category: 'edit' as const, continuation: 'apply' as const, changes: [] as ReturnType<typeof base>['changes'] } };
  assert.equal(codeReviewArrival(seen, session), null);
  session.pendingApproval.changes = [{ path: 'a.ts', kind: 'added', before: '', after: 'a', diff: '' }];
  assert.equal(codeReviewArrival(seen, session), 'a.ts');
  assert.equal(codeReviewArrival(seen, session), null);
  session.pendingApproval.id = 'a2';
  assert.equal(codeReviewArrival(seen, session), 'a.ts');
  assert.equal(codeReviewArrival(new Set(), session), 'a.ts');
});

test('unified diff counters keep removals and additions separate across hunks', () => {
  const lines = reviewLines('--- a/x\n+++ b/x\n@@ -8,2 +8,3 @@\n same\n-old\n+new\n+extra\n@@ -30 +31 @@\n-last\n+end\n');
  assert.deepEqual(lines.filter((line) => line.kind === 'removed').map((line) => [line.oldLine, line.newLine]), [[9, null], [30, null]]);
  assert.deepEqual(lines.filter((line) => line.kind === 'added').map((line) => [line.oldLine, line.newLine]), [[null, 9], [null, 10], [null, 31]]);
});

test('legacy multipatches show unique files and never appear as file content', () => {
  const patch = '*** Begin Patch\n*** Delete File: x.ts\n*** Add File: x.ts\n+new\n*** Add File: y.ts\n+other\n*** End Patch';
  const files = reviewFiles(['x.ts', 'x.ts', 'y.ts'].map((path) => ({ path, kind: 'added', before: '', after: patch, diff: patch })));
  assert.deepEqual(files.map((file) => file.change.path), ['x.ts', 'y.ts']);
  assert.equal(files[0]?.kind, 'modified');
  assert.ok(reviewSource(files[0]!).notice);
  assert.equal(reviewSource(files[1]!).text, 'other\n');
  assert.equal(files[1]?.additions, 1);
  assert.doesNotMatch(files[0]!.change.diff, /other|Begin Patch/);
});

test('exact snapshots count only changed lines and keep deleted, renamed and binary states', () => {
  const before = 'keep\nold\nkeep\n', after = 'keep\nnew\nkeep\n';
  const change = { path: 'new.ts', previousPath: 'old.ts', kind: 'modified' as const, before, after };
  const file = reviewFiles([{ ...change, diff: engineeringUnifiedDiff(change) }])[0]!;
  assert.equal(file.kind, 'renamed');
  assert.equal(file.additions, 1); assert.equal(file.deletions, 1);
  assert.equal(reviewSource(file).text, after);
  const deleted = reviewFiles([{ path: 'x', kind: 'deleted', before, after: '', diff: '' }])[0]!;
  assert.equal(reviewSource(deleted).text, before);
  const binary = reviewFiles([{ path: 'x.png', kind: 'added', before: '', after: '\0', diff: '' }])[0]!;
  assert.ok(reviewSource(binary).notice);
});
