import { hydratePath } from '../harness/hydration';
// THE SCRATCH WORKSPACE (round 9, 0177): a coding thread with no repository. When the thread row says
// `workspace_mode = 'scratch'`, the session works in a fresh local git repository on this machine:
//
//   <brain>/cache/repos/scratch-<name>-<thread8>      the repository (git init, one first commit)
//   <brain>/cache/worktrees/engineering-<actor>-<that>-<thread>   the session's worktree, on the branch
//                                                     nm/engineering/<actor>/<thread>
//
// This is the exact shape a repository session has (engineering-workspace.ts): a cache clone and a
// worktree of it. So file review, diffs, the Code shell's git mounts, checkpoints and the dependency
// cache do not know the difference. The name comes from the intake (`threads.intake.name`), else from
// the thread title. The thread id is in the folder name and in the repository's git config
// (`nm.thread`), so no other thread can take the folder over.
//
// It lives under the brain root. On a Cloud Run machine that is inside the work dir, so the work
// snapshot carries it across a drain, and the next epoch reopens the same worktree. A second message
// reuses it: the open finds the worktree it cut before (earlierWorktree in engineering-workspace.ts).
// THE GIT POINTER IS RELATIVE. `git worktree add` writes the worktree's `.git` file as an absolute path
// on this host (/nm/work/brain/cache/repos/...). The agent box sees the work dir at /work, so there the
// path does not resolve unless the box has the /nm/work alias, and git in the box failed with "not a
// git repository" (r9-001, scratch-session check). So the pointer is rewritten relative to the worktree
// (`gitdir: ../../repos/<clone>/.git/worktrees/<name>`), which resolves under /nm/work, under /work, and
// after a snapshot restore. The repository's `commondir` is relative already. The back link
// (`.git/worktrees/<name>/gitdir`) stays absolute: only the host reads it (`git worktree prune`), and a
// relative one there would make git 2.39 (the image's) prune the worktree. git 2.48 has
// worktree.useRelativePaths for this, and the image's Debian git is older.
//
// The repository has no remote, so there is nothing to push. A later round may promote it to a
// project repository (docs/design/scratch-workspaces-2026-11.md).
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { ReplicaDatabase } from '@neuramesh/client-core/replica';
import { intakeOf, isScratchRepoId, scratchWorkspaceName, SCRATCH_WORKSPACE_LABEL } from '@neuramesh/shared';
import type { EngineeringMachineOpenMeta } from '../../engineering-protocol';
import { withRepoLock } from '../agents';
import { cachePath } from '../harness/brain';
import { engineeringBranchName, engineeringWorktreeName, safeSegment } from '../harness/worktree-rows';
import { git } from '../host/gh';

type Db = Pick<ReplicaDatabase, 'get'>;

export interface ScratchThread { name: string; title: string }

/** who commits the first commit. The agent's own commits use the same identity unless it sets one */
const IDENTITY = ['-c', 'user.name=NeuraMesh', '-c', 'user.email=scratch@neuramesh.invalid'];

/** the repository id of a scratch thread's cache clone: the name, then the thread's first 8 characters */
export function scratchCloneId(name: string, threadId: string): string {
  return `scratch-${name}-${safeSegment(threadId).slice(0, 8)}`;
}

interface ThreadRow { workspace_mode: string | null; intake: string | null; title: string | null }

/** How long an open waits for the replica to carry the thread's workspace mode. A thread born a moment
 *  ago can be ahead of this machine's replica */
export const SCRATCH_ROW_WAIT_MS = 10_000;

/** The scratch thread this open is for, or null for a repository session. The thread row decides.
 *  The client's SCRATCH_REPO_ID only says that it has no repository: with it, the open waits a short
 *  time for the row, and refuses when the row says another thing. */
export async function scratchThreadOf(db: Db, workspaceId: string, meta: EngineeringMachineOpenMeta, o: { waitMs?: number; pollMs?: number } = {}): Promise<ScratchThread | null> {
  const read = () => db.get<ThreadRow>(`select workspace_mode, intake, title from threads where id = ? and workspace_id = ?`, [meta.threadId, workspaceId]).catch(() => null);
  let row = await read();
  const hinted = isScratchRepoId(meta.repoId);
  if (hinted && row?.workspace_mode !== 'scratch') {
    const until = Date.now() + (o.waitMs ?? SCRATCH_ROW_WAIT_MS);
    while (row?.workspace_mode !== 'scratch' && row?.workspace_mode !== 'repo' && Date.now() < until) {
      await new Promise((r) => setTimeout(r, o.pollMs ?? 500));
      row = await read();
    }
  }
  if (row?.workspace_mode === 'scratch') {
    const decided = intakeOf(row.intake);
    return { name: scratchWorkspaceName(decided, row.title), title: row.title?.trim() || decided?.title?.trim() || SCRATCH_WORKSPACE_LABEL };
  }
  if (!hinted) return null;
  if (!row) throw new Error(`${SCRATCH_WORKSPACE_LABEL} is not in this project on this machine yet.`);
  throw new Error(row.workspace_mode === 'repo' ? 'This thread works on a repository, not in a scratch workspace.' : 'This thread has no scratch workspace.');
}

/** make the scratch repository and the session's worktree, once. `created`: this call cut the worktree */
export async function ensureScratchWorkspace(meta: EngineeringMachineOpenMeta, thread: ScratchThread): Promise<{ cwd: string; repoRoot: string; created: boolean }> {
  const cloneId = scratchCloneId(thread.name, meta.threadId);
  const repoRoot = cachePath('repos', safeSegment(cloneId));
  const cwd = cachePath('worktrees', engineeringWorktreeName(meta.actorId, cloneId, meta.threadId));
  let created = false;
  await hydratePath(cwd);
  await hydratePath(repoRoot);
  await withRepoLock(cloneId, async () => {
    if (!existsSync(join(repoRoot, '.git'))) {
      mkdirSync(repoRoot, { recursive: true });
      await git(['init', '-q', '-b', 'main'], repoRoot);
      await git(['config', 'nm.thread', meta.threadId], repoRoot);
      writeFileSync(join(repoRoot, 'README.md'), `# ${thread.title}\n\nA scratch workspace for one NeuraMesh thread. It has no remote.\n`);
      writeFileSync(join(repoRoot, '.gitignore'), 'node_modules/\n');
      await git(['add', '-A'], repoRoot);
      await git([...IDENTITY, 'commit', '-q', '-m', `Start ${thread.name}`], repoRoot);
    }
    // a folder whose repository names another thread is never reused (a short id that collides)
    const owner = await git(['config', '--get', 'nm.thread'], repoRoot).catch(() => '');
    if (owner !== meta.threadId) throw new Error('Code refused a scratch workspace that belongs to another thread.');
    if (existsSync(cwd)) { pinRelativeGitdir(cwd); return; }
    mkdirSync(cachePath('worktrees'), { recursive: true });
    await git(['worktree', 'prune'], repoRoot);
    const branch = engineeringBranchName(meta.actorId, meta.threadId);
    const branchExists = await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repoRoot).then(() => true).catch(() => false);
    await git(branchExists ? ['worktree', 'add', cwd, branch] : ['worktree', 'add', '-b', branch, cwd, 'main'], repoRoot);
    pinRelativeGitdir(cwd);
    created = true;
  });
  return { cwd, repoRoot, created };
}

/** Rewrite a worktree's `.git` pointer relative to the worktree (the header). A pointer that is relative
 *  already, or a `.git` that is not a pointer file, is left as it is. Returns true when it wrote */
export function pinRelativeGitdir(worktree: string): boolean {
  const marker = join(worktree, '.git');
  let value: string;
  try { value = readFileSync(marker, 'utf8').trim(); } catch { return false; }
  if (!value.startsWith('gitdir:')) return false;
  const target = value.slice('gitdir:'.length).trim();
  if (!isAbsolute(target) || !existsSync(target)) return false;
  // Git canonicalizes its target. Both paths must use the same view of /tmp on
  // macOS or the relative pointer escapes the brain and cannot survive a move.
  writeFileSync(marker, `gitdir: ${relative(realpathSync(dirname(marker)), realpathSync(target))}\n`);
  return true;
}
