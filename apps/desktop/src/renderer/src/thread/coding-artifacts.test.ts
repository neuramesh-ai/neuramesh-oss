import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Md } from '../md/Md';
import { codingArtifactReference, latestCodingArtifacts, codingArtifactTurns } from './coding-artifacts';

const artifacts = [{ id: 'svg', name: 'welcome.svg', created_at: '2026-10-11T10:00:00Z' }, { id: 'doc', name: 'Project notes.md', created_at: '2026-10-11T10:01:00Z' }];
// the recorder keys an artifact on its bytes, so an edited file arrives as a second row with the same name
const revised = [...artifacts, { id: 'svg-2', name: 'welcome.svg', created_at: '2026-10-11T11:00:00Z' }];

test('deliveries stay with their producing turn when later messages arrive or history reloads', () => {
  const first = [{ id: 'ask', role: 'user', createdAt: '2026-10-11T09:00:00Z' }, { id: 'reply', role: 'assistant', createdAt: '2026-10-11T10:02:00Z' }];
  const later = [...first, { id: 'followup', role: 'user', createdAt: '2026-10-11T10:30:00Z' }, { id: 'answer', role: 'assistant', createdAt: '2026-10-11T10:31:00Z' }];
  assert.deepEqual(codingArtifactTurns(artifacts, first).get('ask'), artifacts);
  const grouped = codingArtifactTurns<(typeof revised)[number]>(JSON.parse(JSON.stringify(revised)), later);
  assert.deepEqual(grouped.get('ask')?.map(a => a.id), ['svg', 'doc']);
  assert.deepEqual(grouped.get('followup')?.map(a => a.id), ['svg-2']);
  assert.deepEqual(codingArtifactTurns(artifacts, later).get('ask'), artifacts);
});

test('linked deliveries survive delayed publishing and unplaced files never trail new messages', () => {
  const messages = [{ id: 'ask', role: 'user', createdAt: '2026-10-11T09:00:00Z' }, { id: 'reply', role: 'assistant', createdAt: '2026-10-11T10:02:00Z' }, { id: 'next', role: 'user', createdAt: '2026-10-11T10:30:00Z' }];
  const linked = { id: 'linked', name: 'clip.mp4', message_id: 'reply', created_at: '2026-10-11T11:00:00Z' };
  const legacy = { id: 'legacy', name: 'old.png', created_at: 'invalid' };
  const groups = codingArtifactTurns([linked, legacy], messages);
  assert.deepEqual(groups.get('ask'), [linked]);
  assert.deepEqual(groups.get(null), [legacy]);
  assert.equal(groups.has('next'), false);
});

test('recorded artifact links resolve by thread membership, including the runtime artifact directory', () => {
  for (const name of ['welcome.svg', '.nm-artifacts/welcome.svg', './.nm-artifacts/welcome.svg']) assert.equal(codingArtifactReference(artifacts, name)?.id, 'svg');
  assert.equal(codingArtifactReference(artifacts, 'Project%20notes.md')?.id, 'doc');
  for (const ref of ['https://example.com/welcome.svg', '//example.com/welcome.svg', '/welcome.svg', '../welcome.svg', '.nm-artifacts/../welcome.svg', 'src/welcome.svg', 'file:welcome.svg', '%bad', '.nm-artifacts/%2e%2e/welcome.svg', 'src\\welcome.svg']) assert.equal(codingArtifactReference(artifacts, ref), null, ref);
});

test('a link to an edited file opens its newest version, in any row order', () => {
  assert.equal(codingArtifactReference(revised, '.nm-artifacts/welcome.svg')?.id, 'svg-2');
  assert.equal(codingArtifactReference([...revised].reverse(), 'welcome.svg')?.id, 'svg-2');
});

test('the artifact card lists each file once, at its newest version', () => {
  assert.deepEqual(latestCodingArtifacts(revised).map(a => a.id), ['doc', 'svg-2']);
  assert.deepEqual(latestCodingArtifacts(artifacts).map(a => a.id), ['svg', 'doc']);
});

test('Markdown artifact links become internal preview buttons while other URLs remain links', () => {
  const html = renderToStaticMarkup(createElement(Md, {
    text: '[Welcome](.nm-artifacts/welcome.svg) and [Website](https://example.com/welcome.svg)',
    fileRef: ref => !!codingArtifactReference(artifacts, ref), onOpenFile: () => {},
  }));
  assert.match(html, /<button[^>]*class="fileref"[^>]*>Welcome/);
  assert.match(html, /<a href="https:\/\/example.com\/welcome.svg">Website<\/a>/);
  assert.doesNotMatch(html, /href="\.nm-artifacts/);
});

test('short deliverable names resolve only when their folder suffix is unambiguous', () => {
  const rows = [{ name: 'launch/clip.mp4' }, { name: 'launch/storyboard.md' }, { name: 'other/storyboard.md' }];
  assert.equal(codingArtifactReference(rows, 'clip.mp4')?.name, 'launch/clip.mp4');
  assert.equal(codingArtifactReference(rows, 'storyboard.md'), null);
  assert.equal(codingArtifactReference(rows, 'launch/storyboard.md')?.name, 'launch/storyboard.md');
  assert.equal(codingArtifactReference(rows, 'launch/'), null);
});

test('inline code filenames open artifacts without turning code blocks or link labels into nested buttons', () => {
  const html = renderToStaticMarkup(createElement(Md, {
    text: '`welcome.svg`\n\n```\nwelcome.svg\n```\n\n~~~txt\nwelcome.svg\n~~~\n\n[`welcome.svg`](.nm-artifacts/welcome.svg)\n\n[`welcome.svg`](https://example.com)\n\n`missing.mp4`',
    fileRef: ref => !!codingArtifactReference(artifacts, ref), onOpenFile: () => {},
  }));
  assert.equal((html.match(/class="fileref"/g) ?? []).length, 2);
  assert.match(html, /<pre><code>welcome.svg\n<\/code><\/pre>/);
  assert.match(html, /<a href="https:\/\/example.com"><code>welcome.svg<\/code><\/a>/);
  assert.match(html, /<code>missing.mp4<\/code>/);
});
