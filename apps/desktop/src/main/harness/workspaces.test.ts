// Workspace reclaim (worktree-berths round). Run: pnpm exec tsx --test src/main/harness/workspaces.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTaskWorkspace, gitChildEnv } from './workspaces';

// gitChildEnv here too: this suite RUNS UNDER THE PRE-COMMIT HOOK, where git exports GIT_DIR —
// without the strip, every command below targets the developer's outer repo instead of tmpdir
// (which is exactly how the first run of this file flipped the main checkout to bare=true).
const g = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env: gitChildEnv() }).toString().trim();

/** A clone-shaped repo with one commit, standing in for cache/repos/<repoId>. */
function makeClone(root: string): string {
  const clone = join(root, 'clone');
  mkdirSync(clone, { recursive: true });
  g(clone, 'init', '-b', 'main');
  writeFileSync(join(clone, 'a.txt'), 'a\n');
  g(clone, 'add', '-A');
  g(clone, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'seed');
  return clone;
}

test('repo-backed reclaim removes the dir, the admin entry, AND the local branch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nm-ws-'));
  try {
    const clone = makeClone(root);
    const wt = join(root, 'nm-7');
    g(clone, 'worktree', 'add', '--force', wt, '-B', 'nm/7-x', 'main');
    assert.ok(existsSync(wt));

    const notes = await removeTaskWorkspace({ wtDir: wt, cloneDir: clone, branch: 'nm/7-x' });

    assert.equal(existsSync(wt), false, 'worktree dir gone');
    assert.ok(!g(clone, 'worktree', 'list').includes('nm-7'), 'admin entry gone');
    assert.equal(g(clone, 'branch', '--list', 'nm/7-x'), '', 'local branch gone');
    assert.deepEqual(notes, ['worktree', 'branch nm/7-x']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// THE found leak (audit 2026-08-11): the old reclaim `rm -rf`'d the dir, so git kept
// `.git/worktrees/<name>` and the branch forever — 6 orphan entries + 25 stale branches live.
// Reclaim must converge from that half-removed state, not only from a healthy one.
test('a worktree whose dir was already rm-rfd still loses its admin entry and branch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nm-ws-'));
  try {
    const clone = makeClone(root);
    const wt = join(root, 'nm-8');
    g(clone, 'worktree', 'add', '--force', wt, '-B', 'nm/8-y', 'main');
    rmSync(wt, { recursive: true, force: true }); // the legacy reclaim's handiwork
    assert.ok(g(clone, 'worktree', 'list').includes('nm-8'), 'precondition: orphan admin entry');

    await removeTaskWorkspace({ wtDir: wt, cloneDir: clone, branch: 'nm/8-y' });

    assert.ok(!g(clone, 'worktree', 'list').includes('nm-8'), 'orphan admin entry pruned');
    assert.equal(g(clone, 'branch', '--list', 'nm/8-y'), '', 'stale branch gone');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scratch reclaim (no clone) removes workspace + deliverables and never touches git', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nm-ws-'));
  try {
    const wt = join(root, 'nm-9');
    const del = join(root, 'deliv-9');
    mkdirSync(wt, { recursive: true });
    mkdirSync(del, { recursive: true });

    const notes = await removeTaskWorkspace({ wtDir: wt, deliverableDir: del, cloneDir: null, branch: null });

    assert.equal(existsSync(wt), false);
    assert.equal(existsSync(del), false);
    assert.deepEqual(notes, ['deliverables']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The 2026-08-11 incident, as a permanent guard: `git commit` exports GIT_DIR/GIT_INDEX_FILE to
// its hooks, this suite runs UNDER that hook, and an inherited GIT_DIR redirects every spawned git
// at the outer repo — the first run re-inited the developer's main checkout as bare. cwd, and only
// cwd, may decide which repo a child git touches.
test('an inherited hook GIT_DIR never redirects reclaim at the outer repo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nm-ws-'));
  const saved = { GIT_DIR: process.env['GIT_DIR'], GIT_INDEX_FILE: process.env['GIT_INDEX_FILE'] };
  try {
    const decoy = join(root, 'decoy'); // stands in for the developer's repo a hook would leak
    mkdirSync(decoy, { recursive: true });
    g(decoy, 'init', '-b', 'main');
    const clone = makeClone(root);
    const wt = join(root, 'nm-11');
    g(clone, 'worktree', 'add', '--force', wt, '-B', 'nm/11-w', 'main');

    process.env['GIT_DIR'] = join(decoy, '.git');
    process.env['GIT_INDEX_FILE'] = join(decoy, '.git', 'index');
    await removeTaskWorkspace({ wtDir: wt, cloneDir: clone, branch: 'nm/11-w' });

    delete process.env['GIT_DIR'];
    delete process.env['GIT_INDEX_FILE'];
    assert.equal(existsSync(wt), false, 'the intended repo was operated on');
    assert.equal(g(clone, 'branch', '--list', 'nm/11-w'), '', 'intended branch gone');
    assert.equal(g(decoy, 'config', 'core.bare'), 'false', 'decoy config untouched — never flipped bare');
    assert.equal(g(decoy, 'worktree', 'list').split('\n').length, 1, 'decoy gained no worktrees');
  } finally {
    if (saved.GIT_DIR === undefined) delete process.env['GIT_DIR']; else process.env['GIT_DIR'] = saved.GIT_DIR;
    if (saved.GIT_INDEX_FILE === undefined) delete process.env['GIT_INDEX_FILE']; else process.env['GIT_INDEX_FILE'] = saved.GIT_INDEX_FILE;
    rmSync(root, { recursive: true, force: true });
  }
});

test('a vanished clone degrades to plain dir removal instead of throwing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nm-ws-'));
  try {
    const wt = join(root, 'nm-10');
    mkdirSync(wt, { recursive: true });
    const notes = await removeTaskWorkspace({ wtDir: wt, cloneDir: join(root, 'nope'), branch: 'nm/10-z' });
    assert.equal(existsSync(wt), false);
    assert.deepEqual(notes, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
