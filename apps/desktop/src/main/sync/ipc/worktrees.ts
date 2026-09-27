// THE WORKTREES DESTINATION's IPC (docs/design/worktrees-2026-09 §4): the table of this machine's
// worktrees, and the one act a person takes on a row. Machine-scoped over IPC like the footprint,
// never synced. Registered from startSync beside the terminals, because the holds it checks (the
// review shells, the runs, the local Code sessions) live there.
import { ipcMain } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PowerSyncDatabase } from '@powersync/node';
import { executing, withRepoLock } from '../../agents';
import { appendFootprintHistory, assembleFootprint, fleetLocations, scanFleet, type FootprintDbRows } from '../../footprint';
import { brainRoot, cachePath, deliverablePath } from '../../harness/brain';
import { removalVerdict } from '../../harness/worktree-rows';
import { removeEngineeringWorktree, removeTaskWorkspace } from '../../harness/workspaces';
import { thisMachineName } from '../../sync';
import { assembleWorktrees, type WorktreeTaskRow, type WorktreesDbRows, type WorktreesPayload } from '../../worktrees';
import { localCodeSessionOpen } from './engineering-local';
import { invalidateFootprintCache } from './settings';
import type { PtyTerm } from './terminals';

export type WorktreeRemoveInput =
  | { kind: 'task'; taskNumber: number; force?: boolean }
  | { kind: 'thread'; name: string; force?: boolean }
  /** the bulk button: every task row in the sweeper's settled set */
  | { kind: 'settled' };
export type WorktreeRemoveReply =
  | { ok: true; freedBytes: number; notes: string[]; payload: WorktreesPayload }
  | { ok: false; code: 'WORKTREE_BUSY' | 'NOT_FOUND'; payload: WorktreesPayload };

export interface WorktreesDeps {
  db: () => PowerSyncDatabase;
  /** the review shells, by subId (created by startSync) */
  ptys: Map<string, PtyTerm>;
  killTaskPtys: (taskNumber: number) => void;
}

export function registerWorktrees({ db, ptys, killTaskPtys }: WorktreesDeps): void {
  const dbRows = async (): Promise<WorktreesDbRows> => ({
    tasks: await db().getAll<WorktreesDbRows['tasks'][number]>('select id, number, title, state, repo_id, branch from tasks').catch(() => []),
    repos: await db().getAll<WorktreesDbRows['repos'][number]>('select id, name from repos').catch(() => []),
    threads: await db().getAll<WorktreesDbRows['threads'][number]>(`select id, title, channel_id from threads where kind = 'coding'`).catch(() => []),
    sessions: await db().getAll<WorktreesDbRows['sessions'][number]>('select thread_id, state, repo_name from code_sessions where thread_id is not null').catch(() => []),
  });
  const holds = {
    // a run in flight on this host, or a review shell standing in the directory
    taskHeld: (taskNumber: number, taskId: string | null): boolean =>
      (!!taskId && executing.has(taskId)) || [...ptys.values()].some((p) => p.taskNumber === taskNumber),
    threadHeld: (threadId: string | null): boolean => !!threadId && localCodeSessionOpen(threadId),
  };
  // the third-party dirs are slow to measure (a cold `du` of this Mac's .claude/worktrees took
  // 14 s live) and never change under this page: they warm in the background, 15 min like the
  // footprint, and the table answers at once with what it has
  let fleetCache: { at: number; fleet: WorktreesPayload['fleet'] } | null = null;
  let fleetInflight: Promise<void> | null = null;
  const warmFleet = (): Promise<void> => {
    fleetInflight ??= (async () => {
      const repos = await db().getAll<{ id: string; name: string | null; local_path: string | null }>('select id, name, local_path from repos').catch(() => []);
      fleetCache = { at: Date.now(), fleet: await scanFleet(fleetLocations(homedir(), repos)).catch(() => []) };
      fleetInflight = null;
    })();
    return fleetInflight;
  };
  const build = async (): Promise<WorktreesPayload> => {
    const rows = await dbRows();
    const table = await assembleWorktrees(brainRoot(), thisMachineName(), rows, holds);
    const stale = !fleetCache || Date.now() - fleetCache.at > 15 * 60_000;
    if (stale) void warmFleet().catch(() => {});
    return { ...table, fleet: fleetCache?.fleet ?? [], ...(stale && !fleetCache ? { fleetPending: true } : {}) };
  };

  const removeTask = async (row: WorktreeTaskRow): Promise<string[]> => {
    killTaskPtys(row.taskNumber); // a shell in a directory about to vanish
    const remove = () => removeTaskWorkspace({
      wtDir: cachePath('worktrees', `nm-${row.taskNumber}`),
      // the sweep's rule: a settled task's scratch goes with it, a live one's stays
      deliverableDir: row.cls === 'dead' || row.cls === 'orphan' ? deliverablePath(row.taskNumber) : null,
      cloneDir: row.repoId ? cachePath('repos', row.repoId) : null,
      branch: row.branch ?? `nm/${row.taskNumber}`,
    });
    // clone-dir git ops share the creation path's per-repo lock (git locks are not reentrant)
    return (row.repoId ? withRepoLock(row.repoId, remove) : remove()).catch(() => [] as string[]);
  };

  // one more sample on the footprint's chart, measured the footprint's own way
  const recordRemoval = async (freedBytes: number, actions: number): Promise<void> => {
    const fp: FootprintDbRows = {
      tasks: await db().getAll<FootprintDbRows['tasks'][number]>('select number, title, state, repo_id, branch from tasks').catch(() => []),
      repos: await db().getAll<FootprintDbRows['repos'][number]>('select id, name, local_path from repos').catch(() => []),
      openByRepo: await db().getAll<FootprintDbRows['openByRepo'][number]>(
        `select repo_id, count(*) as n from tasks where repo_id is not null and state not in ('accepted','closed') group by repo_id`).catch(() => []),
    };
    const p = await assembleFootprint(brainRoot(), fp);
    await appendFootprintHistory(brainRoot(), {
      at: p.at,
      berths: { leased: p.nm.berths.filter((b) => b.cls === 'leased').length, warm: p.nm.berths.filter((b) => b.cls === 'warm').length, bytes: p.nm.berths.reduce((n, b) => n + b.bytes, 0) },
      donorsBytes: p.nm.donors.reduce((n, d) => n + d.bytes, 0),
      clonesBytes: p.nm.clones.reduce((n, c) => n + c.bytes, 0),
      actions, reclaimedBytes: freedBytes,
    });
    invalidateFootprintCache();
  };

  for (const name of ['nm:worktrees-get', 'nm:worktree-remove']) ipcMain.removeHandler(name);
  ipcMain.handle('nm:worktrees-get', async () => ({ ready: true as const, payload: await build() }));
  ipcMain.handle('nm:worktree-remove', async (_e, input: WorktreeRemoveInput): Promise<WorktreeRemoveReply> => {
    const before = await build();
    const notes: string[] = [];
    let freedBytes = 0;
    let actions = 0;
    if (input.kind === 'settled') {
      // the sweeper's own set, row by row: a held row (rare: a shell open on a settled task) is skipped, never forced
      const set = before.tasks.filter((t) => (t.cls === 'dead' || t.cls === 'orphan') && !t.held);
      for (const row of set) { notes.push(...(await removeTask(row)).map((n) => `nm-${row.taskNumber}: ${n}`)); freedBytes += row.bytes; actions += 1; }
    } else if (input.kind === 'task') {
      const row = before.tasks.find((t) => t.taskNumber === input.taskNumber);
      if (!row) return { ok: false, code: 'NOT_FOUND', payload: before };
      const verdict = removalVerdict({ held: row.held, force: !!input.force });
      if (!verdict.ok) return { ok: false, code: verdict.code, payload: before };
      notes.push(...(await removeTask(row)));
      freedBytes = row.bytes; actions = 1;
    } else {
      const row = before.threads.find((t) => t.name === input.name);
      if (!row) return { ok: false, code: 'NOT_FOUND', payload: before };
      const verdict = removalVerdict({ held: row.held, force: !!input.force });
      if (!verdict.ok) return { ok: false, code: verdict.code, payload: before };
      notes.push(...(await removeEngineeringWorktree(join(cachePath('worktrees'), row.name))));
      freedBytes = row.bytes; actions = 1;
    }
    if (actions) console.log(`worktree_remove ${input.kind}: ${notes.join(', ') || 'directory'} (~${Math.round(freedBytes / 1e6)}MB apparent)`);
    const payload = await build();
    if (actions) await recordRemoval(freedBytes, actions).catch(() => {});
    return { ok: true, freedBytes, notes, payload };
  });
}
