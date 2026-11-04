// Both Terminal and the executor open the same task branch under the same repository lock.
// Never reset a local branch: it may contain work that the agent has not pushed yet.
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { cachePath } from '../harness/brain';
import type { ReplicaDatabase } from '@neuramesh/client-core/replica';
import type { RepoCred } from './repocred';
import { git, ghPrState, repoSlugFor, type GhEnv } from './gh';

export interface TaskCheckout {
  number: number; repoId: string; branch: string; base: string; url: string | null;
  submitted?: string | null;
}

/** Caller holds the repo lock. A submitted SHA is an identity check, not a substitute for missing work. */
export async function openTaskCheckout(t: TaskCheckout, env: GhEnv, refresh: boolean) {
  if (!/^[\w-]+$/.test(t.repoId) || !Number.isSafeInteger(t.number) || t.number <= 0) throw new Error('Invalid task checkout.');
  const clone = cachePath('repos', t.repoId), dir = cachePath('worktrees', `nm-${t.number}`);
  if (await git(['check-ref-format','--branch',t.branch]) !== t.branch) throw new Error('Invalid task branch.');
  if (!existsSync(clone)) {
    if (!t.url) throw new Error('Reconnect the repository to this workspace to restore the task checkout.');
    mkdirSync(cachePath('repos'),{recursive:true});
    await git(['clone','--',t.url,clone],undefined,env);
  } else if (!lstatSync(clone).isDirectory()) throw new Error('The cached task repository is unavailable.');
  const ref = async (name:string) => git(['rev-parse','--verify','--quiet',name],clone).catch(()=>'');
  const contains = async (ref: string, commit: string) => !!ref &&
    await git(['merge-base', '--is-ancestor', commit, ref], clone).then(() => true, () => false);
  let remote = await ref(`refs/remotes/origin/${t.branch}`);
  let local = await ref(`refs/heads/${t.branch}`);
  const missing = !existsSync(dir);
  if (missing && t.submitted && !/^[a-f0-9]{40}$/.test(t.submitted)) throw new Error('Invalid submitted commit.');
  const needsRef = missing && ((!local && !remote) ||
    (t.submitted && !await contains(local,t.submitted) && !await contains(remote,t.submitted)));
  if (refresh || (needsRef && t.url)) {
    await git(['fetch','origin','--prune'],clone,env);
    remote = await ref(`refs/remotes/origin/${t.branch}`);
    local = await ref(`refs/heads/${t.branch}`);
  }
  if (existsSync(dir)) {
    if (!lstatSync(dir).isDirectory() || realpathSync(await git(['rev-parse','--path-format=absolute','--git-common-dir'],dir)) !== realpathSync(join(clone,'.git')) ||
        await git(['branch','--show-current'],dir) !== t.branch) throw new Error('The checkout belongs to a different branch or repository. Inspect it before retrying.');
  } else {
    mkdirSync(cachePath('worktrees'),{recursive:true});
    let advanceLocal = false;
    if (t.submitted && !await contains(local || remote,t.submitted)) {
      // A different machine may have pushed the submission. Fast-forward only when every
      // local commit is already on that remote branch. A divergent local branch is preserved.
      if (!local || !remote || !await contains(remote,t.submitted) || !await contains(remote,local)) {
        throw new Error('The task branch is missing or diverged from its submitted commit. Inspect the pull request before retrying.');
      }
      advanceLocal = true;
    }
    // If only the directory vanished, Git still remembers it. Remove just this
    // missing, unlocked registration; other worktrees and their refs are untouched.
    const physicalDir = join(realpathSync(cachePath('worktrees')), `nm-${t.number}`);
    const paths = await git(['worktree','list','--porcelain','-z'],clone);
    const entry = paths.split('\0\0').find(record => record.split('\0')[0] === 'worktree '+physicalDir);
    if (entry && !existsSync(dir)) {
      if (entry.split('\0').some(field=>/^locked(?: |$)/.test(field))) throw new Error('The missing task checkout is locked. Inspect its worktree registration before retrying.');
      await git(['worktree','remove','--force','--',dir],clone);
    }
    if (advanceLocal) await git(['branch','--force','--',t.branch,remote],clone);
    if (local) await git(['worktree','add','--',dir,t.branch],clone);
    else await git(['worktree','add','-b',t.branch,'--',dir,remote || `origin/${t.base}`],clone);
  }
  return {dir, clone, remote};
}

/** An accepted task may still have an unmerged PR. Unknown remote state must not evict its checkout. */
export async function taskPullRequestState(db: Pick<ReplicaDatabase,'get'>, cred: RepoCred, taskNumber: number) {
  const row = await db.get<{channel_id:string;pr_number:number|null;clone_url:string|null;local_path:string|null;org_name:string|null;name:string|null}>(
    'select t.channel_id,t.pr_number,r.clone_url,r.local_path,r.org_name,r.name from tasks t left join repos r on r.id=t.repo_id where t.number=?',[taskNumber]);
  if (!row?.pr_number) return 'none' as const;
  const slug = await repoSlugFor(row);
  if (!slug) return 'unknown' as const;
  const access = await cred.forRepo(slug,row.channel_id);
  return access.ok ? ghPrState(slug,row.pr_number,access.env) : 'unknown' as const;
}
