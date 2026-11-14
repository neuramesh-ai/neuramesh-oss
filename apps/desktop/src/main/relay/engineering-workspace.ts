import { hydratePath, hydrateMatching } from '../harness/hydration';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { ReplicaDatabase } from '@neuramesh/client-core/replica';
import type { EngineeringMachineOpenMeta } from '../../engineering-protocol';
import { withRepoLock } from '../agents';
import { cachePath } from '../harness/brain';
import { worktreeCloneDir } from '../harness/workspaces';
import { depCache, type DepPhase } from '../cloudrun/depcache';
import { bundleKeyOf, git, repoSlug, type GhEnv } from '../host/gh';
import { ENGINEERING_WORKTREE_PREFIX, engineeringBranchName, engineeringWorktreeName, safeSegment as safe } from '../harness/worktree-rows';
import type { RepoCredResult } from '../host/repocred';
import { validatedEngineeringGitMounts } from './engineering-safe-executors';
import { ensureScratchWorkspace, pinRelativeGitdir, scratchThreadOf } from './engineering-scratch';

interface RepoRow { name: string | null; clone_url: string | null; default_branch: string | null; local_path: string | null }

export const engineeringRepoRoot = (repoId: string): string => cachePath('repos', safe(repoId));

/** where a thread works: its worktree, and the clone the shell checks the worktree's git pointer
 *  against, which is the cache clone the worktree came from (a twin's included). A desktop checkout
 *  passes null: commands can use the worktree, but receive no mounts of the person's own Git
 *  refs, objects or logs. Only a machine-owned cache clone may supply those mounts. */
export interface EngineeringWorkspace { cwd: string; repoRoot: string | null; privateRepoRoot?: string; taskBaseRef?: string }

/** a cloud session that cannot reach its code until GitHub is connected: the relay names it, and the
 *  thread's gate seat puts up the GitHub card instead of a raw error (docs/design/repo-connect-2026-10) */
export class EngineeringNeedsGitHub extends Error {
  readonly code = 'GITHUB_REQUIRED';
}

// the token route's refusals that a grant or a pick fixes. The GitHub card for any other refusal
// reopens the session into the same refusal, and the person never reads its cause.
const GRANT_FIXES = new Set(['NOT_CONNECTED', 'NO_REPO', 'RECONNECT_REQUIRED']);

type Db = Pick<ReplicaDatabase, 'get'>;
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
export async function repositoryCloneTarget(db: Db, workspaceId: string, meta: Pick<EngineeringMachineOpenMeta, 'repoId' | 'repoName'> & Partial<Pick<EngineeringMachineOpenMeta, 'projectId' | 'threadId' | 'branch'>>, repo: RepoRow, cloud: boolean): Promise<CloneTarget> {
  if (repo.clone_url) return targetOf(meta.repoId, repo.clone_url, meta.branch || repo.default_branch);
  const project = meta.projectId ?? (await db.get<{ project_id: string | null }>(`select c.project_id from threads t join channels c on c.id = t.channel_id where t.id = ?`, [meta.threadId]).catch(() => null))?.project_id ?? null;
  const handle = (await db.get<{ handle: string }>(
    `select k.handle from connectors k
      where k.project_id = ? and k.workspace_id = ? and k.provider = 'github' and k.status = 'connected' limit 1`,
    [project, workspaceId],
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

/** a fetched repository bundle file (cloudrun/repo-bundle.ts), and how to remove it after the clone */
export interface FetchedBundle { file: string; dispose(): void }

/** THE CACHE CLONE OF A REPOSITORY BUNDLE (control-api repo-bundles.ts): a row whose clone URL is
 *  `nm-bundle:<key>`. git cannot fetch that URL, so the machine fetches the bundle file and clones or
 *  fetches from the file, then names the URL as origin. The bundle's branches become origin's, so
 *  the worktree is cut from origin/<base> as for any other clone. A key never names two contents (a
 *  new upload is a new key), so a clone whose origin is already this URL is current and the
 *  download is skipped. */
async function syncBundleClone(cloneDir: string, url: string, key: string, name: string, fetchBundle: ((key: string) => Promise<FetchedBundle>) | undefined): Promise<void> {
  if (!fetchBundle) throw new Error(`${name} is an uploaded repository bundle, and this machine cannot fetch repository bundles.`);
  if (existsSync(cloneDir) && (await git(['remote', 'get-url', 'origin'], cloneDir).catch(() => '')) === url) return;
  let got: FetchedBundle;
  try { got = await fetchBundle(key); } catch (e) { throw new Error(`This cloud machine cannot fetch the repository bundle of ${name}: ${e instanceof Error ? e.message : String(e)}`); }
  try {
    if (!existsSync(cloneDir)) await git(['clone', got.file, cloneDir]);
    else await git(['fetch', '--prune', got.file, '+refs/heads/*:refs/remotes/origin/*'], cloneDir);
    await git(['remote', 'set-url', 'origin', url], cloneDir);
  } finally {
    got.dispose();
  }
}

export async function hydrateEngineeringThread(actorId: string, threadId: string): Promise<void> {
  const head = `${ENGINEERING_WORKTREE_PREFIX}${safe(actorId)}-`, tail = `-${safe(threadId)}`;
  await hydrateMatching(path => { const name = basename(path); return name.startsWith(head) && name.endsWith(tail); });
}

export function retainedEngineeringWorktree(actorId: string, threadId: string): string | null {
  const root = cachePath('worktrees');
  const head = `${ENGINEERING_WORKTREE_PREFIX}${safe(actorId)}-`, tail = `-${safe(threadId)}`;
  const name = existsSync(root) && readdirSync(root, { withFileTypes: true }).find(entry =>
    entry.isDirectory() && entry.name.length > head.length + tail.length && entry.name.startsWith(head) && entry.name.endsWith(tail))?.name;
  return name ? join(root, name) : null;
}

/** the worktree an earlier open cut for this thread, whichever clone it came from: a later pick can
 *  change the twin, and a reopen lands on its own files. Only a cache clone is the shell's check root.
 *  The directory name was created by the host, outside the command's writable subtree. Its clone
 *  segment selects the cache root; the editable .git pointer only confirms it. A local checkout
 *  comes from the host's repo row and is validated the same way, but never receives Git mounts. */
function earlierWorktree(meta: EngineeringMachineOpenMeta, local: string | null): EngineeringWorkspace | null {
  const cwd = retainedEngineeringWorktree(meta.actorId, meta.threadId);
  if (!cwd) return null;
  const name = basename(cwd);
  const head = `${ENGINEERING_WORKTREE_PREFIX}${safe(meta.actorId)}-`, tail = `-${safe(meta.threadId)}`;
  const cloneId = name.slice(head.length, -tail.length);
  const privateRepoRoot = local && cloneId === safe(meta.repoId) ? realpathSync(worktreeCloneDir(local) ?? local) : null;
  if (local && privateRepoRoot) {
    confirmCheckoutWorktree(cwd, local);
    return { cwd, repoRoot: null, privateRepoRoot };
  }
  const origin = engineeringRepoRoot(cloneId);
  if (!existsSync(`${origin}/.git`)) throw new Error('Code cannot identify the original repository for this worktree. Reconnect its checkout before continuing.');
  validatedEngineeringGitMounts(cwd, origin);
  return { cwd, repoRoot: origin };
}

/** where git keeps a checkout's shared metadata: its .git folder, the folder a .git file names (a
 *  submodule's modules entry, a separate git dir), or for a linked worktree, its repository's common
 *  folder (the gitdir's `commondir`), which is where a bare repository's worktrees point too */
export function gitCommonDir(checkout: string): string {
  const marker = join(checkout, '.git');
  if (lstatSync(marker).isDirectory()) return realpathSync(marker);
  const value = readFileSync(marker, 'utf8').trim();
  if (!value.startsWith('gitdir:')) throw new Error('Code found malformed repository metadata.');
  const gitDir = resolve(checkout, value.slice('gitdir:'.length).trim());
  const common = join(gitDir, 'commondir');
  return realpathSync(existsSync(common) ? resolve(gitDir, readFileSync(common, 'utf8').trim()) : gitDir);
}

/** a reopen of a person's checkout: the host chose the checkout from its repo row, and the thread
 *  worktree's editable .git pointer may only confirm its place in that checkout's metadata */
function confirmCheckoutWorktree(cwd: string, checkout: string): void {
  const expected = realpathSync(join(gitCommonDir(checkout), 'worktrees', basename(cwd)));
  const value = readFileSync(join(cwd, '.git'), 'utf8').trim();
  if (!value.startsWith('gitdir:')) throw new Error('Code found malformed worktree metadata.');
  const claimed = realpathSync(resolve(cwd, value.slice('gitdir:'.length).trim()));
  if (claimed !== expected) throw new Error('Code refused worktree metadata outside the selected repository.');
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
   *  (host/repocred.ts): a login-less machine clones a private repository through it. `bundle`
   *  fetches a repository bundle file through the machine's sign route (cloudrun/repo-bundle.ts):
   *  only a Cloud Run machine has one. */
  opts: { preferLocal?: boolean; credFor?: (slug: string, channelId: string) => Promise<RepoCredResult>; bundle?: (key: string) => Promise<FetchedBundle>; depPhase?: (phase: DepPhase) => void } = {},
): Promise<EngineeringWorkspace> {
  // round 9 (0177): a scratch thread has no repository. It gets a fresh local repository and a worktree
  // of it, in the same shape as below (engineering-scratch.ts). The thread row decides, not the client
  const scratch = await scratchThreadOf(db, workspaceId, meta);
  // Authorize the thread/repository before downloading any retained customer files.
  if (scratch) {
    await hydrateEngineeringThread(meta.actorId, meta.threadId);
    const earlier = earlierWorktree(meta, null);
    // a worktree an older machine cut keeps an absolute git pointer: it turns relative here, so git works in the box
    if (earlier) { pinRelativeGitdir(earlier.cwd); return earlier; }
    const made = await ensureScratchWorkspace(meta, scratch);
    validatedEngineeringGitMounts(made.cwd, made.repoRoot);
    if (made.created) await hydrateDependencies(made.cwd, meta.repoName, opts.depPhase);
    return { cwd: made.cwd, repoRoot: made.repoRoot };
  }
  const repo = await db.get<RepoRow>(
    `select r.name, r.clone_url, r.default_branch, r.local_path from repos r
      where r.id = ? and r.workspace_id = ?
        and (? is null or exists (select 1 from project_repos pr where pr.repo_id = r.id and pr.project_id = ?))`,
    [meta.repoId, workspaceId, meta.projectId ?? null, meta.projectId ?? null],
  ).catch(() => null);
  // a late replica, or another project's repository: no grant and no pick adds the row, so no GitHub card
  if (!repo) throw new Error(`${meta.repoName} is not in this project on this machine.`);
  await hydrateEngineeringThread(meta.actorId, meta.threadId);
  const task = await db.get<{number:number;repo_id:string;base_ref:string|null}>(`select k.number,k.repo_id,k.base_ref from threads t join tasks k on k.id=t.task_id where t.id=? and t.workspace_id=? and t.created_by=? and t.kind='coding'`,[meta.threadId,workspaceId,`human:${meta.actorId}`]).catch(()=>null);
  if (task && task.repo_id === meta.repoId) {
    const cwd = cachePath('worktrees',`nm-${task.number}`);
    const repoRoot = engineeringRepoRoot(meta.repoId);
    await hydratePath(cwd);
    await hydratePath(repoRoot);
    if (existsSync(cwd)) { validatedEngineeringGitMounts(cwd,repoRoot); return {cwd,repoRoot}; }
    // A planning/blocked task has no implementation branch yet. Its inactive
    // history pane may read the base; only the dispatcher creates the task worktree.
    meta = {...meta, branch:task.base_ref || repo.default_branch || 'main'};
  }
  const local = opts.preferLocal && repo.local_path && existsSync(repo.local_path) ? repo.local_path : null;
  const earlier = earlierWorktree(meta, local);
  if (earlier) return earlier;
  const target = local ? null : await repositoryCloneTarget(db, workspaceId, meta, repo, !!opts.credFor);
  const clone = target?.id ?? meta.repoId;
  const cloneDir = local ?? engineeringRepoRoot(clone);
  const worktreeDir = cachePath('worktrees', engineeringWorktreeName(meta.actorId, clone, meta.threadId));
  const workspace: EngineeringWorkspace = { cwd: worktreeDir, repoRoot: local ? null : engineeringRepoRoot(clone), ...(local ? { privateRepoRoot: realpathSync(worktreeCloneDir(local) ?? local) } : {}) };
  await hydratePath(cloneDir);
  await hydratePath(worktreeDir);
  if (existsSync(worktreeDir)) return workspace;
  mkdirSync(cachePath('repos'), { recursive: true });
  mkdirSync(cachePath('worktrees'), { recursive: true });
  // the App's token for the room's connected repository, when the machine has no login of its own
  const channel = target?.slug && opts.credFor ? (await db.get<{ channel_id: string }>(`select channel_id from threads where id = ?`, [meta.threadId]).catch(() => null))?.channel_id ?? null : null;
  const cred = target?.slug && channel && opts.credFor ? await opts.credFor(target.slug, channel).catch(() => null) : null;
  const env: GhEnv | undefined = cred?.ok ? cred.env : undefined;
  const refused = (e: unknown): never => { throw cloneRefusal(e, meta.repoName, !!opts.credFor, cred); };
  // a bundle never reaches GitHub, so its failures keep their own words and never put up the GitHub card
  const bundleKey = target ? bundleKeyOf(target.url) : null;
  let created = false;
  await withRepoLock(clone, async () => {
    if (local) { await git(['fetch', '--all', '--prune'], cloneDir).catch(() => undefined); } // a local checkout may have no remote at all
    else if (bundleKey) await syncBundleClone(cloneDir, target!.url, bundleKey, meta.repoName, opts.bundle);
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
    created = true;
    if (branchExists) { await git(['worktree', 'add', worktreeDir, branch], cloneDir); return; }
    // a local checkout's base is its own branch when it has one; a cache clone's is always origin's
    const localBase = local ? await git(['show-ref', '--verify', '--quiet', `refs/heads/${base}`], cloneDir).then(() => true).catch(() => false) : false;
    await git(['worktree', 'add', '-b', branch, worktreeDir, localBase ? base : `origin/${base}`], cloneDir);
  });
  // THE DEPENDENCY CACHE (cloudrun/depcache.ts, NM_DEPCACHE=1): a Code session's shell has no network,
  // so a restore when the worktree is cut is the only way its dependencies arrive. It runs outside the
  // repo lock, because a download must not hold up the other threads of the repository. A miss or a
  // failure leaves the worktree as it is, and never fails the open. On a miss the supervisor installs
  // the lockfile (D17, cloudrun/depinstall.ts), and the tab sees `installing_dependencies` meanwhile.
  if (created) await hydrateDependencies(worktreeDir, meta.repoName, opts.depPhase);
  return workspace;
}

async function hydrateDependencies(worktreeDir: string, name: string, phase?: (phase: DepPhase) => void): Promise<void> {
  const dc = depCache();
  if (dc) await dc.hydrate(worktreeDir, phase).catch((e: unknown) => console.warn(`[engineering] depcache restore failed for ${name}: ${e instanceof Error ? e.message : String(e)}`));
}
