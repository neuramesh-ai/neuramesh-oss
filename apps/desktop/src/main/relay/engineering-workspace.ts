import { existsSync, mkdirSync } from 'node:fs';
import type { AbstractPowerSyncDatabase } from '@powersync/node';
import type { EngineeringMachineOpenMeta } from '../../engineering-protocol';
import { withRepoLock } from '../agents';
import { cachePath } from '../harness/brain';
import { git } from '../host/gh';

interface RepoRow { clone_url: string | null; default_branch: string | null; local_path: string | null }

const safe = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80);
export const engineeringRepoRoot = (repoId: string): string => cachePath('repos', safe(repoId));

/** Give every Engineering thread its own durable git worktree. It is intentionally retained when
 * the relay disconnects: closing a browser tab must not delete uncommitted work, and reopening the
 * same thread must land on the same files. The normal footprint/berth machinery can later expose
 * explicit cleanup without making a transport failure destructive. */
export async function ensureEngineeringWorkspace(
  db: Pick<AbstractPowerSyncDatabase, 'get'>,
  workspaceId: string,
  meta: EngineeringMachineOpenMeta,
  /** THE DESKTOP'S OWN CHECKOUT (the desktop Code bridge, slice B1): when the repo is attached to
   *  this machine with a local path, the thread's worktree is cut from that checkout — the
   *  member's own clone, their remotes, their credentials — instead of a cache clone. A cloud
   *  machine never has one, so the default is the clone. */
  opts: { preferLocal?: boolean } = {},
): Promise<string> {
  const repo = await db.get<RepoRow>(
    `select r.clone_url, r.default_branch, r.local_path from repos r
      where r.id = ? and r.workspace_id = ?
        and (? is null or exists (select 1 from project_repos pr where pr.repo_id = r.id and pr.project_id = ?))`,
    [meta.repoId, workspaceId, meta.projectId ?? null, meta.projectId ?? null],
  );
  const local = opts.preferLocal && repo?.local_path && existsSync(repo.local_path) ? repo.local_path : null;
  if (!repo?.clone_url && !local) throw new Error(`${meta.repoName} is not available in this workspace or has no clone URL. Connect its Git remote before starting a cloud Engineering thread.`);
  const cloneDir = local ?? engineeringRepoRoot(meta.repoId);
  const worktreeDir = cachePath('worktrees', `engineering-${safe(meta.actorId)}-${safe(meta.repoId)}-${safe(meta.threadId)}`);
  if (existsSync(worktreeDir)) return worktreeDir;
  mkdirSync(cachePath('repos'), { recursive: true });
  mkdirSync(cachePath('worktrees'), { recursive: true });
  await withRepoLock(meta.repoId, async () => {
    if (local) { await git(['fetch', '--all', '--prune'], cloneDir).catch(() => undefined); } // a local checkout may have no remote at all
    else if (!existsSync(cloneDir)) await git(['clone', repo!.clone_url!, cloneDir]);
    else await git(['fetch', 'origin', '--prune'], cloneDir);
    if (existsSync(worktreeDir)) return;
    await git(['worktree', 'prune'], cloneDir);
    const base = meta.branch || repo?.default_branch || 'main';
    await git(['check-ref-format', '--branch', base], cloneDir);
    const branch = `nm/engineering/${safe(meta.actorId)}/${safe(meta.threadId)}`;
    // Never reset an existing Engineering branch. A missing directory can follow a machine
    // restart or an operator cleanup while the branch still contains committed work; `-B`
    // would silently throw that work away by moving the branch back to origin/base.
    const branchExists = await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], cloneDir).then(() => true).catch(() => false);
    if (branchExists) { await git(['worktree', 'add', worktreeDir, branch], cloneDir); return; }
    // a local checkout's base is its own branch when it has one; a cache clone's is always origin's
    const localBase = local ? await git(['show-ref', '--verify', '--quiet', `refs/heads/${base}`], cloneDir).then(() => true).catch(() => false) : false;
    await git(['worktree', 'add', '-b', branch, worktreeDir, localBase ? base : `origin/${base}`], cloneDir);
  });
  return worktreeDir;
}
