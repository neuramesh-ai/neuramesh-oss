// The dependency cache's two halves (depcache.ts) over a fake Snapshots, with real git for the
// gitignore rail: a restore never lands a tree the repository would commit, never overwrites a tree
// that is there, and a save sends every dependency tree of a pnpm workspace, not only the root one.
// On a miss with a host installer (D17, depinstall.ts) the worktree is installed, the session hears the
// phases, and the tree is stored, while every failure leaves the worktree as a plain miss leaves it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitChildEnv } from '../harness/workspaces';
import { depCache, depCacheOn, snapshotDepCache, useDepCache, type DepPhase } from './depcache';
import type { HostInstaller, InstallOutcome } from './depinstall';
import type { Snapshots } from './snapshot';

const git = (args: string[], cwd: string) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitChildEnv() }).trim();

/** a worktree with a lockfile, a workspace package, and the given .gitignore */
function worktree(ignore: string | null, lockfile = true): string {
  const dir = mkdtempSync('/tmp/nm-depcache-');
  git(['init', '-b', 'main'], dir);
  if (lockfile) writeFileSync(join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  if (ignore !== null) writeFileSync(join(dir, '.gitignore'), ignore);
  mkdirSync(join(dir, 'packages', 'app'), { recursive: true });
  writeFileSync(join(dir, 'packages', 'app', 'package.json'), '{}\n');
  return dir;
}

/** what a restore of a stored pnpm workspace writes: the root tree and a package's own */
function landTrees(dir: string): void {
  mkdirSync(join(dir, 'node_modules', '.pnpm'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', '.modules.yaml'), 'x\n');
  mkdirSync(join(dir, 'packages', 'app', 'node_modules'), { recursive: true });
  writeFileSync(join(dir, 'packages', 'app', 'node_modules', 'link'), 'x\n');
}

function fakeSnapshots(o: { stored?: boolean; exists?: boolean } = {}) {
  const restored: string[] = []; const saved: Array<{ dir: string; paths: string[] }> = [];
  const s: Pick<Snapshots, 'depRestore' | 'depSave'> = {
    depRestore: async (dir) => { restored.push(dir); if (o.stored) landTrees(dir); return o.stored ? { key: 'k1', hit: true } : { key: 'k1', hit: false }; },
    depSave: async (dir, paths = ['node_modules']) => { saved.push({ dir, paths }); return o.exists ? { key: 'k1', skipped: true } : { key: 'k1', skipped: false, result: { rawBytes: 4096, zBytes: 1024, ms: 1 } }; },
  };
  return { s, restored, saved };
}

test('hydrate: a hit lands every tree when the repository ignores them', async () => {
  const dir = worktree('node_modules/\n');
  try {
    const f = fakeSnapshots({ stored: true });
    const note = await snapshotDepCache(f.s).hydrate(dir);
    assert.equal(note.action, 'hit');
    assert.deepEqual(note.action === 'hit' ? note.paths : null, ['node_modules', 'packages/app/node_modules']);
    assert.equal(existsSync(join(dir, 'packages', 'app', 'node_modules', 'link')), true);
    assert.equal(git(['status', '--porcelain', '--untracked-files=all'], dir).includes('node_modules'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hydrate: a tree the repository would commit is removed again', async () => {
  const dir = worktree(null);
  try {
    const note = await snapshotDepCache(fakeSnapshots({ stored: true }).s).hydrate(dir);
    assert.deepEqual(note, { action: 'skipped', reason: 'not-ignored' });
    assert.equal(existsSync(join(dir, 'node_modules')), false);
    assert.equal(existsSync(join(dir, 'packages', 'app', 'node_modules')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hydrate: a miss, no lockfile, and trees already there ask nothing more or change nothing', async () => {
  const miss = worktree('node_modules/\n'); const bare = worktree('node_modules/\n', false); const full = worktree('node_modules/\n');
  try {
    const f = fakeSnapshots();
    assert.equal((await snapshotDepCache(f.s).hydrate(miss)).action, 'miss');
    assert.deepEqual(await snapshotDepCache(f.s).hydrate(bare), { action: 'skipped', reason: 'no-lockfile' });
    mkdirSync(join(full, 'node_modules'));
    assert.deepEqual(await snapshotDepCache(f.s).hydrate(full), { action: 'skipped', reason: 'has-deps' });
    assert.deepEqual(f.restored, [miss]);
  } finally { for (const d of [miss, bare, full]) rmSync(d, { recursive: true, force: true }); }
});

test('remember: saves every dependency tree, once per key, and only trees the repository ignores', async () => {
  const dir = worktree('node_modules/\n'); const open = worktree(null); const empty = worktree('node_modules/\n');
  try {
    landTrees(dir); landTrees(open);
    const f = fakeSnapshots();
    assert.equal((await snapshotDepCache(f.s).remember(dir)).action, 'saved');
    assert.deepEqual(f.saved, [{ dir, paths: ['node_modules', 'packages/app/node_modules'] }]);
    assert.equal((await snapshotDepCache(fakeSnapshots({ exists: true }).s).remember(dir)).action, 'exists');
    assert.deepEqual(await snapshotDepCache(f.s).remember(open), { action: 'skipped', reason: 'not-ignored' });
    assert.deepEqual(await snapshotDepCache(f.s).remember(empty), { action: 'skipped', reason: 'no-deps' });
    assert.equal(f.saved.length, 1);
  } finally { for (const d of [dir, open, empty]) rmSync(d, { recursive: true, force: true }); }
});

test('the seam is off unless NM_DEPCACHE=1 installs it', () => {
  assert.equal(depCacheOn({}), false);
  assert.equal(depCacheOn({ NM_DEPCACHE: '1' }), true);
  assert.equal(depCache(), null);
  const dc = snapshotDepCache(fakeSnapshots().s);
  useDepCache(dc);
  assert.equal(depCache(), dc);
  useDepCache(null);
});

/** a host installer that answers from a script and, when it succeeds, lands the trees an install makes */
function fakeInstaller(answer: InstallOutcome, lands = answer.ok) {
  const calls: string[] = [];
  const install: HostInstaller = { install: async (dir) => { calls.push(dir); if (lands) landTrees(dir); return answer; } };
  return { install, calls };
}
const until = async (ok: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !ok(); i += 1) await new Promise((r) => setTimeout(r, 10));
};

test('hydrate: a miss with a host installer installs, tells the session, and stores the tree', async () => {
  const dir = worktree('node_modules/\n');
  try {
    const f = fakeSnapshots();
    const inst = fakeInstaller({ ok: true, pm: 'pnpm', ms: 40, rebuilt: 'ok', store: true });
    const phases: DepPhase[] = [];
    const note = await snapshotDepCache(f.s, () => {}, { install: inst.install }).hydrate(dir, (p) => phases.push(p));
    assert.equal(note.action, 'installed');
    assert.deepEqual(note.action === 'installed' ? [note.key, note.paths, note.stored] : null, ['k1', ['node_modules', 'packages/app/node_modules'], 'saving']);
    assert.deepEqual(phases, ['installing_dependencies', 'dependencies_ready']);
    assert.deepEqual(inst.calls, [dir]);
    await until(() => f.saved.length > 0);
    assert.deepEqual(f.saved, [{ dir, paths: ['node_modules', 'packages/app/node_modules'] }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hydrate: a timeout or a failed install falls back to a miss with its reason, with no tree left and nothing stored', async () => {
  for (const answer of [
    { ok: false, reason: 'timeout', detail: 'pnpm stopped after 300000 ms' },
    { ok: false, reason: 'failed', detail: 'npm exited 1: 404' },
    { ok: false, reason: 'no-binary', detail: 'bun' },
  ] as const) {
    const dir = worktree('node_modules/\n');
    try {
      const f = fakeSnapshots();
      // the failed install leaves a half tree, which the fallback removes
      const inst = fakeInstaller(answer, true);
      const phases: DepPhase[] = [];
      const note = await snapshotDepCache(f.s, () => {}, { install: inst.install }).hydrate(dir, (p) => phases.push(p));
      assert.deepEqual(note.action === 'miss' ? note.fallback : note, `${answer.reason} (${answer.detail})`);
      assert.deepEqual(phases, ['installing_dependencies', 'dependencies_ready'], 'the session never stays on installing');
      assert.equal(existsSync(join(dir, 'node_modules')), false);
      assert.equal(existsSync(join(dir, 'packages', 'app', 'node_modules')), false);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(f.saved.length, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  // a throw is a failure too
  const dir = worktree('node_modules/\n');
  try {
    const note = await snapshotDepCache(fakeSnapshots().s, () => {}, { install: { install: async () => { throw new Error('spawn EACCES'); } } }).hydrate(dir);
    assert.equal(note.action === 'miss' ? note.fallback : null, 'failed (spawn EACCES)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hydrate: no install for a hit, no lockfile, trees already there, or a repository that does not ignore node_modules', async () => {
  const hit = worktree('node_modules/\n'); const bare = worktree('node_modules/\n', false); const full = worktree('node_modules/\n'); const open = worktree(null);
  try {
    const inst = fakeInstaller({ ok: true, pm: 'npm', ms: 1, rebuilt: 'ok', store: true });
    const phases: DepPhase[] = [];
    const seen = (p: DepPhase) => phases.push(p);
    assert.equal((await snapshotDepCache(fakeSnapshots({ stored: true }).s, () => {}, { install: inst.install }).hydrate(hit, seen)).action, 'hit');
    assert.deepEqual(await snapshotDepCache(fakeSnapshots().s, () => {}, { install: inst.install }).hydrate(bare, seen), { action: 'skipped', reason: 'no-lockfile' });
    mkdirSync(join(full, 'node_modules'));
    assert.deepEqual(await snapshotDepCache(fakeSnapshots().s, () => {}, { install: inst.install }).hydrate(full, seen), { action: 'skipped', reason: 'has-deps' });
    const note = await snapshotDepCache(fakeSnapshots().s, () => {}, { install: inst.install }).hydrate(open, seen);
    assert.equal(note.action === 'miss' ? note.fallback : null, 'not-ignored');
    assert.equal(existsSync(join(open, 'node_modules')), false);
    assert.deepEqual(inst.calls, []);
    assert.deepEqual(phases, []);
  } finally { for (const d of [hit, bare, full, open]) rmSync(d, { recursive: true, force: true }); }
});

test('hydrate: an install whose lifecycle scripts did not run in the box fills the worktree but stays out of the cache', async () => {
  const dir = worktree('node_modules/\n');
  try {
    const f = fakeSnapshots();
    const inst = fakeInstaller({ ok: true, pm: 'npm', ms: 5, rebuilt: 'none', store: false, rebuildProblem: 'the box is down' });
    const note = await snapshotDepCache(f.s, () => {}, { install: inst.install }).hydrate(dir);
    assert.equal(note.action === 'installed' ? note.stored : null, 'held');
    assert.equal(existsSync(join(dir, 'node_modules', '.modules.yaml')), true);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(f.saved.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hydrate: a nested tree that was there before the install is never removed by a fallback', async () => {
  const dir = worktree('/node_modules/\n');
  try {
    // a vendored nested tree the repository tracks
    mkdirSync(join(dir, 'packages', 'app', 'node_modules'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'app', 'node_modules', 'vendored.js'), 'x\n');
    const note = await snapshotDepCache(fakeSnapshots().s, () => {}, { install: fakeInstaller({ ok: false, reason: 'timeout' }, true).install }).hydrate(dir);
    assert.equal(note.action === 'miss' ? note.fallback : null, 'timeout');
    assert.equal(existsSync(join(dir, 'node_modules')), false);
    assert.equal(existsSync(join(dir, 'packages', 'app', 'node_modules', 'vendored.js')), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
