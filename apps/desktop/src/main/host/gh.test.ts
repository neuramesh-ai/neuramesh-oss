// host/gh.ts pure helpers (track B1). These parse strings the whole PR flow depends on —
// a repo slug that comes back empty silently disables `gh -R`, and the Deploy-notes section
// is what the shipper reads to build a release plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoSlug, deployNotesSection, ciVerdictOf } from './gh';

test('repoSlug reads https, ssh and .git-suffixed clone URLs', () => {
  assert.equal(repoSlug('https://github.com/alonge-dev/neuramesh.git'), 'alonge-dev/neuramesh');
  assert.equal(repoSlug('https://github.com/alonge-dev/neuramesh'), 'alonge-dev/neuramesh');
  assert.equal(repoSlug('git@github.com:alonge-dev/neuramesh.git'), 'alonge-dev/neuramesh');
  assert.equal(repoSlug('https://github.com/org/repo.name.git'), 'org/repo.name', 'dots inside a repo name survive');
});

test('a non-GitHub remote yields an empty slug, not a wrong one', () => {
  assert.equal(repoSlug('https://gitlab.com/org/repo.git'), '');
  assert.equal(repoSlug('/home/me/local/repo'), '');
  assert.equal(repoSlug(''), '');
});

test('deployNotesSection takes the section and stops at the next heading', () => {
  const body = [
    '## What & why', 'a change', '',
    '## Deploy notes', '- PowerSync: none', '- Migration: auto-applies', '',
    '## Evidence', 'tests green',
  ].join('\n');
  assert.equal(deployNotesSection(body), '- PowerSync: none\n- Migration: auto-applies');
});

test('deploy notes: last section, case-insensitive heading, and absent → empty', () => {
  assert.equal(deployNotesSection('## Deploy Notes\nnone'), 'none', 'the heading is matched case-insensitively');
  assert.equal(deployNotesSection('## What\nno notes here'), '', 'a PR without the section reads as empty, never as the body');
  assert.equal(deployNotesSection(''), '');
});

test('ciVerdictOf: a read that FAILED is unknown, never "no CI"', () => {
  // the gate used to read every failed read as none and pass unverified work: no login, a token
  // without Checks read, or Debian's gh 2.23 (no `gh pr checks --json`) all looked like "no CI"
  const failed = (stderr: string) => ({ ok: false, stdout: '', stderr });
  assert.equal(ciVerdictOf(failed('unknown flag: --json')).verdict, 'unknown');
  assert.equal(ciVerdictOf(failed('To get started with GitHub CLI, please run:  gh auth login')).verdict, 'unknown');
  assert.equal(ciVerdictOf(failed('GraphQL: Resource not accessible by integration')).detail, 'GraphQL: Resource not accessible by integration');
  // a repository with no CI at all is still none
  assert.equal(ciVerdictOf(failed("no checks reported on the 'nm/7-x' branch")).verdict, 'none');
  assert.equal(ciVerdictOf({ ok: true, stdout: '[]', stderr: '' }).verdict, 'none');
});

test('ciVerdictOf: the buckets decide fail, pending and pass', () => {
  const run = (checks: unknown[]) => ciVerdictOf({ ok: true, stdout: JSON.stringify(checks), stderr: '' });
  assert.deepEqual(run([{ name: 'build', bucket: 'pass' }, { name: 'lint', bucket: 'fail' }]), { verdict: 'fail', detail: 'lint' });
  assert.deepEqual(run([{ name: 'build', bucket: 'pending' }]), { verdict: 'pending', detail: 'build' });
  assert.deepEqual(run([{ name: 'build', bucket: 'pass' }, { name: 'lint', bucket: 'pass' }]), { verdict: 'pass', detail: '2 checks green' });
  // gh exits non-zero with valid JSON when a check fails: the JSON still decides
  assert.equal(ciVerdictOf({ ok: false, stdout: JSON.stringify([{ name: 'e2e', bucket: 'cancel' }]), stderr: '' }).verdict, 'fail');
});
