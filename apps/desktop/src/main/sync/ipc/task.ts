// TASK + COMPUTE IPC — what a human can change about a task from the desktop, and where its
// agents are allowed to run.
//
// Nine handlers split out of startSync's registration wall: adding a subtask, ticking a ship
// item, editing the Definition of Done or a parked item's details, reading one task in full,
// and the three shared-compute controls.
//
// Compute rides along because it is the same question one level up — a task's work has to
// happen on SOME machine, and these are how a human says which.
//
// REGISTRATION POSITION IS LOAD-BEARING (see whiteboards.ts) — called from where these sat.
import { ipcMain } from 'electron';
import type { PowerSyncDatabase } from '@powersync/node';

export function registerTaskIpc(deps: {
  ws: () => string;
  db: () => PowerSyncDatabase;
  api: (path: string, body?: unknown) => Promise<Record<string, unknown>>;
  /** a getter: sign-in can change the actor mid-session */
  actorId: () => string;
}): void {
  const { ws, db, api, actorId } = deps;

  // subtasks (docs/24): a human adds companion work under an open task; the
  // server validates depth/cap/channel and the FSM keeps it lean.
  ipcMain.handle('nm:subtask-add', async (_e, { parentId, title, description }: { parentId: string; title: string; description?: string }) => {
    // channel/project are INHERITED from the parent server-side; pass the parent's own
    const [row] = await db().getAll<{ channel_id: string; workspace_id: string }>('select channel_id, workspace_id from tasks where id = ?', [parentId]);
    if (!row) throw new Error('parent task not found');
    return api('/v1/commands', { type: 'task.create', workspace: row.workspace_id, channel: row.channel_id, title, parent: parentId, ...(description ? { description } : {}) });
  });

  // ship-gate checklist writes (docs/23): tick/untick an item, or append a
  // late-found one. Owner enforcement is server-side (an agent can never tick a
  // human item); the human posts as themselves so the who/when lands in events.
  ipcMain.handle('nm:ship-item', async (_e, { taskId, itemId, state, note }: { taskId: string; itemId: string; state: 'pending' | 'done' | 'na'; note?: string }) =>
    api('/v1/commands', { type: 'task.check_ship_item', taskId, itemId, state, ...(note ? { note } : {}) }));

  ipcMain.handle('nm:ship-item-add', async (_e, { taskId, title, detail }: { taskId: string; title: string; detail?: string }) =>
    api('/v1/commands', { type: 'task.add_ship_item', taskId, title, ...(detail ? { detail } : {}), owner: 'human' }));

  // edit a task's Definition of Done (the human posts as themselves); the row
  // syncs back so the card + the reviewer see the new acceptance bar immediately.
  ipcMain.handle('nm:task-set-dod', async (_e, { taskId, dod }: { taskId: string; dod: string }) =>
    api('/v1/commands', { type: 'task.set_definition_of_done', taskId, dod }));

  ipcMain.handle('nm:compute-shared-threads', async (_e, { member }: { member: string }) => {
    const rows = await db().getAll<{ n: number }>(
      `select count(distinct t.id) as n from threads t
        where t.workspace_id = ? and t.created_by = ? and t.archived_at is null
          and exists (select 1 from runs r
                       join machines m on m.id = r.machine_id
                      where r.thread_id = t.id and m.workspace_id = t.workspace_id and m.owner_user_id = ?)`,
      [ws(), member, actorId()],
    ).catch(() => [] as Array<{ n: number }>);
    return { count: Number(rows[0]?.n ?? 0) };
  });

  // compute choice (0118): where MY requests run — self-only by construction (the server
  // writes the actor's own member row), so this carries no user id
  // ONE lend/revoke as INTENT — the server expands any '*' against the real roster (2026-08-14)
  ipcMain.handle('nm:share-compute', async (_e, { member, on }: { member: string; on: boolean }) =>
    api('/v1/commands', { type: 'member.share_compute', workspace: ws(), member, on }));

  ipcMain.handle('nm:set-compute', async (_e, { machine, agents, shares, desktopSessions }: { machine?: string | null; agents?: Record<string, string>; shares?: string[]; desktopSessions?: 'here' | 'auto' }) =>
    api('/v1/commands', { type: 'member.set_compute', workspace: ws(), ...(machine !== undefined ? { machine } : {}), ...(agents !== undefined ? { agents } : {}), ...(shares !== undefined ? { shares } : {}), ...(desktopSessions !== undefined ? { desktopSessions } : {}) }));

  // edit a pre-work task's title/description — the backlog scratch-board edit
  // (docs/15). The server freezes details once the task is staged (designing on).
  ipcMain.handle('nm:task-update-details', async (_e, { taskId, title, description }: { taskId: string; title?: string; description?: string }) =>
    api('/v1/commands', { type: 'task.update_details', taskId, ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}) }));

  // welcome state derives from cloud truth, not a per-origin localStorage
  // flag: any human message in the replica means the guided first-send is done
  // (the dev-server origin changes when ports shift, wiping local flags)
  // full task view: the event timeline + artifacts straight from the API
  // (the events log is server truth — it is not synced to clients)
  ipcMain.handle('nm:task-detail', async (_e, { taskId }: { taskId: string }) => api(`/v1/tasks/${taskId}`));

}
