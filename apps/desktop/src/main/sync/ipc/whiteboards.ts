// WHITEBOARD IPC — the human write lane (docs/38).
//
// Four handlers split out of startSync, which held 52 registrations inline. Humans write
// local-first and LWW-by-rev; agents go through the strict command lane instead. That asymmetry
// is why these are their own module rather than folded in with the board's other handlers.
//
// REGISTRATION POSITION IS LOAD-BEARING. The renderer subscribes as soon as it mounts and its
// retry budget is eight attempts, so a handler registered after a boot await is one that
// silently never answers. registerWhiteboardIpc() is called from exactly where these sat.
import { apiAuthHeaders } from '../../apiauth';
import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import type { PowerSyncDatabase } from '@powersync/node';

export function registerWhiteboardIpc(deps: {
  ws: () => string;
  db: () => PowerSyncDatabase;
  /** this desktop's actor id — a function, because sign-in can change it mid-session */
  actorId: () => string;
  /** a GETTER: API_URL is a reassigned `let` in sync.ts, and importing it would make the
   *  sync ⇄ ipc edge a value cycle rather than the type-only one it is now. */
  apiUrl: () => string;
}): void {
  const { ws, db, actorId, apiUrl } = deps;

  // ── whiteboards (docs/38): local-first writes + the watches ──────────────────────────────
  // Every save bumps rev CLIENT-side (the editor owns the base it built on); uploadData
  // forwards the row to the LWW lane. The strict command lane (materialize, agent-adjacent
  // updates) goes through nm:wb-update-cmd → /v1/commands, main-process fetch like
  // nm:promote-artifact — the renderer never talks to the API directly.
  ipcMain.handle('nm:wb-create', async (_e, { channelId, title, threadId }: { channelId: string; title?: string; threadId?: string }) => {
    const id = randomUUID();
    const now = new Date().toISOString();
    await db().execute(
      `insert into whiteboards (id, workspace_id, channel_id, thread_id, title, snapshot_rev, rev, created_by_kind, created_by, updated_by_kind, updated_by, created_at, updated_at)
       values (?, ?, ?, ?, ?, 0, 1, 'human', ?, 'human', ?, ?, ?)`,
      [id, ws(), channelId, threadId ?? null, title?.trim() || 'Untitled board', actorId(), actorId(), now, now],
    );
    return { id };
  });

  ipcMain.handle('nm:wb-save', async (_e, { id, rev, scene, snapshotSvg, title }: { id: string; rev: number; scene?: string; snapshotSvg?: string; title?: string }) => {
    const now = new Date().toISOString();
    if (snapshotSvg != null) {
      // the still rides with the scene it pictures — snapshot_rev = this save's rev
      await db().execute(
        `update whiteboards set scene = coalesce(?, scene), snapshot_svg = ?, snapshot_rev = ?, title = coalesce(?, title),
           rev = ?, updated_by_kind = 'human', updated_by = ?, updated_at = ? where id = ?`,
        [scene ?? null, snapshotSvg, rev, title ?? null, rev, actorId(), now, id],
      );
    } else {
      await db().execute(
        `update whiteboards set scene = coalesce(?, scene), title = coalesce(?, title),
           rev = ?, updated_by_kind = 'human', updated_by = ?, updated_at = ? where id = ?`,
        [scene ?? null, title ?? null, rev, actorId(), now, id],
      );
    }
  });

  ipcMain.handle('nm:wb-archive', async (_e, { id, rev, restore }: { id: string; rev: number; restore?: boolean }) => {
    const now = new Date().toISOString();
    await db().execute(
      `update whiteboards set archived_at = ?, rev = ?, updated_by_kind = 'human', updated_by = ?, updated_at = ? where id = ?`,
      [restore ? null : now, rev, actorId(), now, id],
    );
  });

  // the strict command lane — returns the server verdict instead of throwing, because
  // WHITEBOARD_STALE is an expected outcome of a materialize race, not a failure
  ipcMain.handle('nm:wb-update-cmd', async (_e, payload: { whiteboardId: string; baseRev: number; title?: string; scene?: string; snapshotSvg?: string; clearSource?: boolean }) => {
    const res = await fetch(`${apiUrl()}/v1/commands`, {
      method: 'POST',
      headers: await apiAuthHeaders(apiUrl(), { kind: 'human', id: actorId() }),
      body: JSON.stringify({ type: 'whiteboard.update', ...payload }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, ...body };
  });
}
