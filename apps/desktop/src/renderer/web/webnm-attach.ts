// ATTACHMENTS IN THE BROWSER — the four reads work, the two writes say they do not.
//
// An attachment is an `artifacts` row with a `message_id`: the bytes ride the row's
// `inline_content`, and the row syncs like any other. So READING them is a replica question the
// browser can already answer, and these four watches are the desktop's own queries, verbatim.
//
// STAGING them is not. attachStage takes an ArrayBuffer the renderer already holds, and the
// desktop writes it to disk so `insertAttachments` can build the artifacts row from the staged
// file at send time. A browser could compute the same metadata in-page — size from the buffer,
// width/height by decoding it, a thumb via canvas — and it would be a lie, because there is no
// upload path behind it: the row would never be written and the composer would show a picture
// that no one else can ever see.
//
// That is not a hypothetical trade-off, it is the same call the send lane already made:
// webnm-actions' sendThread drops attachments with a warn for exactly this reason. Two halves of
// one feature must agree — a composer that stages happily into a send that discards is worse than
// one that says up front it cannot attach yet. So the writes refuse, and they will stop refusing
// when the upload path exists, in one place, on purpose.
import type { PowerSyncDatabase } from '@powersync/web';
import type { NMBridge } from '../src/bridge/nm';
import type { AttachmentRow } from '../src/bridge/rows-board';
import type { WebNmConfig } from './webnm';

/** a live query: run it, then re-run whenever one of `tables` changes. mirrors db.watch's
 *  contract for the renderer, minus the IPC hop the desktop needs. Duplicated from
 *  webnm-convo.ts/webnm-board.ts rather than shared, the same way `orEmpty` already is —
 *  these files are written in parallel and a lane file stands alone. */
function watch<T>(db: PowerSyncDatabase, tables: string[], run: () => Promise<T[]>, cb: (rows: T[]) => void): () => void {
  let live = true;
  const push = () => {
    if (!live) return;
    // a failed read leaves the last good rows standing rather than blanking the surface
    void run().then((rows) => { if (live) cb(rows); }).catch((e: unknown) => { console.error('[webnm] attachment watch failed:', e); });
  };
  push();
  const stop = db.onChangeWithCallback({ onChange: () => push() }, { tables });
  return () => { live = false; stop(); };
}

// ── the queries, copied from sync/ipc/watch-rooms.ts ──────────────────────────────────────────

// nm:watch-msg-attachments — a room's own message attachments. `task_id is null` keeps a task's
// files out of the room feed; `message_id is not null` is what separates an ATTACHMENT from a
// deliverable, which is the same artifacts table with no message behind it.
const MSG_SQL = `select id, message_id, kind, name, mime, inline_content, size_bytes, width, height, created_at from artifacts
       where channel_id = ? and task_id is null and message_id is not null order by created_at asc`;

// nm:watch-convo-attachments — one conversation's attachments, reached through its messages
const CONVO_SQL = `select a.id, a.message_id, a.kind, a.name, a.mime, a.inline_content, a.size_bytes, a.width, a.height, a.created_at
         from artifacts a join messages m on m.id = a.message_id
        where m.thread_id = ? order by a.created_at asc`;

// nm:watch-thread-attachments — a task thread's attachments
const THREAD_SQL = `select id, message_id, kind, name, mime, inline_content, size_bytes, width, height, created_at from artifacts
       where task_id = ? and message_id is not null order by created_at asc`;

// nm:watch-attachments-all — every attachment in the workspace, newest first, carrying the room
// it belongs to. WORKSPACE-SCOPED and it must stay that way: the replica holds every workspace
// you belong to, so dropping the predicate leaks another workspace's files into this one's view.
const ALL_SQL = `select a.id, a.message_id, a.kind, a.name, a.mime, a.inline_content, a.size_bytes, a.width, a.height, a.created_at, c.slug as channel_slug, c.id as channel_id
       from artifacts a join channels c on c.id = a.channel_id
       where a.workspace_id = ? and a.message_id is not null order by a.created_at desc`;

/** the tables every one of these reads; a change to either re-runs the query */
const TABLES = ['artifacts', 'messages'];

export function attachOverrides(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  const ws = () => cfg.workspaceId();
  return {
    watchMsgAttachments: (channelId: string, cb: (rows: AttachmentRow[]) => void) =>
      watch<AttachmentRow>(db, TABLES, () => db.getAll<AttachmentRow>(MSG_SQL, [channelId]), cb),

    watchConvoAttachments: (threadId: string, cb: (rows: AttachmentRow[]) => void) =>
      watch<AttachmentRow>(db, TABLES, () => db.getAll<AttachmentRow>(CONVO_SQL, [threadId]), cb),

    watchThreadAttachments: (taskId: string, cb: (rows: AttachmentRow[]) => void) =>
      watch<AttachmentRow>(db, TABLES, () => db.getAll<AttachmentRow>(THREAD_SQL, [taskId]), cb),

    watchAttachmentsAll: (cb: (rows: AttachmentRow[]) => void) =>
      watch<AttachmentRow>(db, [...TABLES, 'channels'], () => db.getAll<AttachmentRow>(ALL_SQL, [ws()]), cb),

    /**
     * THE TWO THAT REFUSE. attachStage's contract returns real metadata, and every field of it
     * would be honest except the one that matters: that the bytes are somewhere the send path can
     * reach. They are not. Rather than return a staged id that resolves to nothing, this throws —
     * the composer's attach control already handles a failed stage, and a visible failure is the
     * only answer that stays true when someone else opens the thread.
     */
    attachStage: () => Promise.reject(new Error('attaching files is not available in the browser yet — the bytes have nowhere to upload to')),
    // discarding a stage that never happened is a no-op, not an error: it runs on cleanup paths
    // that must not throw, and there is genuinely nothing to discard.
    attachDiscard: async () => {},
  };
}
