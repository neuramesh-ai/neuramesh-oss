// Task-workspace reclaim (worktree-berths round, docs/design/worktree-berths-2026-08).
//
// A task worktree is DERIVED state — branch on the remote, deliverables in artifacts — so removal
// must be total: the directory, git's admin entry, and the local branch. The pre-round reclaim used
// a plain `rm -rf`, which deletes only the first of the three; on user zero's machine that left 6
// orphaned `.git/worktrees/*` entries and 25 stale `nm/*` branches that nothing would ever delete
// (the squash-merge's `--delete-branch` kills the REMOTE one only).
//
// Electron-free on purpose, like the rest of harness/ — the daemon's own `git()` lives inside
// agents.ts, which cannot be imported under `tsx --test` without dragging the app along.

import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

/**
 * A child-git env with the repo-locating variables STRIPPED. `git commit` exports GIT_DIR /
 * GIT_INDEX_FILE to its hooks, so any test (or tool) spawning git under a hook inherits them and
 * silently operates on the OUTER repo instead of its own cwd — which is how this round's test
 * suite, run by the pre-commit hook, re-inited the developer's main checkout as bare (2026-08-11).
 * cwd must be the only thing that decides which repo a spawned git touches.
 */
export function gitChildEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, GIT_TERMINAL_PROMPT: '0' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CEILING_DIRECTORIES']) {
    delete env[k];
  }
  return env;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('git', args, { cwd, env: gitChildEnv() });
  return stdout.trim();
}

/**
 * Remove one task's local workspace completely. Best-effort per step (a failed step must never
 * block the others — a half-reclaimed workspace is still better than a wedged watch), returns
 * human-readable notes of what actually went for the caller's log line.
 *
 * Serialization is the CALLER's job: clone-dir git operations must run under the same per-repo
 * lock as worktree creation (agents.ts `withRepoLock` — git's locks are not reentrant).
 */
export async function removeTaskWorkspace(o: {
  /** cache/worktrees/nm-<n> */
  wtDir: string;
  /** deliverables/nm-<n> — scratch tasks; null when the caller handles it elsewhere */
  deliverableDir?: string | null;
  /** cache/repos/<repoId> — null for scratch tasks (no git side at all) */
  cloneDir?: string | null;
  /** the task's local branch (nm/<n>-slug) — deleted so clones stop accreting dead refs */
  branch?: string | null;
}): Promise<string[]> {
  const notes: string[] = [];
  if (o.cloneDir && existsSync(o.cloneDir)) {
    // `worktree remove` clears the dir AND `.git/worktrees/<name>`; `prune` covers the legacy
    // case where the dir was already rm'd by hand (the admin entry is then all that's left).
    await runGit(['worktree', 'remove', '--force', o.wtDir], o.cloneDir).then(
      () => notes.push('worktree'),
      () => {},
    );
    await runGit(['worktree', 'prune'], o.cloneDir).catch(() => {});
    if (o.branch) {
      // -D not -d: the branch's work lives on as the squashed merge commit, so git's
      // "not fully merged" objection is always a false positive here.
      await runGit(['branch', '-D', o.branch], o.cloneDir).then(
        () => notes.push(`branch ${o.branch}`),
        () => {},
      );
    }
  }
  // fallback + scratch side: covers a missing/foreign clone, and is a no-op after a
  // successful `worktree remove`
  await rm(o.wtDir, { recursive: true, force: true }).then(() => {}, () => {});
  if (o.deliverableDir) {
    await rm(o.deliverableDir, { recursive: true, force: true }).then(() => notes.push('deliverables'), () => {});
  }
  return notes;
}
