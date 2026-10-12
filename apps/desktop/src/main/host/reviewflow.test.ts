// scout's approval line (the homepage round, 2026-10-05): it asks in the task's own thread for the word
// that lands the work (merge for a pull request, accept for the rest), because the server takes an agent's
// accept only after a person's message there. It says CI ok only when the CI gate saw a pass, and it keeps
// the two words the smoke gate's SQL matches.
// Run: pnpm exec tsx --test src/main/host/reviewflow.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalLine } from './reviewflow';

// devsmoke/smoke-sync.ts selects the approval with `body like '%Auto-review of%Approved%'`
const SMOKE = /Auto-review of.*Approved/s;
const PR = { number: 1064, dod: true, prNumber: 212, prUrl: 'https://github.com/acme/site/pull/212', pushedSha: 'abc1234def' };

test('a unit with a pull request asks for merge, and names the PR and its CI pass', () => {
  assert.equal(approvalLine({ ...PR, ci: 'pass' }), 'Auto-review of #1064: the deliverables match the Definition of Done ([PR #212](https://github.com/acme/site/pull/212), CI ok). Approved. Say merge in this thread to land the PR.');
});

test('CI ok is only for a pass: no CI says so, and a gate that is off or did not run says nothing', () => {
  assert.equal(approvalLine({ ...PR, ci: 'none' }), 'Auto-review of #1064: the deliverables match the Definition of Done ([PR #212](https://github.com/acme/site/pull/212), no CI). Approved. Say merge in this thread to land the PR.');
  const quiet = 'Auto-review of #1064: the deliverables match the Definition of Done ([PR #212](https://github.com/acme/site/pull/212)). Approved. Say merge in this thread to land the PR.';
  assert.equal(approvalLine({ ...PR, ci: 'off' }), quiet);
  assert.equal(approvalLine({ ...PR, ci: null }), quiet);
  assert.equal(approvalLine(PR), quiet);
});

test('a unit with no pull request asks for accept', () => {
  assert.equal(approvalLine({ number: 7, dod: false, prNumber: null }), 'Auto-review of #7: the deliverables match the requirements. Approved. Say accept in this thread to close it.');
  assert.equal(approvalLine({ number: 8, dod: true, prNumber: null, pushedSha: '0123456789' }), 'Auto-review of #8: the deliverables match the Definition of Done (pushed 0123456). Approved. Say accept in this thread to close it.');
});

test('every form keeps the smoke gate\'s words, with no em dash and no semicolon', () => {
  const forms = [
    ...(['pass', 'none', 'off', null] as const).map((ci) => approvalLine({ number: 1, dod: true, prNumber: 2, prUrl: 'https://github.com/a/b/pull/2', ci })),
    approvalLine({ number: 1, dod: true, prNumber: 2 }),
    approvalLine({ number: 1, dod: false, prNumber: null, pushedSha: 'abcdef0123' }),
    approvalLine({ number: 1, dod: false, prNumber: null }),
  ];
  for (const line of forms) {
    assert.match(line, SMOKE);
    assert.doesNotMatch(line, /[—;]/);
  }
});
