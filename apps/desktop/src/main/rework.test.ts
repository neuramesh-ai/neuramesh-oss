// Rework continuity (rework.ts): a review bounce on a repo-less task must start
// FROM the prior submission's deliverables — retained on this machine, rehydrated
// from the synced artifacts on any other — never from a wiped workspace (the #1010
// PDF-rework failure). Run from apps/desktop: pnpm exec tsx --test src/main/rework.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareScratchWorkspace, type ReworkDbLike } from './rework';

const fakeDb = (rows: Array<{ name: string; inline_content: string | null }>): ReworkDbLike => ({
  getAll: async <T,>() => rows as T[],
});

const tmp = () => mkdtemp(join(tmpdir(), 'nm-rework-'));

test('first attempt (no prior file artifacts) wipes the workspace fresh', async () => {
  const dir = join(await tmp(), 'ws');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'stale-junk.txt'), 'left over from a wall');
  const note = await prepareScratchWorkspace(fakeDb([]), 't1', dir);
  assert.equal(note, '');
  assert.deepEqual(await readdir(dir), []); // junk gone, dir exists
  await rm(join(dir, '..'), { recursive: true, force: true });
});

test('a rework rehydrates the prior deliverables (incl. subdirectories) and says so', async () => {
  const dir = join(await tmp(), 'ws'); // does not exist yet — the cross-machine case
  const note = await prepareScratchWorkspace(
    fakeDb([
      { name: 'report.md', inline_content: '# Flowe competitors\n…' },
      { name: 'data/socials.csv', inline_content: 'competitor,followers\n' },
    ]),
    't1',
    dir,
  );
  assert.equal(await readFile(join(dir, 'report.md'), 'utf8'), '# Flowe competitors\n…');
  assert.equal(await readFile(join(dir, 'data', 'socials.csv'), 'utf8'), 'competitor,followers\n');
  assert.match(note, /REWORK/);
  assert.match(note, /report\.md/);
  assert.match(note, /data\/socials\.csv/);
  assert.match(note, /Do NOT redo the work from scratch/);
  await rm(join(dir, '..'), { recursive: true, force: true });
});

test('the retained workspace wins — an existing file is never overwritten by the artifact', async () => {
  const dir = join(await tmp(), 'ws');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'report.md'), 'NEWER on-disk state from the last run');
  const note = await prepareScratchWorkspace(fakeDb([{ name: 'report.md', inline_content: 'older submitted copy' }]), 't1', dir);
  assert.equal(await readFile(join(dir, 'report.md'), 'utf8'), 'NEWER on-disk state from the last run');
  assert.match(note, /report\.md/); // still listed — it IS the prior deliverable
  await rm(join(dir, '..'), { recursive: true, force: true });
});

test('newest submission wins per name (rows arrive created_at desc)', async () => {
  const dir = join(await tmp(), 'ws');
  const note = await prepareScratchWorkspace(
    fakeDb([
      { name: 'report.md', inline_content: 'v2 — after the first bounce' }, // newest first
      { name: 'report.md', inline_content: 'v1 — original' },
    ]),
    't1',
    dir,
  );
  assert.equal(await readFile(join(dir, 'report.md'), 'utf8'), 'v2 — after the first bounce');
  assert.equal(note.match(/report\.md/g)?.length, 1); // listed once
  await rm(join(dir, '..'), { recursive: true, force: true });
});

test('artifact names never escape the workspace (synced data is not trusted)', async () => {
  const base = await tmp();
  const dir = join(base, 'ws');
  const note = await prepareScratchWorkspace(
    fakeDb([
      { name: '../evil.txt', inline_content: 'escape attempt' },
      { name: 'ok.md', inline_content: 'fine' },
    ]),
    't1',
    dir,
  );
  assert.equal(await stat(join(base, 'evil.txt')).then(() => true, () => false), false, 'must not write outside the workspace');
  assert.equal(await readFile(join(dir, 'ok.md'), 'utf8'), 'fine');
  assert.ok(!note.includes('evil'), 'the escaped name is not presented as a deliverable');
  await rm(base, { recursive: true, force: true });
});

test('null-content artifacts are skipped; all-null behaves like a fresh attempt', async () => {
  const dir = join(await tmp(), 'ws');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'stale.txt'), 'x');
  const note = await prepareScratchWorkspace(fakeDb([{ name: 'report.md', inline_content: null }]), 't1', dir);
  assert.equal(note, '');
  assert.deepEqual(await readdir(dir), []); // treated as no prior files → fresh
  await rm(join(dir, '..'), { recursive: true, force: true });
});
