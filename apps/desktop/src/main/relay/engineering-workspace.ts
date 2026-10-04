import { existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { AbstractPowerSyncDatabase } from '@powersync/node';
import type { EngineeringMachineOpenMeta } from '../../engineering-protocol';
import { withRepoLock } from '../agents';
import { cachePath } from '../harness/brain';
import { worktreeCloneDir } from '../harness/workspaces';
import { git, repoSlug, type GhEnv } from '../host/gh';
import { ENGINEERING_WORKTREE_PREFIX, engineeringBranchName, engineeringWorktreeName, safeSegment as safe } from '../harness/worktree-rows';
import type { RepoCredResult } from '../host/repocred';

interface RepoRow { name: string | null; clone_url: string | null; default_branch: string | null; local_path: string | null }

export const engineeringRepoRoot = (repoId: string): string => cachePath('repos', safe(repoId));

/** where a thread works: its worktree, and the clone the shell checks the worktree's git pointer
 *  against, which is the cache clone the worktree came from (a twin's included). A desktop checkout
 *  keeps its cache path, as before the twin, and the check refuses there: the checkout's refs, objects
 *  and logs hold the person's own work, and a match mounts them writable for every agent command. */
export interface EngineeringWorkspace { cwd: string; repoRoot: string }

/** a cloud session that cannot reach its code until GitHub is connected: the relay names it, and the
 *  thread's gate seat puts up the GitHub card instead of a raw error (docs/design/repo-connect-2026-10) */
export class EngineeringNeedsGitHub extends Error {
  readonly code = 'GITHUB_REQUIRED';
}

// the token route's refusals that a grant or a pick fixes. The GitHub card for any other refusal
// reopens the session into the same refusal, and the person never reads its cause.
const GRANT_FIXES = new Set(['NOT_CONNECTED', 'NO_REPO', 'RECONNECT_REQUIRED']);

type Db = Pick<AbstractPowerSyncDatabase, 'get'>;
/** `base`: the branch a new worktree starts from */
interface CloneTarget { id: string; url: string; slug: string | null; base: string | null }
const targetOf = (id: string, url: string, base: string | null): CloneTarget => ({ id, url, slug: repoSlug(url) || null, base });

const SLUG = `lower(r.org_name || '/' || r.name)`;

/** the clone a session works on, or the refusal that names what is missing. A repository with a clone
 *  URL is its own clone. A folder attached from a desktop has none, and the GitHub pick attaches its
 *  twin beside it (github-resolve.ts). The connector holds one handle per project, and each pick
 *  overwrites it, so the handle names no folder: the twin is the project's GitHub repository with the
 *  folder's name (the resolve's hintFor), ties sorted as repoForChannel sorts them, the connected one
 *  first. The connected repository is the twin of a folder with another name only in the shape the
 *  pick makes: the folder is the primary, and the project holds the two of them and no other. */
async function cloneTarget(db: Db, workspaceId: string, meta: EngineeringMachineOpenMeta, repo: RepoRow, cloud: boolean): Promise<CloneTarget> {
  if (repo.clone_url) return targetOf(meta.repoId, repo.clone_url, meta.branch || repo.default_branch);
  const project = meta.projectId ?? (await db.get<{ project_id: string | null }>(`select c.project_id from threads t join channels c on c.id = t.channel_id where t.id = ?`, [meta.threadId]).catch(() => null))?.project_id ?? null;
  const handle = (await db.get<{ handle: string }>(
    `select k.handle from threads t join channels c on c.id = t.channel_id join connectors k on k.project_id = c.project_id
      where t.id = ? and k.workspace_id = ? and k.provider = 'github' and k.status = 'connected' limit 1`,
    [meta.threadId, workspaceId],
  ).catch(() => null))?.handle?.toLowerCase() || null;
  const twin = (where: string, params: string[]) => db.get<{ id: string; clone_url: string; default_branch: string | null }>(
    `select r.id, r.clone_url, r.default_branch from repos r join project_repos pr on pr.repo_id = r.id
      where pr.project_id = ? and r.workspace_id = ? and r.clone_url is not null and ${where}
      order by ${SLUG} = ? desc, coalesce(pr.is_primary, 0) desc, r.org_name, r.name limit 1`,
    [project, workspaceId, ...params, handle ?? ''],
  ).catch(() => null);
  const named = project && repo.name ? await twin('lower(r.name) = ?', [repo.name.toLowerCase()]) : null;
  const hit = named ?? (project && handle ? await twin(`${SLUG} = ? and (select count(*) from project_repos o where o.project_id = pr.project_id) = 2
    and exists (select 1 from project_repos f where f.project_id = pr.project_id and f.repo_id = ? and coalesce(f.is_primary, 0) = 1)`, [handle, meta.repoId]) : null);
  // a twin starts from its own default branch: the session names the branch the desktop checkout was on, which GitHub can lack
  if (hit) return targetOf(hit.id, hit.clone_url, hit.default_branch);
  // the desktop clones with its own login, so a GitHub grant is not what it lacks
  if (!cloud) throw new Error(`This machine has no checkout of ${meta.repoName} and no clone URL for it.`);
  // the gate's resolve answers connected for this room, so a GitHub card only opens the session into this refusal again
  if (handle) throw new Error(`${meta.repoName} is a folder on a Mac. This cloud machine finds no GitHub copy of it. Start a new session on a GitHub repository of this project.`);
  throw new EngineeringNeedsGitHub(`${meta.repoName} needs its GitHub copy on this cloud machine. Connect GitHub, and the session starts.`);
}

/** a failed clone or fetch of the cache clone, in words a person can act on. Only a cloud machine waits
 *  for GitHub, and only for a refusal that a grant or a pick fixes. Any other refusal is the cause. A
 *  credential that worked, and the desktop's own clone with its own login, keep git's own error. */
function cloneRefusal(error: unknown, name: string, cloud: boolean, cred: RepoCredResult | null): unknown {
  if (!cloud || cred?.ok) return error;
  if (!cred || GRANT_FIXES.has(cred.code)) return new EngineeringNeedsGitHub(`${name} needs the neuramesh app on GitHub before this cloud machine can reach it. Connect GitHub, and the session starts.`);
  return new Error(`This cloud machine cannot reach ${name}: ${cred.error}`);
}

const real = (path: string): string | null => { try { return realpathSync(path); } catch { return null; } };

/** the worktree an earlier open cut for this thread, whichever clone it came from: a later pick can
 *  change the twin, and a reopen lands on its own files. Only a cache clone is the shell's check root.
 *  A worktree of a desktop checkout keeps the folder's cache path, as at its cut, so the check refuses there. */
function earlierWorktree(meta: EngineeringMachineOpenMeta): EngineeringWorkspace | null {
  const head = `${ENGINEERING_WORKTREE_PREFIX}${safe(meta.actorId)}-`; const tail = `-${safe(meta.threadId)}`;
  const name = (existsSync(cachePath('worktrees')) ? readdirSync(cachePath('worktrees')) : []).find((n) => n.length > head.length + tail.length && n.startsWith(head) && n.endsWith(tail));
  if (!name) return null;
  const cwd = cachePath('worktrees', name); const clone = worktreeCloneDir(cwd); const repos = real(cachePath('repos'));
  return { cwd, repoRoot: clone && repos && real(dirname(clone)) === repos ? cachePath('repos', basename(clone)) : engineeringRepoRoot(meta.repoId) };
}

/** Give every Engineering thread its own durable git worktree. It is intentionally retained when
 * the relay disconnects: closing a browser tab must not delete uncommitted work, and reopening the
 * same thread must land on the same files. The normal footprint/berth machinery can later expose
 * explicit cleanup without making a transport failure destructive. */
export async function ensureEngineeringWorkspace(
  db: Db,
  workspaceId: string,
  meta: EngineeringMachineOpenMeta,
  /** THE DESKTOP'S OWN CHECKOUT (the desktop Code bridge, slice B1): when the repo is attached to
   *  this machine with a local path, the thread's worktree is cut from that checkout — the
   *  member's own clone, their remotes, their credentials — instead of a cache clone. A cloud
   *  machine never has one, so the default is the clone. `credFor` is the cloud's App token lane
   *  (host/repocred.ts): a login-less machine clones a private repository through it. */
  opts: { preferLocal?: boolean; credFor?: (slug: string, channelId: string) => Promise<RepoCredResult> } = {},
): Promise<EngineeringWorkspace> {
  const repo = await db.get<RepoRow>(
    `select r.name, r.clone_url, r.default_branch, r.local_path from repos r
      where r.id = ? and r.workspace_id = ?
        and (? is null or exists (select 1 from project_repos pr where pr.repo_id = r.id and pr.project_id = ?))`,
    [meta.repoId, workspaceId, meta.projectId ?? null, meta.projectId ?? null],
  ).catch(() => null);
  // a late replica, or another project's repository: no grant and no pick adds the row, so no GitHub card
  if (!repo) throw new Error(`${meta.repoName} is not in this project on this machine.`);
  const earlier = earlierWorktree(meta);
  if (earlier) return earlier;
  const local = opts.preferLocal && repo.local_path && existsSync(repo.local_path) ? repo.local_path : null;
  const target = local ? null : await cloneTarget(db, workspaceId, meta, repo, !!opts.credFor);
  const clone = target?.id ?? meta.repoId;
  const cloneDir = local ?? engineeringRepoRoot(clone);
  const worktreeDir = cachePath('worktrees', engineeringWorktreeName(meta.actorId, clone, meta.threadId));
  const workspace: EngineeringWorkspace = { cwd: worktreeDir, repoRoot: engineeringRepoRoot(clone) };
  if (existsSync(worktreeDir)) return workspace;
  mkdirSync(cachePath('repos'), { recursive: true });
  mkdirSync(cachePath('worktrees'), { recursive: true });
  // the App's token for the room's connected repository, when the machine has no login of its own
  const channel = target?.slug && opts.credFor ? (await db.get<{ channel_id: string }>(`select channel_id from threads where id = ?`, [meta.threadId]).catch(() => null))?.channel_id ?? null : null;
  const cred = target?.slug && channel && opts.credFor ? await opts.credFor(target.slug, channel).catch(() => null) : null;
  const env: GhEnv | undefined = cred?.ok ? cred.env : undefined;
  const refused = (e: unknown): never => { throw cloneRefusal(e, meta.repoName, !!opts.credFor, cred); };
  await withRepoLock(clone, async () => {
    if (local) { await git(['fetch', '--all', '--prune'], cloneDir).catch(() => undefined); } // a local checkout may have no remote at all
    // a public repository clones and fetches with no grant. A private one needs it, and the refusal names its cause.
    else if (!existsSync(cloneDir)) await git(['clone', target!.url, cloneDir], undefined, env).catch(refused);
    else await git(['fetch', 'origin', '--prune'], cloneDir, env).catch(refused);
    if (existsSync(worktreeDir)) return;
    await git(['worktree', 'prune'], cloneDir);
    const base = (local ? meta.branch || repo.default_branch : target!.base) || 'main';
    await git(['check-ref-format', '--branch', base], cloneDir);
    const branch = engineeringBranchName(meta.actorId, meta.threadId);
    // Never reset an existing Engineering branch. A missing directory can follow a machine
    // restart or an operator cleanup while the branch still contains committed work; `-B`
    // would silently throw that work away by moving the branch back to origin/base.
    const branchExists = await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], cloneDir).then(() => true).catch(() => false);
    if (branchExists) { await git(['worktree', 'add', worktreeDir, branch], cloneDir); return; }
    // a local checkout's base is its own branch when it has one; a cache clone's is always origin's
    const localBase = local ? await git(['show-ref', '--verify', '--quiet', `refs/heads/${base}`], cloneDir).then(() => true).catch(() => false) : false;
    await git(['worktree', 'add', '-b', branch, worktreeDir, localBase ? base : `origin/${base}`], cloneDir);
  });
  return workspace;
}
