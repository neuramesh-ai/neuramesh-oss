// Routines, drafted content and the publishing connectors — extracted from sync.ts.
//
// Every handler here is a thin, faithful pass-through to the control-api: the server owns
// approval, scheduling and the connector secrets, and this layer must not grow a second
// opinion about any of them.
import { shell } from 'electron';
import { api, actorId, apiUrl } from '../../sync';
import { HOST_NOT_RUNNING, directActs } from '../../host/directacts';
import { fetchImageDataUrl } from '../../mediafetch';
import { apiAuthHeaders } from '../../apiauth';
import { ipcMain } from 'electron';
import type { PowerSyncDatabase } from '@powersync/node';

export interface ContentDeps {
  db: () => PowerSyncDatabase;
  ws: () => string;
}

export function registerContent({ db, ws }: ContentDeps): void {
// schedules (marketing-channel plan §4.6): arm rides api() so a Free-plan 402 surfaces
// the upgrade flow automatically; the list is a cheap local-replica read.
ipcMain.handle('nm:schedule-create', async (_e, p: { channelId: string; title: string; prompt: string; cadence: string; atTime?: string; tz?: string; weekday?: number; runAt?: string; routine?: boolean }) =>
  api('/v1/commands', { type: 'schedule.create', channel: p.channelId, title: p.title, prompt: p.prompt, cadence: p.cadence, atTime: p.atTime, tz: p.tz, weekday: p.weekday, runAt: p.runAt, routine: p.routine }));
ipcMain.handle('nm:schedule-status', async (_e, { scheduleId, status }: { scheduleId: string; status: 'active' | 'paused' }) =>
  api('/v1/commands', { type: 'schedule.set_status', schedule: scheduleId, status }));
ipcMain.handle('nm:schedule-delete', async (_e, { scheduleId }: { scheduleId: string }) =>
  api('/v1/commands', { type: 'schedule.delete', schedule: scheduleId }));
ipcMain.handle('nm:schedule-update', async (_e, p: { scheduleId: string; title: string; prompt: string; cadence: string; atTime?: string; tz?: string; weekday?: number; runAt?: string }) =>
  api('/v1/commands', { type: 'schedule.update', schedule: p.scheduleId, title: p.title, prompt: p.prompt, cadence: p.cadence, atTime: p.atTime, tz: p.tz, weekday: p.weekday, runAt: p.runAt }));
// An automation's RUN HISTORY (0119, 2026-08-11): every routine fire opens its own conversation,
// so the runs already exist — this is the join that finds them. `msg_count` is what separates a
// run that started a real exchange from one nobody answered, and it is the only thing here the
// thread row cannot say for itself. Capped at 8: the card reveals recent runs, not an archive —
// the room's session list is where you go to read them all.
ipcMain.handle('nm:schedule-runs', async (_e, { scheduleId, limit }: { scheduleId: string; limit?: number }) => ({
  runs: await db().getAll(
    `select t.id, t.title, t.created_at, t.updated_at, t.channel_id, c.slug as channel_slug,
            (select count(*) from messages m where m.thread_id = t.id) as msg_count,
            -- every run of one routine opens a thread with the SAME title (it is derived from the
            -- same prompt), so a list of titles is four identical lines. The last message is what
            -- actually differs between runs — it is what the run PRODUCED.
            (select m.body from messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_body
       from threads t left join channels c on c.id = t.channel_id
      where t.schedule_id = ? and t.workspace_id = ? and t.archived_at is null
      order by t.created_at desc limit ?`,
    [scheduleId, ws(), Math.min(Math.max(limit ?? 8, 1), 50)],
  ).catch(() => []),
}));
// content items (marketing-channel plan §4.7): the calendar reads the local replica;
// approve/unschedule ride api() (human actor), so guards + plan gates apply server-side.

// `channelId: null` = every room — what the Automations destination asks for at All scope
// (2026-08-03). Each row carries its channel so the caller can tag it and narrow by project;
// the replica is workspace-wide, and a workspace's schedules are a handful of rows.
ipcMain.handle('nm:schedules', async (_e, { channelId }: { channelId: string | null }) => ({
  schedules: (await db().getAll<Record<string, unknown>>(
    // payload carries the drafting prompt (jsonb) — surface it + weekday so the editor can prefill
    // `s.workspace_id = ?` is load-bearing at the ALL scope, and the audit script cannot see it:
    // its heuristic accepts any `channel_id = ?`, but this one lives inside `(? is null or …)`
    // and switches OFF for `channelId = null` — which is precisely how the Automations
    // destination and the Calendar both read it. Without this, "every room" meant every room in
    // every workspace you belong to (0113). Found while fixing nm:content-all, 2026-08-13.
    `select s.id, s.title, s.cadence, s.at_time, s.tz, s.weekday, s.next_run_at, s.status, s.run_count, s.payload,
            s.channel_id, c.slug as channel_slug
       from schedules s left join channels c on c.id = s.channel_id
      where s.workspace_id = ? and (? is null or s.channel_id = ?) and s.status in ('active', 'paused')
      order by s.next_run_at`,
    [ws(), channelId ?? null, channelId ?? null],
  ).catch(() => [])).map((r) => {
    let prompt = '';
    try { prompt = (JSON.parse(String(r['payload'] ?? '{}')) as { prompt?: string }).prompt ?? ''; } catch { /* prompt stays '' */ }
    return { ...r, prompt };
  }),
}));
// content items (marketing-channel plan §4.7): the calendar reads the local replica;
// approve/unschedule ride api() (human actor), so guards + plan gates apply server-side.
//
// `last_error` rides every read here. The sync rule ships the whole row, but these selects
// ENUMERATE — so when the preview modal learned to show why a post failed (2026-08-18), the
// field it read was one no query supplied, and a failed post still said only "failed"
// (George, 2026-08-19). A column added to ContentItemRow must be added to all four selects.
ipcMain.handle('nm:content-items', async (_e, { channelId }: { channelId: string }) => ({
  items: await db().getAll(
    `select id, platform, body, media, status, last_error, scheduled_at, published_at, external_url, created_at, schedule_id, task_id from content_items where channel_id = ? order by coalesce(scheduled_at, created_at)`,
    [channelId],
  ).catch(() => []),
}));
// …and the WORKSPACE's content, for the Automations › Calendar destination.
//
// Every other reader here is anchored — one channel, one task, one thread — because until now
// the calendar was a tab inside a single marketing room. A destination cannot be: "what is my
// workspace publishing this week" is the question it exists to answer, and no query could ask
// it. The room comes back ON each row (its slug + its project) because at All scope a chip has
// no other way to say where it belongs, and the room is the ACL boundary the connector resolves
// through. Narrowing is the ScopeBar's job, in the renderer, so the filters stay visible and
// reversible rather than baked into the query the way the old channel scope was.
// "workspace-wide" means THIS workspace, and the replica holds every workspace you belong to
// (0113) — so the scope is `ci.workspace_id = WS`, not the absence of a WHERE clause. Caught by
// `scripts/audit-workspace-scope.mjs` in CI: without it the calendar would have shown another
// workspace's drafted posts, which is a tenant leak rather than a filter bug.
ipcMain.handle('nm:content-all', async () => ({
  items: await db().getAll(
    `select ci.id, ci.platform, ci.body, ci.media, ci.status, ci.last_error, ci.scheduled_at, ci.published_at,
            ci.external_url, ci.created_at, ci.schedule_id, ci.task_id,
            ci.channel_id, c.slug as channel_slug, c.project_id
       from content_items ci join channels c on c.id = ci.channel_id
      where ci.workspace_id = ?
      order by coalesce(ci.scheduled_at, ci.created_at)`,
    [ws()],
  ).catch(() => []),
}));
// a content task's drafts, rendered inline in its thread (marketing-workflow plan §4.5)
ipcMain.handle('nm:content-by-task', async (_e, { taskId }: { taskId: string }) => ({
  items: await db().getAll(
    `select id, platform, body, media, status, last_error, scheduled_at, published_at, external_url, created_at, schedule_id, task_id from content_items where task_id = ? order by created_at asc`,
    [taskId],
  ).catch(() => []),
}));
// …and a CONVERSATION's drafts (0115). Same columns, same order, so the one card strip both
// threads mount can't tell where its rows came from — which is the point: a drafted post is
// reviewable wherever it was written, with no board row standing behind it.
ipcMain.handle('nm:content-by-thread', async (_e, { threadId }: { threadId: string }) => ({
  items: await db().getAll(
    `select id, platform, body, media, status, last_error, scheduled_at, published_at, external_url, created_at, schedule_id, task_id from content_items where thread_id = ? order by created_at asc`,
    [threadId],
  ).catch(() => []),
}));
ipcMain.handle('nm:content-update', async (_e, { itemId, body, mediaUrl }: { itemId: string; body: string; mediaUrl?: string }) =>
  api('/v1/commands', { type: 'content.update', item: itemId, body, ...(mediaUrl === undefined ? {} : { mediaUrl }) }));
ipcMain.handle('nm:content-delete', async (_e, { itemId }: { itemId: string }) =>
  api('/v1/commands', { type: 'content.delete', item: itemId }));
ipcMain.handle('nm:content-approve', async (_e, { itemId, scheduledAt }: { itemId: string; scheduledAt?: string }) =>
  api('/v1/commands', { type: 'content.approve', item: itemId, scheduledAt }));
ipcMain.handle('nm:content-unschedule', async (_e, { itemId }: { itemId: string }) =>
  api('/v1/commands', { type: 'content.unschedule', item: itemId }));
// The image floor's button (docs/design/calendar-image-gen-2026-08): a direct call into the
// RUNNING host via the directacts slot — no thread detour, no marker message. Resolves when
// the draw lands (5–25s); the result carries the fresh thumb/body because the modal's item
// prop is a click-time snapshot. Never rejects: the modal renders {ok:false} reasons inline.
// the card's film: the bytes are too big for the synced row, so the renderer asks with the session
ipcMain.handle('nm:content-media', async (_e, { mediaId }: { mediaId: string }): Promise<string | null> => {
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) return null;
  const res = await fetch(`${apiUrl()}/v1/content/media/${mediaId}`, { headers: await apiAuthHeaders(apiUrl(), { kind: 'human', id: actorId() }) }).catch(() => null);
  if (!res?.ok) return null;
  const mime = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!;
  return `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
});
ipcMain.handle('nm:draft-image', async (_e, { itemId, angle, rewrite }: { itemId: string; angle?: string; rewrite?: boolean }) => {
  if (!directActs.draftImage) return { ok: false, error: HOST_NOT_RUNNING };
  return directActs.draftImage(itemId, { angle, rewrite }).catch((err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : 'that didn’t stick — try again' }));
});
// renderer CSP allows no remote img-src — main fetches the pasted media URL and hands
// back a data: URL (the project-logo path); null = the URL isn't a fetchable image.
ipcMain.handle('nm:media-preview', async (_e, { url }: { url: string }) => ({
  dataUrl: typeof url === 'string' ? await fetchImageDataUrl(url) : null,
}));
// THE ATTENTION BAR's one read (docs/design/failure-alerts-2026-08): three workspace-scoped
// row sets — dead-grant connectors, failing routines, failed posts — that the renderer folds
// with the pure deriveAlerts. Conditions live in the WHERE so a healthy workspace pays three
// index probes; `workspace_id = ?` on every branch (the replica holds every workspace you
// belong to, 0113 — audit-workspace-scope watches this file class).
ipcMain.handle('nm:alerts', async () => ({
  connectors: await db().getAll(
    `select k.id, k.provider, k.handle, k.status, k.project_id, p.name as project_name,
            (select c2.id from channels c2 where c2.project_id = k.project_id order by c2.created_at asc limit 1) as channel_id
       from connectors k left join projects p on p.id = k.project_id
      where k.workspace_id = ? and k.status = 'reauth_required'`,
    [ws()],
  ).catch(() => []),
  schedules: await db().getAll(
    `select s.id, s.title, s.status, s.last_error, s.last_run_at, s.channel_id,
            c.slug as channel_slug, c.project_id, p.name as project_name
       from schedules s join channels c on c.id = s.channel_id left join projects p on p.id = c.project_id
      where s.workspace_id = ? and s.status = 'active' and s.last_error is not null`,
    [ws()],
  ).catch(() => []),
  posts: await db().getAll(
    `select ci.id, ci.platform, ci.status, ci.last_error, ci.scheduled_at, ci.channel_id,
            c.slug as channel_slug, c.project_id, p.name as project_name
       from content_items ci join channels c on c.id = ci.channel_id left join projects p on p.id = c.project_id
      where ci.workspace_id = ? and ci.status = 'failed'
      -- newest slot first: a group's card speaks with its FIRST row's reason, and the newest
      -- failure is the live truth (a week-old refresh error atop today's scope error misled)
      order by ci.scheduled_at desc`,
    [ws()],
  ).catch(() => []),
}));
// connectors (marketing-channel plan §4.8): Connect opens the OAuth round-trip in the
// EXTERNAL browser (the billing-checkout pattern); status arrives via the synced row.
ipcMain.handle('nm:connector-start', async (_e, { channelId, provider }: { channelId: string; provider?: string }) => {
  const [ch] = await db().getAll<{ workspace_id: string }>(`select workspace_id from channels where id = ? limit 1`, [channelId]).catch(() => [] as Array<{ workspace_id: string }>);
  if (!ch) return { ok: false };
  const url = `${apiUrl()}/connect/${encodeURIComponent(provider ?? 'x')}/start?workspace=${encodeURIComponent(ch.workspace_id)}&channel=${encodeURIComponent(channelId)}&actor=${encodeURIComponent(actorId())}`;
  void shell.openExternal(url);
  return { ok: true };
});
// A connector is per PROJECT (0106) — two products do not share an X handle. This was
// unfiltered, and the table was workspace-unique besides, so a brand-new project's marketing
// setup showed another project's account as already connected (George, 2026-08-02).
// Scoped by the CHANNEL you are asking from, resolved to its project, so the caller never has
// to know the project id. Fail closed: no channel, no connectors.
ipcMain.handle('nm:connectors', async (_e, arg?: { channelId?: string }) => ({
  connectors: arg?.channelId
    ? await db().getAll(
        `select k.id, k.provider, k.handle, k.status from connectors k
           join channels c on c.id = ? and c.project_id = k.project_id
          order by k.provider`,
        [arg.channelId],
      ).catch(() => [])
    : [],
}));
ipcMain.handle('nm:connector-disconnect', async (_e, { connectorId }: { connectorId: string }) =>
  api('/v1/commands', { type: 'connector.disconnect', connector: connectorId }));
}
