import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Md } from '../md/Md';
import { codingArtifactReference, latestCodingArtifacts } from './coding-artifacts';

const artifacts = [{ id: 'svg', name: 'welcome.svg', created_at: '2026-10-11T10:00:00Z' }, { id: 'doc', name: 'Project notes.md', created_at: '2026-10-11T10:01:00Z' }];
// the recorder keys an artifact on its bytes, so an edited file arrives as a second row with the same name
const revised = [...artifacts, { id: 'svg-2', name: 'welcome.svg', created_at: '2026-10-11T11:00:00Z' }];

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
