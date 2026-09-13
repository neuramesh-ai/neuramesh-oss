// Canonical read queries for the mobile replica. Column lists mirror the desktop
// watch bridges (apps/desktop/src/main/sync.ts); the RN client feeds these to
// PowerSync's useQuery with positional `?` params. Reads hit the local SQLite
// replica, so they are offline-first and sub-millisecond.

// Channels in the active workspace (the room list). params: [workspaceId]
export const CHANNELS_FOR_WORKSPACE =
  `select id, slug, topic, project_id from channels where workspace_id = ? order by slug`;

// A channel's main thread (task_id null), oldest→newest for an inverted list. params: [channelId]
export const CHANNEL_MESSAGES =
  `select id, author_kind, author_id, body, created_at, pinned from messages where channel_id = ? and task_id is null order by created_at`;

// A task thread. params: [taskId]
export const TASK_MESSAGES =
  `select id, author_kind, author_id, body, created_at, pinned from messages where task_id = ? order by created_at`;

// The board: every task in a workspace, newest first (grouped by state client-side). params: [workspaceId]
export const TASKS_FOR_WORKSPACE =
  `select id, number, title, state, channel_id, assignee_kind, assignee_id, branch, pr_number, artifact_count, updated_at
     from tasks where workspace_id = ? order by number desc`;

// "Needs you" — tasks parked on a human gate (mirrors the push-worthy state set).
// `last_human_msg_at` feeds awaitingAgent (shared/needsyou.ts): a gate you already
// answered in the thread is waiting on an AGENT, so it must drop out of this queue
// immediately rather than at the agent's next turn. Filtered in the client so desktop
// and mobile share one rule instead of two SQL dialects of it. params: [workspaceId]
export const NEEDS_YOU =
  `select id, number, title, state, channel_id, updated_at,
          (select max(m.created_at) from messages m where m.task_id = tasks.id and m.author_kind = 'human') as last_human_msg_at
     from tasks where workspace_id = ? and state in ('design_review','plan_review','done','blocked') order by updated_at desc`;

// Live roster: machines + their agents (presence from synced heartbeats). params: [workspaceId]
export const MACHINES_FOR_WORKSPACE =
  `select id, name, platform, daemon_version, last_seen_at from machines where workspace_id = ? order by name`;
export const AGENTS_FOR_WORKSPACE =
  `select id, name, role, model, runtime, status, machine_id, kind, emoji from agents where workspace_id = ? order by name`;

// A task's artifacts (design mockups, diffs, screenshots) for the review screens. params: [taskId]
export const ARTIFACTS_FOR_TASK =
  `select id, kind, name, mime, inline_content, promoted, created_at from artifacts where task_id = ? order by created_at`;

// ── multi-workspace (0113) ──────────────────────────────────────────────────
// The sync rules stream EVERY workspace you belong to into the one replica, so anything below
// that forgot its `workspace_id = ?` would quietly mix two workspaces together. These exist so
// mobile's screens stop hand-rolling unscoped SQL. params: [workspaceId]
export const PROJECTS_FOR_WORKSPACE =
  `select id, name, is_default, model_pack from projects where workspace_id = ? order by is_default desc, name`;
// the repos a phone may attach to a project: REMOTE ones only. A `local` repo is a folder on one
// person's machine, and re-registering it from a phone would mint a GitHub repo that never existed
// (the server assumes github for a bare org/name). The card says so in words as well.
export const REMOTE_REPOS_FOR_WORKSPACE =
  `select id, name, org_name, default_branch from repos where workspace_id = ? and provider <> 'local' order by org_name, name`;
// the developer seats a Code session inherits its brain from — the same rows the desktop's model
// selector reads, so both clients name the same default (shared `projectDeveloperModel`)
export const DEVELOPER_SEATS_FOR_WORKSPACE =
  `select name, role, model, model_source, kind, retired_at from agents where workspace_id = ? and role = 'developer' order by name`;
export const CHANNEL_PICKER_FOR_WORKSPACE =
  `select id, slug from channels where workspace_id = ? order by slug`;
// thread rendering: #ref linkify + deliverable names, scoped so a reference can never resolve
// to another workspace's task. params: [workspaceId]
export const TASK_REFS_FOR_WORKSPACE =
  `select id, number from tasks where workspace_id = ?`;
export const ARTIFACT_REFS_FOR_WORKSPACE =
  `select id, name, task_id from artifacts where workspace_id = ?`;

// The workspace-pick rule lives in @neuramesh/shared, not here: Electron's MAIN process needs it
// too, and it already depends on shared while this package peer-depends on PowerSync — which has
// no business being pulled into main for a three-line rule. Re-exported so mobile's imports stay
// in one place.
export { pickActiveWorkspace } from '@neuramesh/shared';

// ── the cloud round (mobile-cloud 2026-09, S1.4): the reads the phone's new screens draw ──────

// The session list's threads (docs/35 — shared `historyRows` shapes them): every live thread in
// the workspace with its room's slug and its newest message as the snippet. `last_body` is the
// newest message's body, which is what the desktop's watch hands the same derivation. params: [workspaceId]
//
// THE LIMIT IS A PARAMETER, AND THAT IS THE POINT (George on the TestFlight build, 2026-09-06: the
// list "grows very long, the device gets hot"). This asked for 300 rows and ran the correlated
// `last_body` subquery on every one of them, and PowerSync re-runs a watched query whenever any
// row it reads changes — so every message any agent wrote re-scanned 300 threads' message
// histories. The snippet is worth keeping; scanning for rows nobody has scrolled to is not. The
// client passes the page it is showing (25 to start), so the work is bounded by what a person
// actually looks at. params: [workspaceId, limit]
export const SESSION_THREADS_FOR_WORKSPACE =
  `select t.id, t.task_id, t.title, t.updated_at, t.channel_id, c.slug as channel_slug, t.schedule_id, t.machine_id, t.origin, t.mode, t.settled_at,
          (select m.body from messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_body,
          -- who spoke last, and when: a human last = the agent owes a reply (shared/threadstatus.ts)
          (select m.author_kind from messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_author_kind,
          (select max(m.created_at) from messages m where m.thread_id = t.id) as last_at
     from threads t join channels c on c.id = t.channel_id
    where t.workspace_id = ? and t.archived_at is null order by t.updated_at desc limit ?`;

// The session list's tasks (the same derivation's second pass): identity + the columns a row
// wears — state, branch, the anchors that keep companion work off the list. params: [workspaceId]
// params: [workspaceId, limit] — this one carried NO limit at all, so a workspace with a thousand
// tasks handed all of them, descriptions included, to a derivation that then kept 200.
export const SESSION_TASKS_FOR_WORKSPACE =
  `select t.id, t.number, t.title, t.description, t.state, t.kind, t.pr_number, t.plan_approved_at, t.channel_id, c.slug as channel_slug, t.branch, t.parent_task_id, t.origin_thread_id, t.updated_at,
          -- the who-holds-the-ball input (needsyou.ts): a human reply newer than the gate is the agent's turn
          (select max(m.created_at) from messages m where m.task_id = t.id and m.author_kind = 'human') as last_human_msg_at
     from tasks t join channels c on c.id = t.channel_id where t.workspace_id = ? order by t.updated_at desc limit ?`;

// Open runs — the ONE liveness signal (docs/29 §10): a session whose task or thread owns a
// running run breathes. params: [workspaceId]
export const OPEN_RUNS_FOR_WORKSPACE =
  `select id, thread_id, task_id, agent_id, kind, step, done, total, machine_id, started_at from runs where workspace_id = ? and state = 'running'`;

// Open decision cards — the needs-you queue's second tenant (docs/12): questions asked of a human,
// with the thread they were asked in. params: [workspaceId]
export const OPEN_DECISIONS_FOR_WORKSPACE =
  `select d.id, d.channel_id, d.task_id, d.message_id, d.asker_id, d.question, d.options, d.allow_other, d.created_at, m.thread_id,
          (select max(h.created_at) from messages h where h.author_kind = 'human' and ((m.thread_id is not null and h.thread_id = m.thread_id) or (m.thread_id is null and h.channel_id = d.channel_id and h.task_id is not distinct from d.task_id))) as human_replied_at
     from decisions d left join messages m on m.id = d.message_id
    where d.workspace_id = ? and d.status = 'open' order by d.created_at desc`;

// A conversation thread's messages, oldest first. params: [threadId]
export const THREAD_MESSAGES =
  `select id, author_kind, author_id, body, created_at, task_id, thread_id from messages where thread_id = ? order by created_at`;

// The thread's own row — its head: title, mode, the birth machine and origin (0134), the room. params: [threadId]
export const THREAD_HEAD =
  `select t.id, t.title, t.mode, t.brain_override, t.machine_id, t.origin, t.task_id, t.schedule_id, t.root_message_id, t.channel_id, c.slug as channel_slug, t.workspace_id, t.created_at, t.settled_at
     from threads t join channels c on c.id = t.channel_id where t.id = ? limit 1`;

// The agents registered to a room (the ACL) — the composer's brain pill and the room's crew. params: [channelId]
export const AGENTS_IN_CHANNEL =
  `select a.id, a.name, a.emoji, a.role, a.model, a.status from agents a join agent_channels ac on ac.agent_id = a.id
    where ac.channel_id = ? and a.retired_at is null order by case a.role when 'orchestrator' then 0 else 1 end, a.name`;

// Attachments a thread's messages carry (chat attachments ride artifacts by message_id). params: [threadId]
export const THREAD_ARTIFACTS =
  `select a.id, a.message_id, a.kind, a.name, a.mime, a.inline_content, a.size_bytes, a.width, a.height
     from artifacts a join messages m on m.id = a.message_id where m.thread_id = ? order by a.created_at`;

// Code sessions (0135) — the Code tab's list, newest first. params: [workspaceId]
export const CODE_SESSIONS_FOR_WORKSPACE =
  `select id, project_id, repo_id, repo_name, branch, title, mode, state, machine_id, created_by, last_line, changes_count, checkpoints_count, created_at, updated_at, ended_at
     from code_sessions where workspace_id = ? order by updated_at desc limit 200`;

// Routines — every armed or paused schedule with its room. params: [workspaceId]
export const SCHEDULES_FOR_WORKSPACE =
  `select s.id, s.title, s.cadence, s.at_time, s.tz, s.weekday, s.next_run_at, s.run_count, s.agent_id, s.status, s.last_run_at, s.last_error, s.payload, s.channel_id, c.slug as channel_slug, s.created_at
     from schedules s join channels c on c.id = s.channel_id where s.workspace_id = ? order by s.next_run_at nulls last, s.title`;

// A routine's runs: every thread it opened (0119), newest first, with each run's last line. params: [scheduleId]
export const SCHEDULE_RUN_THREADS =
  `select t.id, t.title, t.created_at, t.updated_at, t.channel_id,
          (select m.body from messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_body,
          (select count(*) from messages m where m.thread_id = t.id) as msg_count
     from threads t where t.schedule_id = ? and t.archived_at is null order by t.created_at desc limit 50`;

// Scheduled and drafted posts for the calendar's second lane. params: [workspaceId]
// The calendar's items. `media` carries the picture and the brief, and `thread_id` is where a
// request for a picture is posted, so the phone's post sheet can do what the desktop's card does
// rather than only draw the row (the mobile fix round, 2026-09-06).
export const CONTENT_ITEMS_FOR_CALENDAR =
  `select id, channel_id, thread_id, task_id, platform, body, media, status, scheduled_at, published_at, external_url, created_at from content_items
    where workspace_id = ? and (scheduled_at is not null or status in ('draft', 'scheduled')) order by scheduled_at`;

// Machines with the columns the compute ladder and the chip read (0114/0126): whose, what kind, what it serves. params: [workspaceId]
export const MACHINES_WITH_KIND_FOR_WORKSPACE =
  `select id, name, platform, daemon_version, last_seen_at, kind, owner_user_id, runtimes from machines where workspace_id = ? order by name`;

// The roster with each member's compute prefs (0118/0119 — the grants the chip and Compute read). params: [workspaceId]
export const MEMBERS_FOR_WORKSPACE =
  `select user_id, role, display_name, compute from workspace_members where workspace_id = ?`;

// A project's repos, primary first — the New Code session's repo. params: [projectId]
export const REPOS_FOR_PROJECT =
  `select r.id, r.name, r.org_name, r.default_branch, r.clone_url, pr.is_primary from project_repos pr join repos r on r.id = pr.repo_id
    where pr.project_id = ? order by pr.is_primary desc, r.name`;

// Every project's rooms, for the room chip and the scope chips. params: [workspaceId]
export const CHANNELS_WITH_PROJECT_FOR_WORKSPACE =
  `select id, slug, topic, project_id, kind from channels where workspace_id = ? order by slug`;
