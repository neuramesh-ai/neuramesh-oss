// Design rework continuity (docs/14): round N+1 EDITS round N instead of redrawing
// from a paragraph of feedback. Staging the previous round on disk defeats the
// "no mockups produced" guard, so a no-op rework needs its own detector.
// Run from apps/desktop:
//   pnpm exec tsx --test src/main/designrework.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stagePriorDesignRound, designRoundChanged } from './agents';

const db = (rows: Array<{ name: string; inline_content: string | null }>) => ({
  getAll: async () => rows as never[],
}) as unknown as Parameters<typeof stagePriorDesignRound>[0];

test('stages the latest round under version-stripped names', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nm-design-'));
  const res = await stagePriorDesignRound(db([
    { name: 'design-mockup-v1-01-character-logo.html', inline_content: '<h1>v1 a</h1>' },
    { name: 'design-mockup-v1-02-in-product.html', inline_content: '<h1>v1 b</h1>' },
    { name: 'design-mockup-v2-01-character-logo.html', inline_content: '<h1>v2 a</h1>' },
    { name: 'design-mockup-v2-02-in-product.html', inline_content: '<h1>v2 b</h1>' },
  ]), 't1', dir);

  assert.equal(res.round, 2);
  assert.deepEqual(res.names.sort(), ['01-character-logo.html', '02-in-product.html']);
  // the version prefix must be stripped, or the next round double-prefixes to
  // design-mockup-v3-design-mockup-v2-…
  const onDisk = (await readdir(join(dir, '.nm-evidence', 'design'))).sort();
  assert.deepEqual(onDisk, ['01-character-logo.html', '02-in-product.html']);
  assert.equal(await readFile(join(dir, '.nm-evidence', 'design', '01-character-logo.html'), 'utf8'), '<h1>v2 a</h1>');
});

test('round 1 stages nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nm-design-'));
  const res = await stagePriorDesignRound(db([]), 't1', dir);
  assert.deepEqual(res.names, []);
  assert.equal(res.round, 0);
  assert.equal(res.staged.size, 0);
});

test('a no-op rework is detected — it must not re-propose the previous round as new', () => {
  const staged = new Map([['a.html', '<h1>a</h1>'], ['b.html', '<h1>b</h1>']]);

  // untouched → not a real round
  assert.equal(designRoundChanged(staged, [
    { name: 'a.html', html: '<h1>a</h1>' },
    { name: 'b.html', html: '<h1>b</h1>' },
  ]), false);

  // edited → real
  assert.equal(designRoundChanged(staged, [
    { name: 'a.html', html: '<h1>a — warmer eyes</h1>' },
    { name: 'b.html', html: '<h1>b</h1>' },
  ]), true);

  // a direction added, or dropped → real
  assert.equal(designRoundChanged(staged, [
    { name: 'a.html', html: '<h1>a</h1>' },
    { name: 'b.html', html: '<h1>b</h1>' },
    { name: 'c.html', html: '<h1>c</h1>' },
  ]), true);
  assert.equal(designRoundChanged(staged, [{ name: 'a.html', html: '<h1>a</h1>' }]), true);

  // round 1 has no baseline — always real
  assert.equal(designRoundChanged(new Map(), [{ name: 'a.html', html: '<h1>a</h1>' }]), true);
});

// This file imports ./agents, so agents.ts must stay importable under plain node. It was not:
// a top-level `import … from 'electron'` throws wherever the binary is absent, and CI sets
// ELECTRON_SKIP_BINARY_DOWNLOAD=1. The suite passed only while the pnpm store cache happened to
// carry an electron dist, and died on the first PR that changed the lockfile — a green that was
// really a cache artifact. Electron is loaded on use now; keep it that way.
test('agents.ts does not pull electron at import time', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  // agents.ts AND everything it pulls: attachments.ts was the second offender, found only after
  // the first fix went red on CI again with the same message.
  for (const f of ['agents.ts', 'attachments.ts', 'electronlazy.ts']) {
    const src = readFileSync(join(import.meta.dirname, f), 'utf8');
    assert.ok(!/^import .* from 'electron';/m.test(src),
      `${f} imports electron at module scope — every test that imports agents.ts now needs an electron binary`);
  }
});
