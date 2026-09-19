// The deliverable name contract (contractDeliverables): a sole markdown takes the playbook's name,
// and among several the one carrying the scored head or the verdict head does.
// Run: pnpm exec tsx --test src/main/host/leanunits.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractDeliverables } from './leanunits';

const today = new Date().toISOString().slice(0, 10);

test('a sole markdown takes the contract name', () => {
  const out = contractDeliverables([{ kind: 'file', name: 'BRIEF.md', content: '# Release brief · v1\nVerdict: feature · Basis: notes\n\n## What I could not determine\nnothing' }], 'release');
  assert.equal(out[0]!.name, `release-report-${today}.md`);
});

test('among several markdowns, the verdict head is the identity, like the scored head', () => {
  const files = [
    { kind: 'file', name: 'notes.md', content: '# Notes\nsome notes' },
    { kind: 'file', name: 'the-brief.md', content: '# Release brief · v1\nVerdict: feature · Basis: notes\n\n## What I could not determine\nnothing' },
    { kind: 'file', name: 'posts.json', content: '[]' },
  ];
  const out = contractDeliverables(files, 'release');
  assert.deepEqual(out.map((f) => f.name), ['notes.md', `release-report-${today}.md`, 'posts.json']);
});

test('no playbook, or an ambiguous set, leaves names alone', () => {
  const files = [{ kind: 'file', name: 'a.md', content: '# A' }, { kind: 'file', name: 'b.md', content: '# B' }];
  assert.deepEqual(contractDeliverables(files, null).map((f) => f.name), ['a.md', 'b.md']);
  assert.deepEqual(contractDeliverables(files, 'release').map((f) => f.name), ['a.md', 'b.md']);
});
