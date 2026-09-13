// Room watches: messages, threads and their attachments — extracted from sync.ts (track B-sync).
//
// A watch is a SUBSCRIPTION: it registers an abort handle in startSync's `watchers` registry so
// the renderer's unsubscribe can find it. That registry is why these take deps rather than
// owning anything — the lifetime belongs to the session, not to this module.
import { ipcMain, type WebContents } from 'electron';
import type { WatchDeps } from './watchdeps';

/** every session in a workspace — the rail's row-set. Named so the rail's union (watch-rail.ts) runs the
 *  SAME query for a background connection that this handler runs for the foreground, and the two cannot drift. */
export const HISTORY_ALL_SQL = `select t.id, t.channel_id, c.slug as channel_slug, t.title, t.task_id, t.updated_at, t.schedule_id, t.settled_at,
              (select m.body from messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_body,
              -- the status inputs (shared/threadstatus.ts): who spoke last, and when
              (select m.author_kind from messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_author_kind,
              (select max(m.created_at) from messages m where m.thread_id = t.id) as last_at
         from threads t join channels c on c.id = t.channel_id
        where t.workspace_id = ? and t.archived_at is null
        order by t.updated_at desc limit 400`;

export function registerRoomsWatches(d: WatchDeps): void {
const { db, watchers, watchFailed, ws } = d;
  ipcMain.handle('nm:watch-messages', (event, { subId, channelId }: { subId: string; channelId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    console.log(`ipc_probe=watch-messages channel=${channelId.slice(0, 8)}`);
    const sender: WebContents = event.sender;
    // The room's own messages — what the sessions shell reads for the pinned briefs and the
    // legacy pass (docs/35 §4.1, §10), no longer a feed. The docs/20 thread_mode widening is
    // gone with the lens, and with it the join to channels that made the watch react to it.
    db().watch(
      // A thread's REPLIES belong to the thread, not the room (docs/31). A thread's ROOT is the
      // exception: it is a room message that happens to have answers, so it stays — and
      // `root_thread_id` names the session it opened, which is exactly what tells the legacy
      // pass that this message already HAS a row (m.thread_id alone cannot: a reply-rooted
      // thread leaves its root's own thread_id null).
      `select m.id, m.author_kind, m.author_id, m.body, m.created_at, m.pinned, m.task_id,
              m.thread_id, rt.id as root_thread_id
         from messages m
         left join threads rt on rt.root_message_id = m.id
        where m.channel_id = ?
          and m.task_id is null
          and (m.thread_id is null or rt.id is not null)
        order by m.created_at asc, m.id asc`,
      [channelId],
      {
        onResult: (r) => {
          if (!sender.isDestroyed()) sender.send('nm:messages', { subId, rows: (r.rows?._array ?? []) as unknown[] });
        },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
  // docs/31: per-root reply tallies for the feed footer. One grouped watch for the whole room
  // rather than a query per message — a busy room has hundreds of messages and a handful of threads.
  ipcMain.handle('nm:watch-reply-counts', (event, { subId, channelId }: { subId: string; channelId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      `select t.root_message_id as message_id, t.id as thread_id, count(m.id) as n,
              max(m.created_at) as last_at
         from threads t join messages m on m.thread_id = t.id and m.id <> t.root_message_id
        where t.channel_id = ? and t.root_message_id is not null and t.archived_at is null
        group by t.root_message_id, t.id`,
      [channelId],
      { onResult: (r) => { if (!sender.isDestroyed()) sender.send('nm:reply-counts', { subId, rows: (r.rows?._array ?? []) as unknown[] }); }, onError: watchFailed },
      { signal: ac.signal },
    );
  });
  ipcMain.handle('nm:watch-thread', (event, { subId, taskId }: { subId: string; taskId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      `select id, author_kind, author_id, body, created_at, pinned from messages
       where task_id = ? order by created_at asc, id asc`,
      [taskId],
      {
        onResult: (r) => {
          if (!sender.isDestroyed()) sender.send('nm:thread', { subId, rows: (r.rows?._array ?? []) as unknown[] });
        },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
  // chat attachments on channel messages (task_id null) — the renderer groups them by message_id
  ipcMain.handle('nm:watch-msg-attachments', (event, { subId, channelId }: { subId: string; channelId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      `select id, message_id, kind, name, mime, inline_content, size_bytes, width, height, created_at from artifacts
       where channel_id = ? and task_id is null and message_id is not null order by created_at asc`,
      [channelId],
      { onResult: (r) => { if (!sender.isDestroyed()) sender.send('nm:msg-attachments', { subId, rows: (r.rows?._array ?? []) as unknown[] }); }, onError: watchFailed },
      { signal: ac.signal },
    );
  });
  // chat attachments on thread-reply messages (by task)
  // …and the same for a CONVERSATION. A chat's attachments hang off their message, which hangs
  // off the thread — there is no task_id to filter on, which is the only reason a conversation
  // could not show you the image you had just sent it.
  ipcMain.handle('nm:watch-convo-attachments', (event, { subId, threadId }: { subId: string; threadId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      `select a.id, a.message_id, a.kind, a.name, a.mime, a.inline_content, a.size_bytes, a.width, a.height, a.created_at
         from artifacts a join messages m on m.id = a.message_id
        where m.thread_id = ? order by a.created_at asc`,
      [threadId],
      { onResult: (r) => { if (!sender.isDestroyed()) sender.send('nm:convo-attachments', { subId, rows: (r.rows?._array ?? []) as unknown[] }); }, onError: watchFailed },
      { signal: ac.signal },
    );
  });
  ipcMain.handle('nm:watch-thread-attachments', (event, { subId, taskId }: { subId: string; taskId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      `select id, message_id, kind, name, mime, inline_content, size_bytes, width, height, created_at from artifacts
       where task_id = ? and message_id is not null order by created_at asc`,
      [taskId],
      { onResult: (r) => { if (!sender.isDestroyed()) sender.send('nm:thread-attachments', { subId, rows: (r.rows?._array ?? []) as unknown[] }); }, onError: watchFailed },
      { signal: ac.signal },
    );
  });
  // conversation threads (the conversation-first shell): the active channel's history —
  // every thread the room has had, freshest first, with a last-line snippet for the row
  ipcMain.handle('nm:watch-threads', (event, { subId, channelId }: { subId: string; channelId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      // root_* (docs/31): the room message this thread hangs off, so the sheet can pin it
      `select t.id, t.title, t.description, t.created_by, t.task_id, t.created_at, t.updated_at, t.root_message_id, t.mode, t.brain_override, t.schedule_id,
              (select count(*) from messages m where m.thread_id = t.id) as msg_count,
              (select m.body from messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_body,
              (select m.body from messages m where m.id = t.root_message_id) as root_body,
              (select m.author_kind from messages m where m.id = t.root_message_id) as root_author_kind,
              (select m.author_id from messages m where m.id = t.root_message_id) as root_author_id,
              (select m.created_at from messages m where m.id = t.root_message_id) as root_at
         from threads t where t.channel_id = ? and t.archived_at is null order by t.updated_at desc limit 120`,
      [channelId],
      {
        onResult: (r) => {
          if (!sender.isDestroyed()) sender.send('nm:threads', { subId, rows: (r.rows?._array ?? []) as unknown[] });
        },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
  ipcMain.handle('nm:watch-threads-all', (event, { subId }: { subId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      `select t.id, t.channel_id, c.slug as channel_slug, t.title, t.task_id, t.updated_at, t.schedule_id,
              (select count(*) from messages m where m.thread_id = t.id) as msg_count,
              (select m.author_kind from messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_author_kind
         from threads t join channels c on c.id = t.channel_id
        where t.workspace_id = ? and t.task_id is null and t.archived_at is null
        order by t.updated_at desc limit 30`,
      [ws()],
      {
        onResult: (r) => {
          if (!sender.isDestroyed()) sender.send('nm:threads-all', { subId, rows: (r.rows?._array ?? []) as unknown[] });
        },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
  // EVERY thread in the workspace, task threads included — the one row-set behind the session
  // list, the Recents rail and the ⌘Y overlay (docs/35 §7). Its twin `watch-threads-all`
  // (the same query with `task_id is null`, capped 30) survives for Home's in-flight CHAT
  // list — George's 2026-07-29 ruling: Home keeps its own face (queue cards + in-flight),
  // the sessions shape belongs to the CHANNEL home. One channel's slice stays client-side.
  ipcMain.handle('nm:watch-history-all', (event, { subId }: { subId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      HISTORY_ALL_SQL,
      [ws()],
      {
        onResult: (r) => { if (!sender.isDestroyed()) sender.send('nm:history-all', { subId, rows: (r.rows?._array ?? []) as unknown[] }); },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
  // Settings › Archived chats: the only place archived conversations exist. Everything else in the
  // app filters them out, which is what makes archiving meaningfully different from a read-state.
  ipcMain.handle('nm:watch-archived-threads', (event, { subId }: { subId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      `select t.id, t.channel_id, c.slug as channel_slug, t.title, t.archived_at, t.updated_at,
              (select m.body from messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_body
         from threads t join channels c on c.id = t.channel_id
        where t.workspace_id = ? and t.archived_at is not null
        order by t.archived_at desc limit 200`,
      [ws()],
      {
        onResult: (r) => { if (!sender.isDestroyed()) sender.send('nm:archived-threads', { subId, rows: (r.rows?._array ?? []) as unknown[] }); },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
  // one conversation's feed. An upgraded thread (task born inside) is the UNION of its
  // chat messages and the task thread's — the surface stays one continuous exchange.
  ipcMain.handle('nm:watch-convo', (event, { subId, threadId }: { subId: string; threadId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      `select m.id, m.author_kind, m.author_id, m.body, m.created_at, m.pinned, m.task_id
         from messages m
        where m.thread_id = ?
           or (m.task_id is not null and m.task_id = (select t.task_id from threads t where t.id = ?))
        order by m.created_at asc, m.id asc`,
      [threadId, threadId],
      {
        onResult: (r) => {
          if (!sender.isDestroyed()) sender.send('nm:convo', { subId, rows: (r.rows?._array ?? []) as unknown[] });
        },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
  // workspace-wide chat attachments (with channel slug) for the artifact screen's "Shared in chat"
  ipcMain.handle('nm:watch-attachments-all', (event, { subId }: { subId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      `select a.id, a.message_id, a.kind, a.name, a.mime, a.inline_content, a.size_bytes, a.width, a.height, a.created_at, c.slug as channel_slug, c.id as channel_id
       from artifacts a join channels c on c.id = a.channel_id
       where a.workspace_id = ? and a.message_id is not null order by a.created_at desc`,
      [ws()],
      {
        onResult: (r) => {
          if (!sender.isDestroyed()) sender.send('nm:attachments-all', { subId, rows: (r.rows?._array ?? []) as unknown[] });
        },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
}
