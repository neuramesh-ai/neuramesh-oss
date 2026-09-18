// THE BROWSER'S BOARD, THREADS AND ACTIVITY — the third leg of the web bridge.
//
// webnm-rooms wired the room list, webnm-convo the conversation. What was still missing is
// everything a piece of WORK is made of: the board's tasks, a room's thread history, a task's own
// thread with its beats and its deliverables, the runs that are live right now, the decision cards
// waiting on a human, a room's papertrail, and the attention bar's three failure sets.
//
// Left unwired those all answered with the warn-once proxy's empty, which is indistinguishable
// from a real empty on every one of these surfaces: an empty board, a session list with no
// sessions, a task thread with no messages, a tracker with no beats, a task with no files, a rail
// permanently "standing by", a needs-you queue that never asked anything, and an attention bar
// that could not raise a dead connector. A workspace with 700 messages and real tasks read as a
// workspace where nothing had ever happened.
//
// Ports, not new behaviour: the SAME SQL the desktop's IPC handlers run — sync/ipc/watch-board.ts,
// watch-rooms.ts, agents.ts, content.ts — against the same replica this client already syncs.
// Where the desktop reads `WS` from module state, the web reads it from cfg; that is the whole
// difference. Each query is copied from its handler verbatim, SQL comments included, so the two
// clients can be diffed line for line and drift has an address.
//
// ONE lane here is not a replica question at all: `taskDetail` is an HTTP GET of /v1/tasks/{id},
// because a task's EVENT LOG is server truth and is deliberately outside the sync publication —
// there is no local row to watch, on any client.
import type { PowerSyncDatabase } from '@powersync/web';
import type { AlertConnectorRow, AlertPostRow, AlertScheduleRow } from '@neuramesh/shared';
import type { NMBridge } from '../src/bridge/nm';
import type { ChannelHistoryRow, ChannelPersonRow, MessageRow, ThreadRow } from '../src/bridge/rows-rooms';
import type { ArtifactUI, BeatUI, DecisionAllRow, RunUI, TaskAllRow, TaskRow } from '../src/bridge/rows-board';
import { authHeaders, type WebNmConfig } from './webnm';

/** a live query: run it, then re-run whenever one of `tables` changes. mirrors db.watch's
 *  contract for the renderer, minus the IPC hop the desktop needs. Duplicated from
 *  webnm-convo.ts rather than shared, the same way `orEmpty` already is: a lane file stands
 *  alone, and these are being written in parallel. */
function watch<T>(db: PowerSyncDatabase, tables: string[], run: () => Promise<T[]>, cb: (rows: T[]) => void): () => void {
  let live = true;
  const push = () => {
    if (!live) return;
    // a failed read leaves the last good rows standing rather than blanking the surface
    void run().then((rows) => { if (live) cb(rows); }).catch((e: unknown) => { console.error('[webnm] watch read failed:', e); });
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

// ── the queries, copied from their handlers ───────────────────────────────────────────────────

// sync/ipc/watch-board.ts nm:watch-tasks — one room's board, newest number first.
const TASKS_SQL = `select id, number, title, description, state, kind, assignee_kind, assignee_id, offered_agent_id, requirements, requirements_confirmed, definition_of_done, project_id, channel_id, branch, repo_id, submitted_sha, pr_url, pr_number, artifact_count, ship_plan, parent_task_id, work_plan, origin_thread_id, plan_approved_at, created_at, updated_at, claimed_at, submitted_at, approved_at, accepted_at, closed_at from tasks
       where channel_id = ? order by number desc`;

// sync/ipc/watch-board.ts nm:watch-tasks-all — every task in the workspace, with the channel slug
// and the who-holds-the-ball column the needs-you queue derives from.
const TASKS_ALL_SQL = `select t.id, t.number, t.title, t.description, t.state, t.kind, t.assignee_kind, t.assignee_id, t.offered_agent_id,
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

// sync/ipc/watch-rooms.ts nm:watch-threads — the active channel's session list, freshest first,
// with the last-line snippet each row reads.
const THREADS_SQL = `select t.id, t.title, t.description, t.created_by, t.task_id, t.created_at, t.updated_at, t.root_message_id, t.mode, t.brain_override, t.schedule_id,
              (select count(*) from messages m where m.thread_id = t.id) as msg_count,
              (select m.body from messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_body,
              (select m.body from messages m where m.id = t.root_message_id) as root_body,
              (select m.author_kind from messages m where m.id = t.root_message_id) as root_author_kind,
              (select m.author_id from messages m where m.id = t.root_message_id) as root_author_id,
              (select m.created_at from messages m where m.id = t.root_message_id) as root_at
         from threads t where t.channel_id = ? and t.archived_at is null order by t.updated_at desc limit 120`;

// sync/ipc/watch-rooms.ts nm:watch-messages — the room's OWN messages. A thread's replies belong
// to the thread; a thread's ROOT is the exception, and `root_thread_id` is what says so.
const MESSAGES_SQL = `select m.id, m.author_kind, m.author_id, m.body, m.created_at, m.pinned, m.task_id,
              m.thread_id, rt.id as root_thread_id
         from messages m
         left join threads rt on rt.root_message_id = m.id
        where m.channel_id = ?
          and m.task_id is null
          and (m.thread_id is null or rt.id is not null)
        order by m.created_at asc, m.id asc`;

// sync/ipc/watch-rooms.ts nm:watch-thread — one TASK's thread.
const THREAD_SQL = `select id, author_kind, author_id, body, created_at, pinned from messages
       where task_id = ? order by created_at asc, id asc`;

// sync/ipc/watch-board.ts nm:watch-beats — docs/17, the open task's per-phase progress steps.
const BEATS_SQL = `select id, run_id, phase, role, seq, title, status, started_at, done_at, created_at from beats
       where task_id = ? order by created_at asc, seq asc`;

// sync/ipc/watch-board.ts nm:watch-artifacts — a task's deliverables.
const ARTIFACTS_SQL = `select id, kind, name, inline_content, promoted, created_at from artifacts
       where task_id = ? order by created_at asc`;

// sync/ipc/watch-board.ts nm:watch-open-runs — every RUNNING run in the workspace, which is what
// the rail reads so "standing by" can stop being a lie.
const OPEN_RUNS_SQL = `select r.id, r.channel_id, r.thread_id, r.task_id, r.agent_id, r.parent_run_id, r.kind, r.title, r.state, r.step, r.seat,
              r.done, r.total, r.summary, r.started_at, r.ended_at, r.updated_at, r.machine_id, m.name as machine_name
       from runs r left join machines m on m.id = r.machine_id
       where r.workspace_id = ? and r.state = 'running' order by r.started_at asc`;

// sync/ipc/watch-board.ts nm:watch-decisions-all — the nmq question cards, with the two columns
// that let a card know it has already been answered in prose.
const DECISIONS_ALL_SQL = `select d.id, d.channel_id, d.task_id, d.message_id, d.asker_kind, d.asker_id, d.question, d.options,
              d.allow_other, d.status, d.answer, d.created_at, d.answered_at, c.slug as channel_slug, t.number as task_number,
              -- the thread the asking message lives in, so a task-less decision ROW can open the
              -- conversation it was asked in (needs-you rows, 2026-08-07 — answering is the
              -- thread's job now, so every row must be able to reach its thread)
              (select m2.thread_id from messages m2 where m2.id = d.message_id) as thread_id,
              -- the newest human message in this card's OWN conversation (its task thread, else
              -- the THREAD it was asked in, else the room): a free-text card answered in prose is
              -- already handled, so Home must stop asking (needsyou.ts — strict-choice cards are
              -- exempt there). "The room" was the rule for every task-less card until 2026-09-17,
              -- and it read a routine's opener in the same room as the answer to an auth card in
              -- another conversation — the card's thread said needs you, the row said settled.
              -- …and a card hung on a SUBTASK counts the parent's thread as well, for the same
              -- reason the task watch above does: that is where the conversation is.
              (select max(m.created_at) from messages m
                where m.author_kind = 'human'
                  and (case when d.task_id is null then
                              case when (select m2.thread_id from messages m2 where m2.id = d.message_id) is null
                                   then m.channel_id = d.channel_id and m.task_id is null
                                   else m.thread_id = (select m2.thread_id from messages m2 where m2.id = d.message_id) end
                            else m.task_id = d.task_id
                                 or m.task_id = (select st.parent_task_id from tasks st where st.id = d.task_id)
                            end)) as human_replied_at,
              -- the settle stamps a card can sit under (0137): its own conversation's, and its task's thread's
              (select th.settled_at from threads th where th.id = (select m3.thread_id from messages m3 where m3.id = d.message_id)) as thread_settled_at,
              (select th.id from threads th where th.task_id = d.task_id order by th.created_at limit 1) as task_thread_id,
              (select th.settled_at from threads th where th.task_id = d.task_id order by th.created_at limit 1) as task_settled_at
       from decisions d join channels c on c.id = d.channel_id left join tasks t on t.id = d.task_id
       where d.workspace_id = ? order by d.created_at desc`;

// sync/ipc/agents.ts nm:channel-people — the room's people roster. The workspace_members join is
// scoped by workspace AS WELL AS user on purpose: a person in two workspaces has two rows there.
const PEOPLE_SQL = `select cm.user_id, cm.created_at, cm.created_by, wm.display_name, wm.role
       from channel_members cm
       join channels c on c.id = cm.channel_id
       join workspace_members wm on wm.user_id = cm.user_id and wm.workspace_id = c.workspace_id
      where cm.channel_id = ? order by cm.created_at`;

// sync/ipc/agents.ts nm:channel-history — a room's papertrail (0093): who joined it and when.
const HISTORY_SQL = `select ac.agent_id, ac.created_at, ac.created_by_kind, ac.created_by, a.name, a.role
       from agent_channels ac join agents a on a.id = ac.agent_id
      where ac.channel_id = ? and a.retired_at is null
      order by ac.created_at`;

// sync/ipc/content.ts nm:alerts — the attention bar's three workspace-scoped row sets. The
// conditions live in the WHERE so a healthy workspace pays three index probes.
const ALERT_CONNECTORS_SQL = `select k.id, k.provider, k.handle, k.status, k.project_id, p.name as project_name,
            (select c2.id from channels c2 where c2.project_id = k.project_id order by c2.created_at asc limit 1) as channel_id
       from connectors k left join projects p on p.id = k.project_id
      where k.workspace_id = ? and k.status = 'reauth_required'`;

const ALERT_SCHEDULES_SQL = `select s.id, s.title, s.status, s.last_error, s.last_run_at, s.channel_id,
            c.slug as channel_slug, c.project_id, p.name as project_name
       from schedules s join channels c on c.id = s.channel_id left join projects p on p.id = c.project_id
      where s.workspace_id = ? and s.status = 'active' and s.last_error is not null`;

const ALERT_POSTS_SQL = `select ci.id, ci.platform, ci.status, ci.last_error, ci.scheduled_at, ci.channel_id,
            c.slug as channel_slug, c.project_id, p.name as project_name
       from content_items ci join channels c on c.id = ci.channel_id left join projects p on p.id = c.project_id
      where ci.workspace_id = ? and ci.status = 'failed'
      -- newest slot first: a group's card speaks with its FIRST row's reason, and the newest
      -- failure is the live truth (a week-old refresh error atop today's scope error misled)
      order by ci.scheduled_at desc`;

/** the shape GET /v1/tasks/{id} answers with (control-api app.ts) — the same triple the contract
 *  declares, named here so the fetch is typed rather than `any`. */
type TaskDetail = Awaited<ReturnType<NMBridge['taskDetail']>>;

/**
 * `Partial<NMBridge>`, NOT `Record<string, unknown>`. The overrides are handed to a proxy, so an
 * untyped bag typechecks whatever it contains — and a wrong SHAPE then fails only in use. The
 * precedent is `send`, which is positional (channelId, body, opts) and was first written taking
 * one options object: it would have posted `undefined` as every message body and compiled
 * cleanly. Typing the bag against the contract makes the compiler check every lane here, so a
 * cb-second watch written cb-first cannot reach a browser.
 */
export function boardOverrides(cfg: WebNmConfig, db: PowerSyncDatabase): Partial<NMBridge> {
  const ws = () => cfg.workspaceId();
  return {
    watchTasks: (channelId, cb) =>
      watch<TaskRow>(db, ['tasks'], () => db.getAll<TaskRow>(TASKS_SQL, [channelId]), cb),

    watchTasksAll: (cb) =>
      watch<TaskAllRow>(db, ['tasks', 'channels', 'messages'], () => db.getAll<TaskAllRow>(TASKS_ALL_SQL, [ws()]), cb),

    watchThreads: (channelId, cb) =>
      watch<ThreadRow>(db, ['threads', 'messages'], () => db.getAll<ThreadRow>(THREADS_SQL, [channelId]), cb),

    watchMessages: (channelId, cb) =>
      watch<MessageRow>(db, ['messages', 'threads'], () => db.getAll<MessageRow>(MESSAGES_SQL, [channelId]), cb),

    watchThread: (taskId, cb) =>
      watch<MessageRow>(db, ['messages'], () => db.getAll<MessageRow>(THREAD_SQL, [taskId]), cb),

    watchBeats: (taskId, cb) =>
      watch<BeatUI>(db, ['beats'], () => db.getAll<BeatUI>(BEATS_SQL, [taskId]), cb),

    watchArtifacts: (taskId, cb) =>
      watch<ArtifactUI>(db, ['artifacts'], () => db.getAll<ArtifactUI>(ARTIFACTS_SQL, [taskId]), cb),

    // `machines` is watched as well as `runs`: the row carries the machine's NAME, so a machine
    // renamed (or first seen) mid-run changes this result without any run row changing.
    watchOpenRuns: (cb) =>
      watch<RunUI>(db, ['runs', 'machines'], () => db.getAll<RunUI>(OPEN_RUNS_SQL, [ws()]), cb),

    // `messages` is in the table set because both derived columns read it — a card answered in
    // prose has to stop being a needs-you row on the reply, not on the next unrelated change.
    watchDecisionsAll: (cb) =>
      watch<DecisionAllRow>(db, ['decisions', 'channels', 'tasks', 'messages'], () => db.getAll<DecisionAllRow>(DECISIONS_ALL_SQL, [ws()]), cb),

    channelPeople: async (channelId) =>
      db.getAll<ChannelPersonRow>(PEOPLE_SQL, [channelId]).catch(orEmpty('channelPeople')),

    channelHistory: async (channelId) =>
      db.getAll<ChannelHistoryRow>(HISTORY_SQL, [channelId]).catch(orEmpty('channelHistory')),

    /**
     * The one HTTP read in this file, and it THROWS on failure — deliberately, matching the
     * desktop's `api()`. Every caller writes `.catch(() => null)` and renders the timeline's
     * absent state from that null, so swallowing the error into an empty triple would tell the
     * task view that this task genuinely has no events and no files.
     */
    taskDetail: async (taskId) => {
      const res = await fetch(`${cfg.apiUrl}/v1/tasks/${encodeURIComponent(taskId)}`, { headers: await authHeaders(cfg) });
      if (!res.ok) throw new Error(`/v1/tasks/${taskId} failed ${res.status}`);
      return (await res.json()) as TaskDetail;
    },

    // The three sets are read TOGETHER and folded by the pure deriveAlerts in the renderer, so a
    // per-branch failure degrades to "nothing failing in that class" and says so, rather than
    // taking the other two down with it — which is what the handler's own per-branch catch does.
    alerts: async () => ({
      connectors: await db.getAll<AlertConnectorRow>(ALERT_CONNECTORS_SQL, [ws()]).catch(orEmpty('alerts.connectors')),
      schedules: await db.getAll<AlertScheduleRow>(ALERT_SCHEDULES_SQL, [ws()]).catch(orEmpty('alerts.schedules')),
      posts: await db.getAll<AlertPostRow>(ALERT_POSTS_SQL, [ws()]).catch(orEmpty('alerts.posts')),
    }),
  };
}
