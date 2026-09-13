// Evidence-image pipeline (evidence.ts): the sweep, the budget, and the loud drop —
// unit-tested against real temp dirs so the #1015 review-loop class stays closed.
// Run from apps/desktop: pnpm exec tsx --test src/main/evidence.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sweepEvidenceImages, planEvidenceBudget, evidenceDropNote, EVIDENCE_IMAGE_BUDGET } from './evidence';

async function evidenceDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nm-evidence-test-'));
}

const touch = async (dir: string, rel: string, mtimeSec: number): Promise<void> => {
  const full = join(dir, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, 'png-bytes');
  await utimes(full, mtimeSec, mtimeSec);
};

test('sweep finds images recursively — the .nm-evidence/captures/ blindspot', async () => {
  const dir = await evidenceDir();
  try {
    await touch(dir, 'flat.png', 1000);
    await touch(dir, 'captures/pill-ready-dark.png', 1000);
    await touch(dir, 'captures/deep/nested.webp', 1000);
    await touch(dir, 'notes.md', 1000); // non-image → ignored
    const rels = await sweepEvidenceImages(dir);
    assert.deepEqual(new Set(rels), new Set(['flat.png', 'captures/pill-ready-dark.png', 'captures/deep/nested.webp']));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('design/ and node_modules are never swept; missing dir is empty', async () => {
  const dir = await evidenceDir();
  try {
    await touch(dir, 'design/approved-mockup.png', 1000); // staged human-approved design — already a task artifact
    await touch(dir, 'node_modules/pkg/logo.png', 1000);
    await touch(dir, 'shots/real.png', 1000);
    assert.deepEqual(await sweepEvidenceImages(dir), ['shots/real.png']);
    assert.deepEqual(await sweepEvidenceImages(join(dir, 'does-not-exist')), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ordering is newest-first so rework captures outrank stale rounds; name breaks ties', async () => {
  const dir = await evidenceDir();
  try {
    await touch(dir, 'round1-old.png', 1000);
    await touch(dir, 'b-fresh.png', 2000);
    await touch(dir, 'a-fresh.png', 2000);
    assert.deepEqual(await sweepEvidenceImages(dir), ['a-fresh.png', 'b-fresh.png', 'round1-old.png']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('budget split: order preserved, remainder named, zero/negative budgets take nothing', () => {
  const { take, dropped } = planEvidenceBudget(['a', 'b', 'c', 'd'], 3);
  assert.deepEqual(take, ['a', 'b', 'c']);
  assert.deepEqual(dropped, ['d']);
  assert.deepEqual(planEvidenceBudget(['a'], 5), { take: ['a'], dropped: [] });
  assert.deepEqual(planEvidenceBudget(['a', 'b'], 0), { take: [], dropped: ['a', 'b'] });
  assert.deepEqual(planEvidenceBudget(['a'], -2).take, []);
});

test('drop note is silent when everything attached, loud and specific when not', () => {
  assert.equal(evidenceDropNote([], 16), '');
  const note = evidenceDropNote(['pill-downloading-dark.png', 'pill-ready-light.png'], 8);
  assert.match(note, /2 images did NOT attach \(8-image budget/);
  assert.match(note, /pill-downloading-dark\.png, pill-ready-light\.png/);
  const many = evidenceDropNote(Array.from({ length: 15 }, (_, i) => `s${i}.png`), 16);
  assert.match(many, /\(\+3 more\)/);
});

test('#1015 replay: 12 legitimate captures — the OLD cap of 8 drops exactly the four the reviewer kept demanding; the new budget drops none', () => {
  const captures = [
    'card-available-dark.png', 'card-available-light.png',
    'card-downloading-dark.png', 'card-downloading-light.png',
    'card-ready-dark.png', 'card-ready-light.png',
    'pill-available-dark.png', 'pill-available-light.png',
    'pill-downloading-dark.png', 'pill-downloading-light.png',
    'pill-ready-dark.png', 'pill-ready-light.png',
  ]; // equal mtimes → the sweep's name tie-break yields exactly this order
  const old = planEvidenceBudget(captures, 8);
  assert.deepEqual(old.dropped, [
    'pill-downloading-dark.png', 'pill-downloading-light.png',
    'pill-ready-dark.png', 'pill-ready-light.png',
  ]);
  const now = planEvidenceBudget(captures, EVIDENCE_IMAGE_BUDGET);
  assert.deepEqual(now.dropped, []);
});
