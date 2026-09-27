// The Worktrees table (docs/design/worktrees-2026-09 §4) over a real brain root in tmp: a task
// berth per class, a coding thread's worktree cut from a clone (with a dirty file), one whose
// thread left the replica. Run: pnpm exec tsx --test src/main/worktrees.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleWorktrees, type WorktreesDbRows } from './worktrees';
import { engineeringBranchName, engineeringWorktreeName } from './harness/worktree-rows';
import { gitChildEnv, removeEngineeringWorktree, worktreeCloneDir } from './harness/workspaces';

// under the pre-commit hook git exports GIT_DIR: strip it, or every command below targets the outer repo
const g = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, env: gitChildEnv() }).toString().trim();

function makeClone(root: string): string {
  const clone = join(root, 'cache', 'repos', 'r-flowe');
  mkdirSync(clone, { recursive: true });
  g(clone, 'init', '-b', 'main');
  writeFileSync(join(clone, 'a.txt'), 'a\n');
  g(clone, 'add', '-A');
  g(clone, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'seed');
  return clone;
}

test('the table: task berths classed by the board, thread worktrees joined with the replica, orphans named', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nm-wt-'));
  try {
    const clone = makeClone(root);
    const wt = join(root, 'cache', 'worktrees');
    // du counts blocks, so the size that must read larger gets many of them
    for (const n of [1046, 1042, 1031, 900]) { mkdirSync(join(wt, `nm-${n}`), { recursive: true }); writeFileSync(join(wt, `nm-${n}`, 'x'), 'x'.repeat(n === 1046 ? 400_000 : 1)); }
    // a coding thread's worktree, cut the way engineering-workspace.ts cuts it, with one uncommitted file
    const live = engineeringWorktreeName('u-george', 'r-flowe', 'th-sync');
    g(clone, 'worktree', 'add', '-b', engineeringBranchName('u-george', 'th-sync'), join(wt, live), 'main');
    writeFileSync(join(wt, live, 'b.txt'), 'b\n');
    // a worktree whose thread is gone from the replica
    const gone = engineeringWorktreeName('u-george', 'r-flowe', 'th-gone');
    g(clone, 'worktree', 'add', '-b', engineeringBranchName('u-george', 'th-gone'), join(wt, gone), 'main');
    const rows: WorktreesDbRows = {
      tasks: [
        { id: 't-1046', number: 1046, title: 'iOS Safari focus-trap release', state: 'in_progress', repo_id: 'r-flowe', branch: 'nm/1046-ios' },
        { id: 't-1042', number: 1042, title: 'Mobile nav drawer', state: 'in_review', repo_id: 'r-flowe', branch: 'nm/1042-nav' },
        { id: 't-1031', number: 1031, title: 'Rename the Board label', state: 'accepted', repo_id: 'r-flowe', branch: 'nm/1031-rename' },
      ],
      repos: [{ id: 'r-flowe', name: 'flowe/app' }],
      threads: [{ id: 'th-sync', title: 'Fix the sync watch', channel_id: 'c-dev' }],
      sessions: [{ thread_id: 'th-sync', state: 'awaiting_approval', repo_name: 'flowe/app' }],
    };
    const holds = { taskHeld: (n: number) => n === 1046, threadHeld: (id: string | null) => id === 'th-sync' };
    const p = await assembleWorktrees(root, 'test-mac', rows, holds);
    assert.equal(p.machine, 'test-mac');
    const byNum = new Map(p.tasks.map((t) => [t.taskNumber, t]));
    assert.equal(byNum.get(1046)?.cls, 'leased');
    assert.equal(byNum.get(1046)?.held, true);
    assert.equal(byNum.get(1046)?.repoName, 'flowe/app');
    assert.equal(byNum.get(1042)?.cls, 'warm');
    assert.equal(byNum.get(1031)?.cls, 'dead');
    assert.equal(byNum.get(900)?.cls, 'orphan');
    assert.equal(byNum.get(900)?.title, null);
    assert.ok((byNum.get(1046)?.bytes ?? 0) > (byNum.get(900)?.bytes ?? 0), 'sizes are measured');
    // the settled set = the sweeper's remove verdict: the dead and the orphan rows
    assert.equal(p.settled.count, 2);
    assert.equal(p.settled.bytes, (byNum.get(1031)?.bytes ?? 0) + (byNum.get(900)?.bytes ?? 0));

    const byName = new Map(p.threads.map((t) => [t.name, t]));
    const liveRow = byName.get(live)!;
    assert.equal(liveRow.threadId, 'th-sync');
    assert.equal(liveRow.channelId, 'c-dev');
    assert.equal(liveRow.title, 'Fix the sync watch');
    assert.equal(liveRow.cls, 'waits');
    assert.equal(liveRow.held, true);
    assert.equal(liveRow.branch, 'nm/engineering/u-george/th-sync');
    assert.equal(liveRow.repoName, 'flowe/app');
    assert.equal(liveRow.dirty, 1, 'the uncommitted file is counted');
    const goneRow = byName.get(gone)!;
    assert.equal(goneRow.threadId, null);
    assert.equal(goneRow.cls, 'orphan');
    assert.equal(goneRow.repoName, 'flowe/app', 'no session: the repository comes from the clone the worktree was cut from');
    assert.equal(goneRow.held, false);
    assert.equal(goneRow.dirty, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a thread worktree is removed totally: the dir, the admin entry and its own branch; the clone and main stay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nm-wt-'));
  try {
    const clone = makeClone(root);
    const wt = join(root, 'cache', 'worktrees');
    const name = engineeringWorktreeName('u-george', 'r-flowe', 'th-sync');
    const branch = engineeringBranchName('u-george', 'th-sync');
    g(clone, 'worktree', 'add', '-b', branch, join(wt, name), 'main');
    writeFileSync(join(wt, name, 'dirty.txt'), 'uncommitted\n');
    // git writes the pointer through macOS's /private/var symlink: compare real paths
    assert.equal(realpathSync(worktreeCloneDir(join(wt, name))!), realpathSync(clone), 'the clone is read from the worktree\'s own .git pointer');
    const notes = await removeEngineeringWorktree(join(wt, name));
    assert.deepEqual(notes, ['worktree', `branch ${branch}`]);
    assert.equal(existsSync(join(wt, name)), false, 'directory gone');
    assert.equal(existsSync(join(clone, '.git', 'worktrees', name)), false, 'admin entry gone');
    assert.equal(g(clone, 'branch', '--list', branch), '', 'the thread\'s branch gone');
    assert.equal(g(clone, 'branch', '--list', 'main'), '* main', 'main untouched');
    assert.equal(existsSync(join(clone, 'a.txt')), true, 'the clone untouched');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a worktree standing on a person\'s branch loses the directory and the admin entry, never the branch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nm-wt-'));
  try {
    const clone = makeClone(root);
    const wt = join(root, 'cache', 'worktrees');
    const name = engineeringWorktreeName('u-george', 'r-flowe', 'th-mine');
    g(clone, 'worktree', 'add', '-b', 'feature/mine', join(wt, name), 'main');
    const notes = await removeEngineeringWorktree(join(wt, name));
    assert.deepEqual(notes, ['worktree']);
    assert.equal(existsSync(join(wt, name)), false);
    assert.equal(g(clone, 'branch', '--list', 'feature/mine'), 'feature/mine', 'a person\'s branch survives');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a directory that is no git worktree at all is still removed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nm-wt-'));
  try {
    const dir = join(root, 'cache', 'worktrees', 'engineering-u-r-th-plain');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'x'), 'x');
    assert.equal(worktreeCloneDir(dir), null);
    assert.deepEqual(await removeEngineeringWorktree(dir), []);
    assert.equal(existsSync(dir), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
