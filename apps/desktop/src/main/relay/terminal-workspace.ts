import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { ChannelFrame } from '@neuramesh/relay';
import type { ReplicaDatabase } from '@neuramesh/client-core/replica';
import { ensureChatWorkspace } from '../harness/chat-workspace';
import { brainRoot, cachePath, deliverablePath } from '../harness/brain';
import { withRepoLock } from '../agents';
import { ghPrState, repoSlug } from '../host/gh';
import type { RepoCred } from '../host/repocred';
import { openTaskCheckout } from '../host/task-checkout';
import type { WorkspaceMeta, EngineeringWorkspace } from './engineering-workspace';
import { retainedEngineeringWorktree } from './engineering-workspace';

export type TerminalLocation = { cwd: string; taskNumber?: number };

function taskTerminalDirectory(number: number, hasRepo: boolean): string {
  const directory = hasRepo ? cachePath('worktrees', `nm-${number}`) : deliverablePath(number);
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
    throw new Error(`Task #${number}’s ${hasRepo ? 'worktree' : 'deliverables directory'} is unavailable on this machine. Reopen Terminal after the task starts or reconnect its original machine.`);
  }
  return directory;
}

interface TaskTerminalRow {
  kind: string | null; number: number | null; repo_id: string | null; branch: string | null;
  state: string | null; submitted_sha: string | null; channel_id: string; pr_number: number | null;
  base_ref: string | null; default_branch: string | null; clone_url: string | null; local_path: string | null; archived_at: string | null;
}
interface TerminalRecovery {
  repoCred?: RepoCred;
  preferLocal?: boolean;
  workspace?(meta: WorkspaceMeta): Promise<EngineeringWorkspace>;
}

const taskFields = 'k.number,k.repo_id,k.branch,k.state,k.submitted_sha,k.pr_number,k.base_ref,r.default_branch,r.clone_url,r.local_path';
async function openTerminalTask(thread: TaskTerminalRow, number: number, recovery?: TerminalRecovery): Promise<TerminalLocation> {
  const dir = cachePath('worktrees', `nm-${number}`);
  if (!existsSync(dir) && thread.repo_id && (thread.pr_number || !['accepted','closed'].includes(thread.state ?? ''))) {
    const slug = thread.clone_url && repoSlug(thread.clone_url);
    const cred = recovery?.repoCred && slug ? await recovery.repoCred.forRepo(slug,thread.channel_id) : undefined;
    if (['accepted','closed'].includes(thread.state ?? '') && thread.pr_number && slug && cred?.ok) {
      const pr = await ghPrState(slug,thread.pr_number,cred.env);
      if (pr === 'closed' || pr === 'merged') throw new Error(`Task #${number} is settled and its pull request is ${pr}. Open the PR to inspect the submitted files.`);
    }
    // A cached checkout needs no network. A missing private clone requires the room's own grant.
    const local = recovery?.preferLocal && thread.local_path && existsSync(thread.local_path) ? thread.local_path : null;
    const url = local || (cred?.ok === false ? null : thread.clone_url);
    try {
      await withRepoLock(thread.repo_id, () => openTaskCheckout({
        number,repoId:thread.repo_id!,branch:thread.branch ?? `nm/${number}`,
        base:thread.base_ref || thread.default_branch || 'main',url,submitted:thread.submitted_sha,
      },cred?.ok ? cred.env : {},false));
    } catch (error) {
      // Git errors may include a clone URL; don't echo credential-bearing diagnostics into a terminal.
      throw new Error(cred?.ok === false ? cred.error : `Could not restore the checkout for task #${number}. Check repository access and that its task branch or base ref still exists, then reopen Terminal.`, {cause:error});
    }
  }
  if (!thread.repo_id && !thread.branch && !['accepted','closed'].includes(thread.state ?? '')) mkdirSync(deliverablePath(number),{recursive:true});
  return { cwd: taskTerminalDirectory(number, !!(thread.repo_id || thread.branch)), taskNumber: number };
}

export async function numberedTaskTerminalDirectory(db: Pick<ReplicaDatabase,'getAll'>, workspace:string, number:number, recovery?:TerminalRecovery): Promise<TerminalLocation> {
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Invalid task terminal.');
  const [task] = await db.getAll<TaskTerminalRow>(`select ${taskFields},k.channel_id from tasks k left join repos r on r.id=k.repo_id and r.workspace_id=k.workspace_id where k.number=? and k.workspace_id=?`,[number,workspace]);
  if (!task) throw new Error(`Task #${number} is unavailable in this workspace.`);
  return openTerminalTask(task,number,recovery);
}

export async function threadTerminalDirectory(db: Pick<ReplicaDatabase, 'getAll'>, workspace: string, threadId: string, actorId: string, recovery?: TerminalRecovery): Promise<TerminalLocation> {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(threadId)) throw new Error('Invalid terminal thread.');
  const [thread] = await db.getAll<TaskTerminalRow>(
    `select t.kind,t.archived_at,t.channel_id,${taskFields} from threads t left join tasks k on k.id=t.task_id and k.workspace_id=t.workspace_id
      left join repos r on r.id=k.repo_id and r.workspace_id=t.workspace_id where t.id=? and t.workspace_id=?`, [threadId, workspace]);
  if (thread?.number != null) return openTerminalTask(thread,thread.number,recovery);
  if (thread && thread.kind !== 'coding') {
    const dir = ensureChatWorkspace(threadId);
    if (!realpathSync(dir).startsWith(join(realpathSync(brainRoot()), 'subjects') + '/')) throw new Error('This conversation directory is unavailable.');
    return { cwd: dir };
  }
  // Legacy Code sessions can predate the conversation row. A workspace record and the
  // authenticated actor's retained checkout are both required to open a coding terminal.
  const [session] = await db.getAll<{id:string;repo_id:string|null;repo_name:string|null;branch:string|null;project_id:string|null}>('select id,repo_id,repo_name,branch,project_id from code_sessions where workspace_id=? and (thread_id=? or id=?) and created_by=?', [workspace, threadId, threadId, actorId]);
  let cwd = session && retainedEngineeringWorktree(actorId, threadId);
  if (!cwd && recovery?.workspace && session?.repo_id && !thread?.archived_at) {
    cwd = (await recovery.workspace({actorId,threadId,repoId:session.repo_id,repoName:session.repo_name ?? '',branch:session.branch ?? '',projectId:session.project_id ?? undefined})).cwd;
  }
  if (!cwd) throw new Error('This coding worktree is unavailable. Start the coding session or reconnect the machine that holds its checkout, then reopen Terminal.');
  return { cwd };
}

export async function terminalDirectory(frame: ChannelFrame, resolveThread?: (threadId: string, actorId: string) => Promise<TerminalLocation>, resolveTask?: (number:number) => Promise<TerminalLocation>): Promise<TerminalLocation> {
  if (frame.meta && 'threadId' in frame.meta) {
    if (typeof frame.meta.threadId !== 'string' || !frame.actorId || !resolveThread) throw new Error('Reconnect the machine that runs this thread, then reopen Terminal.');
    return resolveThread(frame.meta.threadId, frame.actorId);
  }
  if (typeof frame.taskNumber === 'number' && resolveTask) return resolveTask(frame.taskNumber);
  if (typeof frame.taskNumber === 'number') return { cwd: taskTerminalDirectory(frame.taskNumber, !!frame.hasRepo), taskNumber: frame.taskNumber };
  if (frame.cwd) {
    if (!existsSync(frame.cwd)) throw new Error('The selected directory is unavailable. Reconnect its original machine, then reopen Terminal.');
    return { cwd: frame.cwd };
  }
  const root = brainRoot();
  mkdirSync(root, { recursive: true });
  return { cwd: root };
}
