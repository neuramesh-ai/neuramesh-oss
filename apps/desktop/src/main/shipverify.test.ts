// Post-merge release verification (shipverify.ts): the pure verdict half the
// verifying watch runs after the squash-merge. Run from apps/desktop:
// pnpm exec tsx --test src/main/shipverify.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRunSignals, commitStatusSignals, workflowRunSignals, classifyRelease } from './shipverify';

test('check-run JSON normalizes: completed/success green, in_progress pending, failure red', () => {
  const s = checkRunSignals({
    check_runs: [
      { name: 'test', status: 'completed', conclusion: 'success' },
      { name: 'build', status: 'in_progress', conclusion: null },
      { name: 'lint', status: 'completed', conclusion: 'failure' },
      { name: 'docs', status: 'completed', conclusion: 'skipped' },
    ],
  });
  assert.deepEqual(s.map((x) => x.state), ['success', 'pending', 'failure', 'success']);
});

test('commit statuses keep only the LATEST state per context (GitHub returns full history, newest first)', () => {
  const s = commitStatusSignals({
    statuses: [
      { context: 'vercel', state: 'success' },
      { context: 'vercel', state: 'pending' }, // the older event — must not shadow
    ],
  });
  assert.equal(s.length, 1);
  assert.equal(s[0]!.state, 'success');
});

test('workflow runs settle like check runs; queued counts as pending', () => {
  const s = workflowRunSignals([
    { name: 'desktop-release', status: 'queued', conclusion: null },
    { name: 'ci', status: 'completed', conclusion: 'success' },
  ]);
  assert.deepEqual(s.map((x) => x.state), ['pending', 'success']);
});

test('malformed / absent payloads never throw — they contribute zero signals', () => {
  assert.deepEqual(checkRunSignals(null), []);
  assert.deepEqual(checkRunSignals({ message: 'Not Found' }), []);
  assert.deepEqual(commitStatusSignals(undefined), []);
  assert.deepEqual(workflowRunSignals('garbage'), []);
});

test('classify: all green is green, with a countable detail line', () => {
  const v = classifyRelease([
    { source: 'check', name: 'ci', state: 'success' },
    { source: 'run', name: 'desktop-release', state: 'success' },
  ]);
  assert.equal(v.verdict, 'green');
  assert.match(v.detail, /2 post-merge signals green/);
});

test('classify: ONE failure makes the whole release red, named in the detail', () => {
  const v = classifyRelease([
    { source: 'check', name: 'ci', state: 'success' },
    { source: 'run', name: 'desktop-release', state: 'failure' },
  ]);
  assert.equal(v.verdict, 'red');
  assert.match(v.detail, /desktop-release/);
});

test('classify: anything still running holds the verdict at pending', () => {
  const v = classifyRelease([
    { source: 'check', name: 'ci', state: 'success' },
    { source: 'status', name: 'vercel', state: 'pending' },
  ]);
  assert.equal(v.verdict, 'pending');
});

test('classify: a signal-less merge is none — no-CI repos proceed on review alone', () => {
  assert.equal(classifyRelease([]).verdict, 'none');
});

test('classify: a workflow echoing as a check run dedupes by name — failure outranks its echo', () => {
  const v = classifyRelease([
    { source: 'check', name: 'desktop-release', state: 'success' }, // the stale echo
    { source: 'run', name: 'desktop-release', state: 'failure' },
  ]);
  assert.equal(v.verdict, 'red');
});
