// host/gh.ts pure helpers (track B1). These parse strings the whole PR flow depends on —
// a repo slug that comes back empty silently disables `gh -R`, and the Deploy-notes section
// is what the shipper reads to build a release plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoSlug, deployNotesSection } from './gh';

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
