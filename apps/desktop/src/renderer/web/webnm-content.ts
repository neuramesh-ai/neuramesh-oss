// THE BROWSER'S CONTENT, LIBRARY, SKILLS, SCHEDULES AND WHITEBOARD LANES.
//
// One export, `contentOverrides`, carries the whole tranche — the library/skills/whiteboard half
// lives in webnm-shelf.ts only because a new file faces a 250-line cap, and is spread back in here
// so main.tsx wires one thing.
//
// Same ruling as webnm-rooms/webnm-convo: these are PORTS, not new behaviour. Every read below is
// the SQL its desktop IPC handler runs, against the replica the browser already syncs; every write
// is the one command that handler posts. Where the desktop reads WS from module state, the web
// reads it from cfg — that, and the absence of an IPC hop, is the whole difference.
//
// Why it matters that they were absent: an unwired method resolves webnm.ts's inert EMPTY proxy,
// which IS an array. So `(await nm.contentItems(ch)).items.length` answered 0, `nm.schedules(null)`
// answered "no automations", the Skills destination drew its empty state and Workspace Files drew a
// workspace with no files — on a workspace holding 83 artifacts, 195 skills and 13 armed schedules.
// Nothing was missing but the questions.
//
// Four rules both files are written to, each one a bug that has already been paid for:
//
//  · a READ that fails says so and THEN yields empty (orEmpty). An empty list that silently means
//    "broken" is indistinguishable from an empty workspace, which is the exact lie these lanes
//    exist to end.
//  · a WRITE lets postCommand throw. The server's refusal — HUMAN_ONLY, PLAN_LIMIT, a stale rev —
//    is the thing the human needs to read, and a `.catch(() => {})` deletes it. The one exception
//    is wbUpdateCmd, which returns the verdict because a lost rev race is an expected outcome.
//  · the export is Partial<NMBridge>, never Record<string, unknown>. The overrides go through a
//    proxy, so an untyped bag typechecks whatever it contains and fails only in use — `send` is
//    positional and was first written taking an options object, which would have posted `undefined`
//    as every message body and compiled cleanly. (It earned its keep here too: `artifact` returned
//    a widened `{}` from a bare orEmpty, and only the contract caught it.)
//  · no image ever crosses these lanes as base64 we invented. What syncs on a row (an artifact's
//    inline_content, a draft's 640px thumb) is what the surface renders; mediaPreview answers with
//    the URL it probed, never with bytes it fetched.
import type { PowerSyncDatabase } from '@powersync/web';
import type { NMBridge } from '../src/bridge/nm';
import type { ConnectorRow, ContentItemRow, ContentItemWide, ScheduleRow, ScheduleRunRow } from '../src/bridge/rows-content';
import { orEmpty, shelfOverrides } from './webnm-shelf';
import { insertMessage } from './webnm-convo';
import { postCommand, type WebNmConfig } from './webnm';

/** ported from sync/ipc/content.ts — the calendar's atoms and the four human moves on them */
function contentLanes(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  const ws = () => cfg.workspaceId();
  return {
    // `last_error` rides every read here. The sync rule ships the whole row, but these selects
    // ENUMERATE — so a column added to ContentItemRow must be added to all four, or a failed post
    // says only "failed" (the 2026-08-19 bug). Copied column-for-column for that reason.
    contentItems: async (channelId: string) => ({
      items: await db.getAll<ContentItemRow>(
        `select id, platform, body, media, status, last_error, scheduled_at, published_at, external_url, created_at, schedule_id, task_id from content_items where channel_id = ? order by coalesce(scheduled_at, created_at)`,
        [channelId],
      ).catch(orEmpty('contentItems')),
    }),

    // …and the WORKSPACE's content, for the Automations › Calendar destination. "Workspace-wide"
    // means THIS workspace: the replica holds every workspace you belong to (0113), so the scope is
    // `ci.workspace_id = ?` and not the absence of a WHERE clause. Narrowing is the ScopeBar's job
    // in the renderer, which is why the room rides each row rather than the query.
    contentAll: async () => ({
      items: await db.getAll<ContentItemWide>(
        `select ci.id, ci.platform, ci.body, ci.media, ci.status, ci.last_error, ci.scheduled_at, ci.published_at,
                ci.external_url, ci.created_at, ci.schedule_id, ci.task_id,
                ci.channel_id, c.slug as channel_slug, c.project_id
           from content_items ci join channels c on c.id = ci.channel_id
          where ci.workspace_id = ?
          order by coalesce(ci.scheduled_at, ci.created_at)`,
        [ws()],
      ).catch(orEmpty('contentAll')),
    }),

    // a content task's drafts, rendered inline in its thread (marketing-workflow plan §4.5)
    contentByTask: async (taskId: string) => ({
      items: await db.getAll<ContentItemRow>(
        `select id, platform, body, media, status, last_error, scheduled_at, published_at, external_url, created_at, schedule_id, task_id from content_items where task_id = ? order by created_at asc`,
        [taskId],
      ).catch(orEmpty('contentByTask')),
    }),

    // …and a CONVERSATION's drafts (0115). Same columns, same order, so the one card strip both
    // threads mount cannot tell where its rows came from — which is the point.
    contentByThread: async (threadId: string) => ({
      items: await db.getAll<ContentItemRow>(
        `select id, platform, body, media, status, last_error, scheduled_at, published_at, external_url, created_at, schedule_id, task_id from content_items where thread_id = ? order by created_at asc`,
        [threadId],
      ).catch(orEmpty('contentByThread')),
    }),

    // The calendar's four human moves. Every one is HUMAN_ONLY server-side (agents draft, humans
    // publish) — so the refusal is the whole product rule, and it must reach the caller intact.
    contentUpdate: async (itemId: string, body: string, mediaUrl?: string) => {
      await postCommand(cfg, { type: 'content.update', item: itemId, body, ...(mediaUrl === undefined ? {} : { mediaUrl }) });
      return { ok: true };
    },
    contentDelete: async (itemId: string) => {
      await postCommand(cfg, { type: 'content.delete', item: itemId });
      return { ok: true };
    },
    contentApprove: async (itemId: string, scheduledAt?: string) => {
      await postCommand(cfg, { type: 'content.approve', item: itemId, scheduledAt });
      return { ok: true };
    },
    contentUnschedule: async (itemId: string) => {
      await postCommand(cfg, { type: 'content.unschedule', item: itemId });
      return { ok: true };
    },

    /**
     * FROM A TAB THE PICTURE IS ASKED FOR, NOT DRAWN (George, 2026-09-05: "a bug on the web app when I
     * try to generate an image from a scheduled draft"). The desktop's nm:draft-image is a direct call
     * into the agent host in its own process; a tab has no host — but the member's cloud machine runs
     * the same one, and the path that already reaches it from anywhere is the card's own: a message
     * carrying ‹gen-image:<item>› in the draft's thread, which whichever machine wakes for that thread
     * answers by drawing onto the card (host/wake.ts, no model turn). So Generate posts the marker; a
     * rewrite (with or without an angle) posts the ask in words, which the marketer's revise turn
     * answers with revise_posts and a redraw. The row syncs back with the picture, and the modal says
     * "drawing on your cloud machine" while it waits — the earlier "open the desktop app" refusal was
     * written before the browser had a machine of its own. Only a draft can be redrawn, as on the desktop.
     */
    draftImage: async (itemId: string, opts?: { angle?: string; rewrite?: boolean }) => {
      type DraftRow = { status: string; platform: string; body: string; channel_id: string; thread_id: string | null; task_id: string | null };
      const [d] = (await db.getAll<DraftRow>(`select status, platform, body, channel_id, thread_id, task_id from content_items where id = ?`, [itemId]).catch(orEmpty('draftImage'))) as DraftRow[];
      if (!d) return { ok: false, error: 'that draft isn’t available (already scheduled or gone)' };
      if (d.status !== 'draft') return { ok: false, error: 'only a draft can be redrawn — unschedule it first' };
      const taskThread = d.task_id ? ((await db.getAll<{ id: string }>(`select id from threads where task_id = ? limit 1`, [d.task_id]).catch(orEmpty('draftImage'))) as Array<{ id: string }>)[0]?.id ?? null : null;
      const threadId = d.thread_id ?? taskThread;
      if (!threadId) return { ok: false, error: 'this draft has no conversation to ask in — open it from the thread that made it' };
      const ask = opts?.rewrite
        ? `Rewrite the ${d.platform} draft that begins “${d.body.slice(0, 60).trim()}…”${opts.angle ? ` with this angle: ${opts.angle}` : ''}, then redraw its image.`
        : `Generate the image for this draft.‹gen-image:${itemId}›`;
      await insertMessage(db, cfg, d.channel_id, ask, { threadId });
      return { ok: true, pending: true };
    },

    /**
     * CAN THIS PAGE RENDER THAT URL? — which is the question the preview modal is actually asking.
     *
     * The desktop fetches the URL in main and hands back a data: URL, because the renderer's CSP
     * forbids remote img-src. A tab has neither problem nor that cure: it cannot fetch a
     * cross-origin image at all (no CORS headers ⇒ the request dies before a status, and the catch
     * would invent a reason), and it does not need to — an <img> can load one directly. So the probe
     * IS the answer: load it as an image, and hand back the URL the caller can then render. No bytes
     * cross this lane.
     *
     * Honest limit: this page is crossOriginIsolated (COEP require-corp, for OPFS), so a host that
     * sends no Cross-Origin-Resource-Policy fails the probe. That is not a false negative — the page
     * genuinely cannot display it, and "broken" is the true answer for this client.
     */
    mediaPreview: (url: string) =>
      new Promise<{ dataUrl: string | null }>((resolve) => {
        if (!/^https?:\/\/\S+$/i.test(url)) { resolve({ dataUrl: null }); return; }
        const img = new Image();
        let settled = false;
        const done = (ok: boolean) => {
          if (settled) return;
          settled = true;
          img.onload = null;
          img.onerror = null;
          resolve({ dataUrl: ok ? url : null });
        };
        // the desktop's fetch is timeboxed at 8s; a hung image gets the same budget
        const timer = setTimeout(() => done(false), 8_000);
        img.onload = () => { clearTimeout(timer); done(true); };
        img.onerror = () => { clearTimeout(timer); done(false); };
        img.src = url;
      }),
  };
}

/** ported from sync/ipc/content.ts — routines, their run history, and arming one */
function scheduleLanes(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  const ws = () => cfg.workspaceId();
  return {
    // `channelId: null` = every room, what the Automations destination asks for at All scope.
    // `s.workspace_id = ?` is load-bearing precisely THERE: the channel filter lives inside
    // `(? is null or …)` and switches off, so without the workspace clause "every room" would mean
    // every room in every workspace you belong to.
    schedules: async (channelId: string | null) => ({
      schedules: (await db.getAll<Record<string, unknown>>(
        `select s.id, s.title, s.cadence, s.at_time, s.tz, s.weekday, s.next_run_at, s.status, s.run_count, s.payload,
                s.channel_id, c.slug as channel_slug
           from schedules s left join channels c on c.id = s.channel_id
          where s.workspace_id = ? and (? is null or s.channel_id = ?) and s.status in ('active', 'paused')
          order by s.next_run_at`,
        [ws(), channelId ?? null, channelId ?? null],
      ).catch(orEmpty<Record<string, unknown>>('schedules'))).map((r) => {
        // the drafting prompt lives in the jsonb payload — surfaced so the editor can prefill
        let prompt = '';
        try { prompt = (JSON.parse(String(r['payload'] ?? '{}')) as { prompt?: string }).prompt ?? ''; } catch { /* prompt stays '' */ }
        return { ...r, prompt } as unknown as ScheduleRow;
      }),
    }),

    // An automation's RUN HISTORY (0119): every routine fire opens its own conversation, so the runs
    // already exist — this is the join that finds them. Capped like the desktop's: the card reveals
    // recent runs, not an archive.
    scheduleRuns: async (scheduleId: string, limit?: number) => ({
      runs: await db.getAll<ScheduleRunRow>(
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
      ).catch(orEmpty('scheduleRuns')),
    }),

    // Arming, editing and retiring one. All four are HUMAN_ONLY server-side, and schedule.create is
    // the branch a Free plan 402s on — which is why the throw must survive: the upgrade flow is the
    // caller's reaction to that error, not something this layer can invent.
    scheduleCreate: async (p) => {
      const r = (await postCommand(cfg, {
        type: 'schedule.create', channel: p.channelId, title: p.title, prompt: p.prompt, cadence: p.cadence,
        atTime: p.atTime, tz: p.tz, weekday: p.weekday, runAt: p.runAt, routine: p.routine,
      })) as { scheduleId?: string; nextRunAt?: string };
      // a create that produced no id is a failure the caller must see, not a blank card
      if (!r.scheduleId) throw new Error('schedule.create returned no schedule id');
      return { ok: true, scheduleId: r.scheduleId, nextRunAt: r.nextRunAt ?? '' };
    },
    scheduleUpdate: async (p) => {
      const r = (await postCommand(cfg, {
        type: 'schedule.update', schedule: p.scheduleId, title: p.title, prompt: p.prompt, cadence: p.cadence,
        atTime: p.atTime, tz: p.tz, weekday: p.weekday, runAt: p.runAt,
      })) as { nextRunAt?: string };
      return { ok: true, nextRunAt: r.nextRunAt ?? '' };
    },
    scheduleStatus: async (scheduleId: string, status: 'active' | 'paused') => {
      await postCommand(cfg, { type: 'schedule.set_status', schedule: scheduleId, status });
      return { ok: true };
    },
    scheduleDelete: async (scheduleId: string) => {
      await postCommand(cfg, { type: 'schedule.delete', schedule: scheduleId });
      return { ok: true };
    },
  };
}

/** ported from sync/ipc/content.ts (connectors, alerts) and sync/ipc/projects.ts (the setup flow) */
function connectorLanes(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  return {
    // alerts intentionally NOT here — webnm-board.ts owns it, and two copies of three queries is two chances to drift

    // A connector is per PROJECT (0106) — two products do not share an X handle — and it is scoped
    // by the CHANNEL you are asking from, resolved to its project, so the caller never has to know
    // the project id. Fail closed: no channel, no connectors.
    connectors: async (channelId?: string) => ({
      connectors: channelId
        ? await db.getAll<ConnectorRow>(
            `select k.id, k.provider, k.handle, k.status from connectors k
               join channels c on c.id = ? and c.project_id = k.project_id
              order by k.provider`,
            [channelId],
          ).catch(orEmpty('connectors'))
        : [],
    }),

    /**
     * Connect is an OAuth round-trip the SERVER owns; the client only sends the human to it. The
     * desktop opens the URL in the external browser — here the browser IS the external browser.
     *
     * THE TAB IS OPENED BEFORE THE AWAIT, blank, and only then pointed at the URL. A browser grants
     * window.open on the USER ACTIVATION of the click that called this, and that activation does not
     * survive an await — opening after the replica lookup would be blocked by every popup blocker on
     * the paved path, and only on the paved path, which is the worst kind of bug to ship. (Also no
     * 'noopener': it makes window.open return null unconditionally, so the blocked check could never
     * be read.) The lookup still happens, because the replica holds every workspace you belong to
     * and the room's OWN workspace is what the round trip must carry.
     *
     * DEV-HARNESS CAVEAT, stated rather than papered over: /connect is not one of the paths the vite
     * dev proxy forwards (only /v1 and /auth), so with an empty VITE_NM_API_URL this URL is
     * same-origin and 404s. A deployed bundle sets a real API base and the link resolves.
     */
    connectorStart: async (channelId: string, provider?: 'x' | 'linkedin' | 'instagram' | 'tiktok') => {
      const win = window.open('', '_blank');
      const [ch] = await db.getAll<{ workspace_id: string }>('select workspace_id from channels where id = ? limit 1', [channelId])
        .catch(orEmpty<{ workspace_id: string }>('connectorStart.channel'));
      if (!ch) { win?.close(); return { ok: false }; }
      const url = `${cfg.apiUrl}/connect/${encodeURIComponent(provider ?? 'x')}/start?workspace=${encodeURIComponent(ch.workspace_id)}&channel=${encodeURIComponent(channelId)}&actor=${encodeURIComponent(cfg.actorId())}`;
      if (!win) { console.error('[webnm] connectorStart: the browser blocked the connect tab'); return { ok: false }; }
      try { win.opener = null; } catch { /* already severed */ }
      win.location.href = url;
      return { ok: true };
    },

    connectorDisconnect: async (connectorId: string) => {
      await postCommand(cfg, { type: 'connector.disconnect', connector: connectorId });
      return { ok: true };
    },

    // Point a marketing room at the product. Writes the profile onto channels.marketing and fans out
    // the bootstrap through the ordinary path; stamping setup_at is what every surface gate reads
    // (docs/39 — "ran to the end", never presence).
    marketingSetup: async (channelId: string, website: string, focus: string[], goal?: string) => {
      const r = (await postCommand(cfg, {
        type: 'marketing.setup', channel: channelId,
        website: website || undefined, focus: focus.length ? focus : undefined, goal: goal || undefined,
      })) as { threadId?: string; taskId?: string };
      return { ok: true, channelId, threadId: r.threadId, taskId: r.taskId };
    },

    // one answered setup-flow step (shared/setupflows.ts) — persisted as it lands so the wizard
    // resumes. Wired alongside marketingSetup because without it an abandoned browser wizard has
    // nothing to come back to.
    setupStep: async (channelId: string, flow: string, step: string, value?: string | string[]) => {
      await postCommand(cfg, { type: 'setup.step', channel: channelId, flow, step, value });
      return { ok: true };
    },

    // The MCP integration toggles. The toggle syncs on the room; the credential behind it stays
    // MACHINE-LOCAL (mcp-keys.json) and never leaves the machine that holds it — so a browser can
    // arm the switch and can never supply the key. nm.mcpKeys/mcpKeySet stay unwired for that
    // reason, and they are honest about it by staying absent.
    marketingIntegration: async (channelId: string, provider: 'posthog' | 'meta' | 'tiktok', enabled: boolean) => {
      await postCommand(cfg, { type: 'marketing.set_integration', channel: channelId, provider, enabled });
      return { ok: true };
    },
  };
}

export function contentOverrides(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  return {
    ...shelfOverrides(cfg, db),
    ...contentLanes(cfg, db),
    ...scheduleLanes(cfg, db),
    ...connectorLanes(cfg, db),
  };
}
