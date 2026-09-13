// Board watches: tasks, artifacts, beats, runs and the library — extracted from sync.ts (track B-sync).
//
// A watch is a SUBSCRIPTION: it registers an abort handle in startSync's `watchers` registry so
// the renderer's unsubscribe can find it. That registry is why these take deps rather than
// owning anything — the lifetime belongs to the session, not to this module.
import { ipcMain, type WebContents } from 'electron';
import type { WatchDeps } from './watchdeps';

/** every task in a workspace — the row a task-thread's rail row is built from. Shared with the rail's union (watch-rail.ts). */
export const TASKS_ALL_SQL = `select t.id, t.number, t.title, t.description, t.state, t.kind, t.assignee_kind, t.assignee_id, t.offered_agent_id,
              t.requirements, t.requirements_confirmed, t.definition_of_done, t.project_id, t.branch, t.channel_id,
              t.repo_id, t.submitted_sha, t.pr_url, t.pr_number, t.artifact_count, t.ship_plan, t.parent_task_id, t.work_plan, t.origin_thread_id, t.plan_approved_at, t.created_at, t.updated_at,
              t.claimed_at, t.submitted_at, t.approved_at, t.accepted_at, t.closed_at, c.slug as channel_slug,
              -- who holds the ball (needsyou.ts): a human reply NEWER than the gate transition
              -- means you already answered and the task is waiting on an agent, not on you.
              -- A SUBTASK counts its PARENT's thread too: companion work folds under its parent
              -- (docs/24), so that is the thread the human is actually typing in — looking only
              -- at the subtask's own row meant an answer given in the obvious place never
              -- registered as an answer at all.
              (select max(m.created_at) from messages m
                where m.author_kind = 'human'
                  and (m.task_id = t.id or (t.parent_task_id is not null and m.task_id = t.parent_task_id))) as last_human_msg_at,
              -- the task's thread (thread-per-task) and its settle stamp (0137): a settle newer than the
              -- gate takes the row out of the bell; the thread id is what Settle acts on
              (select th.id from threads th where th.task_id = t.id order by th.created_at limit 1) as thread_id,
              (select th.settled_at from threads th where th.task_id = t.id order by th.created_at limit 1) as settled_at
       from tasks t join channels c on c.id = t.channel_id
       where t.workspace_id = ? order by t.number desc`;

/** the workspace's running runs — the rail's live pulse. Shared with the rail's union (watch-rail.ts). */
export const OPEN_RUNS_SQL = `select r.id, r.channel_id, r.thread_id, r.task_id, r.agent_id, r.parent_run_id, r.kind, r.title, r.state, r.step, r.seat,
              r.done, r.total, r.summary, r.started_at, r.ended_at, r.updated_at, r.machine_id, m.name as machine_name
       from runs r left join machines m on m.id = r.machine_id
       where r.workspace_id = ? and r.state = 'running' order by r.started_at asc`;

/** every decision card in a workspace — the rail's ask dot. Shared with the rail's union (watch-rail.ts). */
export const DECISIONS_ALL_SQL = `select d.id, d.channel_id, d.task_id, d.message_id, d.asker_kind, d.asker_id, d.question, d.options,
              d.allow_other, d.status, d.answer, d.created_at, d.answered_at, c.slug as channel_slug, t.number as task_number,
              -- the thread the asking message lives in, so a task-less decision ROW can open the
              -- conversation it was asked in (needs-you rows, 2026-08-07 — answering is the
              -- thread's job now, so every row must be able to reach its thread)
              (select m2.thread_id from messages m2 where m2.id = d.message_id) as thread_id,
              -- the newest human message in this card's OWN conversation (its task thread, else
              -- the room it was asked in): a free-text card answered in prose is already handled,
              -- so Home must stop asking (needsyou.ts — strict-choice cards are exempt there)
              -- …and a card hung on a SUBTASK counts the parent's thread as well, for the same
              -- reason the task watch above does: that is where the conversation is.
              (select max(m.created_at) from messages m
                where m.author_kind = 'human'
                  and (case when d.task_id is null then m.channel_id = d.channel_id and m.task_id is null
                            else m.task_id = d.task_id
                                 or m.task_id = (select st.parent_task_id from tasks st where st.id = d.task_id)
                            end)) as human_replied_at,
              -- the settle stamps a card can sit under (0137): its own conversation's, and its task's thread's
              (select th.settled_at from threads th where th.id = (select m3.thread_id from messages m3 where m3.id = d.message_id)) as thread_settled_at,
              (select th.id from threads th where th.task_id = d.task_id order by th.created_at limit 1) as task_thread_id,
              (select th.settled_at from threads th where th.task_id = d.task_id order by th.created_at limit 1) as task_settled_at
       from decisions d join channels c on c.id = d.channel_id left join tasks t on t.id = d.task_id
       where d.workspace_id = ? order by d.created_at desc`;

export function registerBoardWatches(d: WatchDeps): void {
const { db, watchers, watchFailed, ws } = d;
  ipcMain.handle('nm:watch-tasks', (event, { subId, channelId }: { subId: string; channelId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    console.log(`ipc_probe=watch-tasks channel=${channelId.slice(0, 8)}`);
    const sender: WebContents = event.sender;
    db().watch(
      `select id, number, title, description, state, kind, assignee_kind, assignee_id, offered_agent_id, requirements, requirements_confirmed, definition_of_done, project_id, channel_id, branch, repo_id, submitted_sha, pr_url, pr_number, artifact_count, ship_plan, parent_task_id, work_plan, origin_thread_id, plan_approved_at, created_at, updated_at, claimed_at, submitted_at, approved_at, accepted_at, closed_at from tasks
       where channel_id = ? order by number desc`,
      [channelId],
      {
        onResult: (r) => {
          if (!sender.isDestroyed()) sender.send('nm:tasks', { subId, rows: (r.rows?._array ?? []) as unknown[] });
        },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
  ipcMain.handle('nm:watch-artifacts', (event, { subId, taskId }: { subId: string; taskId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      `select id, kind, name, inline_content, promoted, created_at from artifacts
       where task_id = ? order by created_at asc`,
      [taskId],
      {
        onResult: (r) => {
          if (!sender.isDestroyed()) sender.send('nm:artifacts', { subId, rows: (r.rows?._array ?? []) as unknown[] });
        },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
  // Beats (docs/17): the open task's per-phase progress steps, for the thread tracker.
  ipcMain.handle('nm:watch-beats', (event, { subId, taskId }: { subId: string; taskId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      `select id, run_id, phase, role, seq, title, status, started_at, done_at, created_at from beats
       where task_id = ? order by created_at asc, seq asc`,
      [taskId],
      {
        onResult: (r) => { if (!sender.isDestroyed()) sender.send('nm:beats', { subId, rows: (r.rows?._array ?? []) as unknown[] }); },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
  // Runs (docs/29): every run that touched this room, newest first — the renderer picks the
  // ones for the open surface and hangs each parent's legs off it. Bounded: a room's history
  // of runs is unbounded, the card only ever shows the recent ones.
  ipcMain.handle('nm:watch-runs', (event, { subId, channelId }: { subId: string; channelId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      // `machine_name` (0114): WHOSE machine served this run. Under shared compute an agent is a
      // workspace-level resource that runs on members' own machines, so "who is doing this" is
      // only half the answer — the other half is where, and on whose subscription.
      `select r.id, r.channel_id, r.thread_id, r.task_id, r.agent_id, r.parent_run_id, r.kind, r.title, r.state, r.step, r.seat,
              r.done, r.total, r.summary, r.started_at, r.ended_at, r.updated_at, r.machine_id, m.name as machine_name
       from runs r left join machines m on m.id = r.machine_id
       where r.channel_id = ? order by r.started_at desc limit 80`,
      [channelId],
      { onResult: (r) => { if (!sender.isDestroyed()) sender.send('nm:runs', { subId, rows: (r.rows?._array ?? []) as unknown[] }); }, onError: watchFailed },
      { signal: ac.signal },
    );
  });
  // every OPEN run in the workspace — what the rail reads so "standing by" can stop being a lie
  ipcMain.handle('nm:watch-open-runs', (event, { subId }: { subId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      OPEN_RUNS_SQL,
      [ws()],
      { onResult: (r) => { if (!sender.isDestroyed()) sender.send('nm:open-runs', { subId, rows: (r.rows?._array ?? []) as unknown[] }); }, onError: watchFailed },
      { signal: ac.signal },
    );
  });
  ipcMain.handle('nm:watch-library', (event, { subId, channelId }: { subId: string; channelId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      `select a.id, a.kind, a.name, a.inline_content, a.created_at, t.number as task_number
       from artifacts a left join tasks t on t.id = a.task_id
       where a.channel_id = ? and a.promoted = 1 order by a.created_at desc`,
      [channelId],
      {
        onResult: (r) => {
          if (!sender.isDestroyed()) sender.send('nm:library', { subId, rows: (r.rows?._array ?? []) as unknown[] });
        },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
  // journey evidence (docs/24, the phase spectrum): which tasks carry a design
  // round / an implementation plan — routing history the bar derives legs from.
  ipcMain.handle('nm:watch-journey', async (event, { subId }: { subId: string }) => {
    const sender: WebContents = event.sender;
    db().watch(
      `select task_id,
              max(case when kind = 'design' then 1 else 0 end) as has_design,
              max(case when kind = 'doc' and name like 'implementation-plan%' then 1 else 0 end) as has_plan
       from artifacts where workspace_id = ? and task_id is not null group by task_id`,
      [ws()],
      {
        onResult: (r) => { if (!sender.isDestroyed()) sender.send('nm:journey', { subId, rows: r.rows?._array ?? [] }); },
        onError: watchFailed,
      },
    );
    return { subId };
  });
  ipcMain.handle('nm:watch-tasks-all', (event, { subId }: { subId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      TASKS_ALL_SQL,
      [ws()],
      {
        onResult: (r) => {
          if (!sender.isDestroyed()) sender.send('nm:tasks-all', { subId, rows: (r.rows?._array ?? []) as unknown[] });
        },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
  ipcMain.handle('nm:watch-decisions-all', (event, { subId }: { subId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    db().watch(
      DECISIONS_ALL_SQL,
      [ws()],
      {
        onResult: (r) => {
          if (!sender.isDestroyed()) sender.send('nm:decisions-all', { subId, rows: (r.rows?._array ?? []) as unknown[] });
        },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
  ipcMain.handle('nm:watch-library-all', (event, { subId }: { subId: string }) => {
    const ac = new AbortController();
    watchers.set(subId, ac);
    const sender: WebContents = event.sender;
    // `and a.promoted = 1` used to live here, and it made the destination lie. `promoted`
    // defaults false and only artifact.promote flips it — reachable ONLY through a doc-drop
    // card's Approve button — so every row written straight by artifact.create (the marketing
    // bootstrap's brand docs, above all) was unreachable from this surface forever, while three
    // other surfaces and the agents' own list_library showed it. Curation is now a MARKER the
    // row carries (★) and a filter the human chooses, not the condition of existing.
    db().watch(
      `select a.id, a.kind, a.name, a.mime, a.inline_content, a.size_bytes, a.promoted, a.task_id, a.created_at,
              t.number as task_number, c.slug as channel_slug, c.id as channel_id, c.project_id
       from artifacts a left join tasks t on t.id = a.task_id join channels c on c.id = a.channel_id
       where a.workspace_id = ? and a.message_id is null order by a.created_at desc`,
      [ws()],
      {
        onResult: (r) => {
          if (!sender.isDestroyed()) sender.send('nm:library-all', { subId, rows: (r.rows?._array ?? []) as unknown[] });
        },
        onError: watchFailed,
      },
      { signal: ac.signal },
    );
  });
}
