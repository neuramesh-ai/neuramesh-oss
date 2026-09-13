// THE BROWSER'S CONVERSATION LANE — sessions, messages, members, and sending one.
//
// This is the path the product is FOR: open the workspace, see the crew, say something, get an
// answer. Every read here was a stub or absent, so the browser could complete onboarding and
// then do nothing with the workspace it had just built.
//
// Ports of the desktop's IPC handlers, against the same replica. Two differences worth naming:
//
//  · a WATCH is `onChangeWithCallback` over the tables the query reads, re-running it on change.
//    The desktop gets `db.watch` from the node SDK and pipes results over IPC to a WebContents;
//    in the page there is no IPC and no sender to be destroyed, so the callback is called
//    directly and the unsubscribe is the whole teardown.
//
//  · SEND writes to the local replica, exactly as the desktop does — the row is uploaded by the
//    ps_crud uploader that both clients already share (sync/upload.ts). It is not an HTTP call,
//    which is what makes an offline send queue rather than fail.
import type { PowerSyncDatabase } from '@powersync/web';
import type { NMBridge } from '../src/bridge/nm';
import type { HomeConvoRow, MessageRow } from '../src/bridge/rows-rooms';
import type { MemberRow } from '../src/bridge/rows-crew';
import type { WebNmConfig } from './webnm';

/** a live query: run it, then re-run whenever one of `tables` changes. mirrors db.watch's
 *  contract for the renderer, minus the IPC hop the desktop needs. */
function watch<T>(
  db: PowerSyncDatabase,
  tables: string[],
  run: () => Promise<T[]>,
  cb: (rows: T[]) => void,
): () => void {
  let live = true;
  const push = () => {
    if (!live) return;
    // a failed read leaves the last good rows standing rather than blanking the surface
    void run().then((rows) => { if (live) cb(rows); }).catch(() => {});
  };
  push();
  const stop = db.onChangeWithCallback({ onChange: () => push() }, { tables });
  return () => { live = false; stop(); };
}

/** A failed read must not look like an empty workspace — that is the exact bug these lanes were
 *  written to fix ("no channels yet" on a workspace that had four). So it SAYS SO and then yields
 *  empty, rather than yielding empty quietly. */
const orEmpty = <T>(what: string) => (e: unknown): T[] => {
  console.error(`[webnm] ${what} failed:`, e);
  return [];
};

export function convoOverrides(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  const ws = () => cfg.workspaceId();
  return {
    /**
     * HAS ANYONE HERE EVER SPOKEN? Ported from sync.ts nm:welcomed — the same replica question.
     *
     * It was stubbed `{ welcomed: true }`, which permanently answered "yes, they have". That
     * silently switched off the whole first-send coaching: `needsFirstSend` is
     * `welcomed === false`, so the browser never pre-filled the composer with the intro prompt
     * and never showed the welcome hint. A new workspace's first move is the one moment the
     * product most wants to help with, and on web it was the one moment it said nothing.
     *
     * The draft is deliberately re-offered on every load until they actually send (App.tsx:
     * "survives relaunches"), so answering this correctly restores that too.
     */
    welcomed: async () => ({
      welcomed: (await db.getAll(
        "select 1 as x from messages where workspace_id = ? and author_kind = 'human' limit 1",
        [ws()],
      ).catch(orEmpty('welcomed'))).length > 0,
    }),

    // ported from sync/ipc/rooms.ts nm:members — display names for every human in the workspace,
    // which is what turns an author_id into a person on screen.
    members: async () =>
      db.getAll<MemberRow>(
        'select user_id, role, display_name, compute from workspace_members where workspace_id = ? order by display_name',
        [ws()],
      ).catch(orEmpty('members')),

    // ported from sync/ipc/watch-rooms.ts nm:watch-threads-all — the session list. Task threads
    // are excluded here (they ride their task), and archived ones stay archived.
    watchThreadsAll: (cb: (rows: HomeConvoRow[]) => void) =>
      watch<HomeConvoRow>(db, ['threads', 'channels', 'messages'], () =>
        db.getAll<HomeConvoRow>(
          `select t.id, t.channel_id, c.slug as channel_slug, t.title, t.task_id, t.updated_at, t.schedule_id,
                  (select count(*) from messages m where m.thread_id = t.id) as msg_count,
                  (select m.author_kind from messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_author_kind
             from threads t join channels c on c.id = t.channel_id
            where t.workspace_id = ? and t.task_id is null and t.archived_at is null
            order by t.updated_at desc limit 30`,
          [ws()],
        ), cb),

    // ported from nm:watch-convo — one conversation's messages, including the task thread's own
    // if this session is a task's.
    watchConvo: (threadId: string, cb: (rows: MessageRow[]) => void) =>
      watch<MessageRow>(db, ['messages', 'threads'], () =>
        db.getAll<MessageRow>(
          `select m.id, m.author_kind, m.author_id, m.body, m.created_at, m.pinned, m.task_id
             from messages m
            where m.thread_id = ?
               or (m.task_id is not null and m.task_id = (select t.task_id from threads t where t.id = ?))
            order by m.created_at asc, m.id asc`,
          [threadId, threadId],
        ), cb),

    /**
     * ported from sync/ipc/messages.ts nm:send. The insert IS the send: the row lands in the
     * replica and the shared ps_crud uploader posts it, so the message survives a flaky
     * connection instead of being lost with the request. Threads stay server-born — the client
     * only stamps the id, so an offline send still groups correctly when it arrives.
     */
    // POSITIONAL, matching the contract (nm.ts:35). Taking an options object here instead would
    // typecheck fine — the overrides are Record<string, unknown> — and then send `undefined` as
    // the body of every message, which is the kind of break that only shows up in use.
    send: async (channelId: string, body: string, opts?: SendOpts) => insertMessage(db, cfg, channelId, body, opts),
  };
}

export interface SendOpts {
  id?: string; threadId?: string; rootMessageId?: string;
  threadMode?: 'tasks' | 'chat'; brainOverride?: Record<string, string> | null;
  threadMachineId?: string | null; threadOrigin?: 'desktop' | 'web' | 'routine' | null;
}

/** the browser's one way to say something: a local row the uploader carries to /v1/messages — the
 *  composer's send, and the content lane's ask for a picture (webnm-content.ts) */
export async function insertMessage(db: PowerSyncDatabase, cfg: WebNmConfig, channelId: string, body: string, opts?: SendOpts): Promise<{ id: string }> {
  const id = opts?.id ?? crypto.randomUUID();
  const brain = opts?.brainOverride;
  await db.execute(
    `insert into messages (id, workspace_id, channel_id, thread_id, root_message_id, birth_mode, birth_brain, birth_machine, birth_origin, author_kind, author_id, body, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'human', ?, ?, ?)`,
    [
      id, cfg.workspaceId(), channelId, opts?.threadId ?? null, opts?.rootMessageId ?? null,
      opts?.threadMode ?? null,
      brain && Object.keys(brain).length ? JSON.stringify(brain) : null,
      // 0134, rule D9: a web-born session says so, and may name its machine
      opts?.threadMachineId ?? null, opts?.threadOrigin ?? 'web',
      cfg.actorId(), body, new Date().toISOString(),
    ],
  );
  return { id };
}
