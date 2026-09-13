// Crew and infra watches: the roster, failovers, whiteboards — extracted from sync.ts (track B-sync).
//
// A watch is a SUBSCRIPTION: it registers an abort handle in startSync's `watchers` registry so
// the renderer's unsubscribe can find it. That registry is why these take deps rather than
// owning anything — the lifetime belongs to the session, not to this module.
import { ipcMain, type WebContents } from 'electron';
import type { WatchDeps } from './watchdeps';

export function registerCrewWatches(d: WatchDeps): void {
const { db, watchers, watchFailed, loadRoster, ws } = d;
  ipcMain.handle('nm:watch-whiteboards', (event, { subId, channelId, projectId }: { subId: string; channelId?: string | null; projectId?: string | null }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    // snapshot_svg rides the list (tiles render it), so the cap stays modest — 60 boards is
    // multiple screens of grid; the destination is a recency surface, not an archive browser
    const base = `select w.id, w.channel_id, c.slug as channel_slug, w.thread_id, w.task_id, w.title, w.snapshot_svg, w.snapshot_rev,
                         w.rev, w.source, w.created_by_kind, w.created_by, w.created_at, w.updated_at
                    from whiteboards w join channels c on c.id = w.channel_id
                   where w.archived_at is null`;
    const [sql, params] = channelId
      ? [`${base} and w.channel_id = ? order by w.updated_at desc limit 60`, [channelId]]
      : projectId
        ? [`${base} and c.project_id = ? order by w.updated_at desc limit 60`, [projectId]]
        : [`${base} order by w.updated_at desc limit 60`, []];
    db().watch(
      sql as string,
      params as string[],
      {
        onResult: (r) => {
          if (!sender.isDestroyed()) sender.send('nm:whiteboards', { subId, rows: (r.rows?._array ?? []) as unknown[] });
        },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
  ipcMain.handle('nm:watch-whiteboard', (event, { subId, id }: { subId: string; id: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      `select w.*, c.slug as channel_slug from whiteboards w join channels c on c.id = w.channel_id where w.id = ?`,
      [id],
      {
        onResult: (r) => {
          if (!sender.isDestroyed()) sender.send('nm:whiteboard', { subId, row: ((r.rows?._array ?? []) as unknown[])[0] ?? null });
        },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
  ipcMain.handle('nm:watch-roster', (event, { subId }: { subId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    const push = async () => {
      if (sender.isDestroyed()) return;
      sender.send('nm:roster-live', { subId, ...(await loadRoster()) });
    };
    // one watch per source table; any change re-pushes the combined roster
    for (const q of [
      'select count(*) as n from machines',
      // retired_at is in the watch so a retire/rehire of an already-offline agent still re-pushes
      'select count(*) as n, sum(case when status = \'online\' then 1 else 0 end) as o, sum(case when retired_at is null then 0 else 1 end) as r from agents',
      'select count(*) as n from agent_channels',
      'select count(*) as n from workspace_members',
    ]) {
      db().watch(q, [], { onResult: () => void push(), onError: watchFailed }, { signal: ac.signal });
    }
  });
  // workspace-wide decisions (with channel slug + task number) — Mission Control's
  // queue and the thread cards' authoritative answered-state read from here
  // the single OPEN capacity-failover across the workspace (docs/22). A cap is a
  // WORKSPACE concern — it re-seats agents everywhere — so the human must be able to
  // answer it wherever they are, not only in the channel it was posted to. The client
  // renders this as a sticky fly-up above the active composer. Joined: the decision row
  // carries the open/answered status; the message body carries the rich failover payload.
  ipcMain.handle('nm:watch-failover', (event, { subId }: { subId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      `select d.id as decision_id, d.channel_id, c.slug as channel_slug, m.body
         from decisions d
         join messages m on m.id = d.message_id
         join channels c on c.id = d.channel_id
        where d.workspace_id = ? and d.status = 'open' and m.body like '%"failover"%'
        order by d.created_at desc limit 1`,
      [ws()],
      {
        onResult: (r) => {
          if (!sender.isDestroyed()) sender.send('nm:failover', { subId, row: (r.rows?._array ?? [])[0] ?? null });
        },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
}
