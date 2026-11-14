import { hydratePath, hydrationPending } from '../harness/hydration';
import { engineeringRepoRoot, hydrateEngineeringThread, repositoryCloneTarget } from './engineering-workspace';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { ChannelFrame } from '@neuramesh/relay';
import type { ReplicaDatabase } from '@neuramesh/client-core/replica';
import { prepareChatWorkspace as ensureChatWorkspace } from '../harness/chat-workspace';
import { brainRoot, cachePath, deliverablePath } from '../harness/brain';
import { retainedEngineeringWorktree } from './engineering-workspace';

export type TerminalLocation = { cwd: string; taskNumber?: number; note?: string };

/** Resolve the repository on THIS machine. A folder attached on a Mac is identity metadata,
 * never a usable cloud cwd. Reuse the Code lane's project/GitHub twin selection, then hydrate
 * its retained clone without fetching, switching branches or replacing uncommitted files. */
export async function repoTerminalDirectory(db: Pick<ReplicaDatabase, 'get'>, workspace: string, repoId: string, projectId: string, preferLocal = false): Promise<TerminalLocation> {
  if (![repoId, projectId].every(id => /^[a-zA-Z0-9_-]{1,120}$/.test(id))) throw new Error('Invalid terminal repository.');
  const repo = await db.get<{ name: string; clone_url: string | null; default_branch: string | null; local_path: string | null }>(
    `select r.name,r.clone_url,r.default_branch,r.local_path from repos r join project_repos pr on pr.repo_id=r.id
      join projects p on p.id=pr.project_id and p.workspace_id=r.workspace_id
      where r.id=? and r.workspace_id=? and pr.project_id=?`, [repoId, workspace, projectId]);
  if (!repo) throw new Error('This repository is not attached to this project on this machine.');
  if (preferLocal && repo.local_path && existsSync(repo.local_path) && lstatSync(repo.local_path).isDirectory()) return { cwd: repo.local_path };
  const target = await repositoryCloneTarget(db, workspace, { repoId, repoName: repo.name, projectId }, repo, true);
  const cwd = engineeringRepoRoot(target.id);
  await hydratePath(cwd);
  const repos = cachePath('repos');
  if (!existsSync(join(cwd, '.git')) || !lstatSync(cwd).isDirectory() || !realpathSync(cwd).startsWith(realpathSync(repos) + '/')) {
    throw new Error(`${repo.name}'s cloud checkout is unavailable on this machine. Open its coding session to prepare the repository, then reopen Terminal.`);
  }
  return { cwd };
}

async function taskTerminalDirectory(number: number, hasRepo: boolean): Promise<string> {
  const directory = hasRepo ? cachePath('worktrees', `nm-${number}`) : deliverablePath(number);
  await hydratePath(directory);
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
    throw new Error(`Task #${number}’s ${hasRepo ? 'worktree' : 'deliverables directory'} is unavailable on this machine. Reopen Terminal after the task starts or reconnect its original machine.`);
  }
  return directory;
}

export async function threadTerminalDirectory(db: Pick<ReplicaDatabase, 'getAll'>, workspace: string, threadId: string, actorId: string): Promise<TerminalLocation> {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(threadId)) throw new Error('Invalid terminal thread.');
  const [thread] = await db.getAll<{kind:string|null; number:number|null; repo_id:string|null; branch:string|null}>(
    'select t.kind,k.number,k.repo_id,k.branch from threads t left join tasks k on k.id=t.task_id and k.workspace_id=t.workspace_id where t.id=? and t.workspace_id=?', [threadId, workspace]);
  if (thread?.number != null) return { cwd: await taskTerminalDirectory(thread.number, !!(thread.repo_id || thread.branch)), taskNumber: thread.number };
  if (thread && thread.kind !== 'coding') {
    const dir = await ensureChatWorkspace(threadId);
    if (!realpathSync(dir).startsWith(join(realpathSync(brainRoot()), 'subjects') + '/')) throw new Error('This conversation directory is unavailable.');
    return { cwd: dir };
  }
  // Legacy Code sessions can predate the conversation row. A workspace record and the
  // authenticated actor's retained checkout are both required to open a coding terminal.
  const [session] = await db.getAll<{id:string}>('select id from code_sessions where workspace_id=? and (thread_id=? or id=?) and created_by=?', [workspace, threadId, threadId, actorId]);
  if (session) await hydrateEngineeringThread(actorId, threadId);
  const cwd = session && retainedEngineeringWorktree(actorId, threadId);
  if (!cwd) throw new Error('This coding worktree is unavailable. Start the coding session or reconnect the machine that holds its checkout, then reopen Terminal.');
  return { cwd };
}

export async function terminalDirectory(frame: ChannelFrame, resolveThread?: (threadId: string, actorId: string) => Promise<TerminalLocation>, resolveRepo?: (repoId: string, projectId: string) => Promise<TerminalLocation>): Promise<TerminalLocation> {
  if (frame.meta && 'threadId' in frame.meta) {
    if (typeof frame.meta.threadId !== 'string' || !frame.actorId || !resolveThread) throw new Error('Reconnect the machine that runs this thread, then reopen Terminal.');
    return resolveThread(frame.meta.threadId, frame.actorId);
  }
  if (typeof frame.taskNumber === 'number') return { cwd: await taskTerminalDirectory(frame.taskNumber, !!frame.hasRepo), taskNumber: frame.taskNumber };
  if (frame.meta && ('repoId' in frame.meta || 'projectId' in frame.meta)) {
    if (!frame.actorId || typeof frame.meta.repoId !== 'string' || typeof frame.meta.projectId !== 'string' || !resolveRepo) throw new Error('Reconnect this project’s cloud machine, then reopen Terminal.');
    return resolveRepo(frame.meta.repoId, frame.meta.projectId);
  }
  if (frame.cwd) {
    await hydratePath(frame.cwd);
    if (!existsSync(frame.cwd)) throw new Error('The selected directory is unavailable. Reconnect its original machine, then reopen Terminal.');
    return { cwd: frame.cwd };
  }
  const root = brainRoot();
  mkdirSync(root, { recursive: true });
  return { cwd: root, ...(hydrationPending(root) ? { note: 'Your machine is ready. Other saved workspaces are loading in the background. Opening a thread restores its files before its terminal opens.' } : {}) };
}
