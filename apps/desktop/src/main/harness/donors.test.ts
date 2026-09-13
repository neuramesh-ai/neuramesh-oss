// Dependency donors (worktree-berths round). Run: pnpm exec tsx --test src/main/harness/donors.test.ts
//
// CoW-dependent cases branch on platform: darwin (APFS clonefile) asserts the full stash→hydrate
// path; filesystems that can't CoW (CI's ext4) must land on the honest 'no-cow' skip — that IS the
// contract (never a multi-GB deep copy), so both branches are real assertions, not soft skips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockHash, findDependencyDirs, stashDonor, hydrateFromDonor, pruneDonors, readManifest } from './donors';
import { gitChildEnv } from './workspaces';

const COW = process.platform === 'darwin';
const tmp = () => mkdtempSync(join(tmpdir(), 'nm-donor-'));
const g = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env: gitChildEnv() }).toString().trim();

/** A worktree-shaped dir: lockfile + gitignored node_modules with content. */
function makeWorktree(root: string, name: string, opts: { lock?: string; ignored?: boolean; deps?: boolean } = {}): string {
  const wt = join(root, name);
  mkdirSync(wt, { recursive: true });
  g(wt, 'init', '-b', 'main');
  writeFileSync(join(wt, 'pnpm-lock.yaml'), opts.lock ?? 'lockfileVersion: 9\n');
  if (opts.ignored !== false) writeFileSync(join(wt, '.gitignore'), 'node_modules\n');
  if (opts.deps !== false) {
    mkdirSync(join(wt, 'node_modules', 'left-pad'), { recursive: true });
    writeFileSync(join(wt, 'node_modules', 'left-pad', 'index.js'), 'module.exports = (s, n) => s.padStart(n)\n');
    mkdirSync(join(wt, 'packages', 'web', 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(wt, 'packages', 'web', 'node_modules', '.bin', 'x'), '#!/bin/sh\n');
  }
  return wt;
}

test('lockHash: stable, content-sensitive, null when no lockfile exists', () => {
  const root = tmp();
  try {
    const a = join(root, 'a'); mkdirSync(a);
    writeFileSync(join(a, 'pnpm-lock.yaml'), 'v1');
    const h1 = lockHash(a);
    assert.ok(h1 && h1.length === 16);
    assert.equal(lockHash(a), h1, 'same content, same hash');
    writeFileSync(join(a, 'pnpm-lock.yaml'), 'v2');
    assert.notEqual(lockHash(a), h1, 'content change moves the hash');
    const b = join(root, 'b'); mkdirSync(b);
    assert.equal(lockHash(b), null, 'no lockfile → null, donors stand down');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('findDependencyDirs: root + nested workspaces; never inside node_modules or dot-dirs', () => {
  const root = tmp();
  try {
    for (const p of [
      'node_modules/a', 'packages/web/node_modules/b', 'node_modules/nested/node_modules/trap',
      '.next/node_modules/trap2', 'a/b/c/d/e/node_modules/too-deep',
    ]) mkdirSync(join(root, p), { recursive: true });
    const found = findDependencyDirs(root);
    assert.deepEqual(found.sort(), ['node_modules', 'packages/web/node_modules'].sort());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test(`stash → hydrate roundtrip (${COW ? 'APFS clonefile' : 'no-CoW filesystem: honest skip'})`, async () => {
  const root = tmp();
  try {
    const donors = join(root, 'donors');
    const wt1 = makeWorktree(root, 'wt1');
    const note = await stashDonor(wt1, donors);
    if (!COW) {
      assert.deepEqual(note, { action: 'skipped', reason: 'no-cow' }, 'no CoW → skip, NEVER a deep copy');
      return;
    }
    assert.equal(note.action, 'stashed');
    assert.ok(readManifest(join(donors, lockHash(wt1)!)), 'manifest lands inside the donor');
    // a second stash of the same lockfile is a no-op — the donor already stands
    assert.deepEqual(await stashDonor(wt1, donors), { action: 'exists' });

    const wt2 = makeWorktree(root, 'wt2', { deps: false });
    const hyd = await hydrateFromDonor(wt2, donors);
    assert.equal(hyd.action, 'hydrated');
    assert.equal(
      readFileSync(join(wt2, 'node_modules', 'left-pad', 'index.js'), 'utf8'),
      readFileSync(join(wt1, 'node_modules', 'left-pad', 'index.js'), 'utf8'),
      'clone carries content byte-for-byte',
    );
    assert.ok(existsSync(join(wt2, 'packages', 'web', 'node_modules', '.bin', 'x')), 'nested workspace tree hydrates too');
    if (hyd.action === 'hydrated') assert.ok(hyd.ms < 5_000, `CoW hydrate is fast (took ${hyd.ms}ms)`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a lockfile change orphans the donor — hydration refuses to cross it', async () => {
  const root = tmp();
  try {
    const donors = join(root, 'donors');
    const wt1 = makeWorktree(root, 'wt1', { lock: 'A' });
    const stashed = await stashDonor(wt1, donors);
    if (!COW) { assert.equal(stashed.action, 'skipped'); return; }
    const wt2 = makeWorktree(root, 'wt2', { lock: 'B', deps: false });
    assert.deepEqual(await hydrateFromDonor(wt2, donors), { action: 'skipped', reason: 'no-donor' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a repo that does NOT gitignore node_modules gets the hydration undone, not committed', async () => {
  const root = tmp();
  try {
    const donors = join(root, 'donors');
    const wt1 = makeWorktree(root, 'wt1');
    const stashed = await stashDonor(wt1, donors);
    if (!COW) { assert.equal(stashed.action, 'skipped'); return; }
    const wt2 = makeWorktree(root, 'wt2', { deps: false, ignored: false });
    assert.deepEqual(await hydrateFromDonor(wt2, donors), { action: 'skipped', reason: 'not-ignored' });
    assert.equal(existsSync(join(wt2, 'node_modules')), false, 'hydration undone — git add -A stays clean');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('pruneDonors keeps the newest two complete donors and sweeps junk', () => {
  const root = tmp();
  try {
    const donors = join(root, 'donors');
    for (const [name, at] of [['aaa', '2026-08-01'], ['bbb', '2026-08-05'], ['ccc', '2026-08-09']] as const) {
      mkdirSync(join(donors, name), { recursive: true });
      writeFileSync(join(donors, name, 'manifest.json'), JSON.stringify({ lockHash: name, relPaths: [], apparentBytes: 0, createdAt: at, platform: 'test', arch: 'test' }));
    }
    mkdirSync(join(donors, 'junk-no-manifest'), { recursive: true });
    const dead = pruneDonors(donors);
    assert.deepEqual(dead.sort(), ['aaa', 'junk-no-manifest'].sort(), 'oldest + incomplete go');
    assert.ok(existsSync(join(donors, 'ccc')) && existsSync(join(donors, 'bbb')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
