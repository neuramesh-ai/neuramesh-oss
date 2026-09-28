// The Worktrees destination's payload (docs/design/worktrees-2026-09 §4): this machine's task
// berths (the footprint's own scan, classed by the board) and the coding threads' retained
// worktrees (the engineering directories, joined with the replica's threads and code_sessions),
// each with its size, its last touch, and whether something stands in it right now.
//
// footprint.ts's pattern: no db in here. The IPC handler (sync/ipc/worktrees.ts) queries the
// replica and hands rows in, so this module runs under `tsx --test` against a temp brain root.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { classifyBerth, type BerthClass, type BerthEntry } from './harness/berths';
import { ENGINEERING_WORKTREE_PREFIX, classifyThreadWorktree, settledBerths, threadForWorktreeName, type ThreadWorktreeClass } from './harness/worktree-rows';
import { gitChildEnv, worktreeCloneDir } from './harness/workspaces';
import { duBytes, type FootprintFleet } from './footprint';

export type WorktreeTaskRow = {
  taskNumber: number; taskId: string | null; title: string | null; state: string | null; cls: BerthClass;
  bytes: number; mtimeMs: number; repoId: string | null; repoName: string | null; branch: string | null;
  /** a run or a review shell stands in the directory right now */
  held: boolean;
};
export type WorktreeThreadRow = {
  /** the directory's leaf under cache/worktrees, the row's key and the remove command's address */
  name: string; threadId: string | null; channelId: string | null; title: string | null; cls: ThreadWorktreeClass;
  bytes: number; mtimeMs: number; repoName: string | null; branch: string | null;
  /** files changed in the worktree and not committed: they go with it */
  dirty: number;
  /** the coding runtime holds a session open on this thread */
  held: boolean;
};
export type WorktreesPayload = {
  at: string;
  machine: string;
  tasks: WorktreeTaskRow[];
  threads: WorktreeThreadRow[];
  /** third-party agent worktree dirs, reported and never touched (the footprint's fleet well) */
  fleet: FootprintFleet[];
  /** the fleet is measured in the background (a cold `du` of a 70 GB dir takes seconds); the
   *  table never waits for it, and a reader asks again while this is set */
  fleetPending?: boolean;
  /** the bulk button: the sweeper's remove verdict over the task rows */
  settled: { count: number; bytes: number };
};

export type WorktreesDbRows = {
  tasks: Array<{ id: string; number: number; title: string | null; state: string; repo_id: string | null; branch: string | null }>;
  repos: Array<{ id: string; name: string | null }>;
  threads: Array<{ id: string; title: string | null; channel_id: string | null }>;
  sessions: Array<{ thread_id: string | null; state: string | null; repo_name: string | null }>;
};
export type WorktreeHolds = {
  taskHeld: (taskNumber: number, taskId: string | null) => boolean;
  threadHeld: (threadId: string | null) => boolean;
};

const run = promisify(execFile);
const gitIn = async (cwd: string, ...args: string[]): Promise<string | null> => {
  try { return (await run('git', args, { cwd, env: gitChildEnv() })).stdout.trim(); } catch { return null; }
};
const mtime = (path: string): number => { try { return statSync(path).mtimeMs; } catch { return 0; } };

export async function assembleWorktrees(brainRootDir: string, machine: string, rows: WorktreesDbRows, holds: WorktreeHolds): Promise<Omit<WorktreesPayload, 'fleet'>> {
  const wtRoot = join(brainRootDir, 'cache', 'worktrees');
  const names = existsSync(wtRoot) ? readdirSync(wtRoot) : [];
  const taskByNumber = new Map(rows.tasks.map((t) => [t.number, t]));
  const repoName = new Map(rows.repos.map((r) => [r.id, r.name]));
  const threadById = new Map(rows.threads.map((t) => [t.id, t]));
  const sessionByThread = new Map(rows.sessions.filter((s) => s.thread_id).map((s) => [s.thread_id!, s]));

  const tasks: WorktreeTaskRow[] = [];
  for (const name of names) {
    const m = /^nm-(\d+)$/.exec(name);
    if (!m) continue;
    const num = Number(m[1]);
    const t = taskByNumber.get(num) ?? null;
    tasks.push({
      taskNumber: num, taskId: t?.id ?? null, title: t?.title ?? null, state: t?.state ?? null, cls: classifyBerth(t?.state ?? null),
      bytes: await duBytes(join(wtRoot, name)), mtimeMs: mtime(join(wtRoot, name)),
      repoId: t?.repo_id ?? null, repoName: t?.repo_id ? repoName.get(t.repo_id) ?? null : null, branch: t?.branch ?? null,
      held: holds.taskHeld(num, t?.id ?? null),
    });
  }

  const threads: WorktreeThreadRow[] = [];
  for (const name of names) {
    if (!name.startsWith(ENGINEERING_WORKTREE_PREFIX)) continue;
    const dir = join(wtRoot, name);
    const threadId = threadForWorktreeName(name, threadById.keys());
    const thread = threadId ? threadById.get(threadId) ?? null : null;
    const session = threadId ? sessionByThread.get(threadId) ?? null : null;
    const branch = await gitIn(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
    const status = await gitIn(dir, 'status', '--porcelain');
    // the repository: the session's word, else the clone the worktree was cut from (a cache
    // clone is named by its repo id, the member's own checkout by its folder)
    const clone = worktreeCloneDir(dir);
    const cloneRepo = clone ? repoName.get(basename(clone)) ?? (clone.startsWith(join(brainRootDir, 'cache', 'repos')) ? null : basename(clone)) : null;
    threads.push({
      name, threadId, channelId: thread?.channel_id ?? null, title: thread?.title ?? null,
      cls: classifyThreadWorktree(session, !!thread),
      bytes: await duBytes(dir), mtimeMs: mtime(dir),
      repoName: session?.repo_name ?? cloneRepo, branch: branch || null,
      dirty: status ? status.split('\n').filter(Boolean).length : 0,
      held: holds.threadHeld(threadId),
    });
  }

  const berths: BerthEntry[] = tasks.map((t) => ({ taskNumber: t.taskNumber, boardState: t.state, mtimeMs: t.mtimeMs, bytes: t.bytes, repoId: t.repoId, branch: t.branch }));
  const settled = settledBerths(berths);
  const byTouch = <T extends { mtimeMs: number }>(a: T, b: T): number => b.mtimeMs - a.mtimeMs;
  return {
    at: new Date().toISOString(), machine,
    tasks: tasks.sort(byTouch), threads: threads.sort(byTouch),
    settled: { count: settled.taskNumbers.length, bytes: settled.bytes },
  };
}
