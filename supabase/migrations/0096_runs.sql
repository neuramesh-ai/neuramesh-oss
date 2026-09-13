-- Runs (docs/29): the durable row behind a stretch of agent work.
--
-- Before this, live agent status was (a) machine-local IPC (watchAgentStream / watchAgentLogs)
-- and (b) alive only for the duration of a wake — so a second desktop or the phone saw nothing,
-- and any work an agent kept doing past its reply had no representation at all. `run_id` already
-- existed in agent_logs + beats as a grouping key with no row; this writes it down.
--
-- Descriptive, never gating: no FSM edge depends on a run (same stance as beats). New synced
-- table → also joins the powersync publication (0097_publish_runs.sql, prod) and the sync rules
-- (dev/stack + the deploy step).
create type run_state as enum ('running', 'done', 'failed', 'stopped');

create table runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces (id) on delete cascade,
  channel_id    uuid not null references channels (id) on delete cascade,
  thread_id     uuid references threads (id) on delete cascade,   -- conversation sheet it was born in
  task_id       uuid references tasks (id) on delete cascade,     -- or the task thread
  agent_id      uuid not null references agents (id) on delete cascade,
  parent_run_id uuid references runs (id) on delete cascade,      -- the fan-out tree: a leg's parent
  kind          text not null,                                    -- wake | work | leg
  title         text not null,
  state         run_state not null default 'running',
  step          text,                                             -- the live "what am I doing" line
  done          int not null default 0,
  total         int not null default 0,
  summary       text,                                             -- close-out: the result, or why it stopped
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  updated_at    timestamptz not null default now()
);
-- the renderer's two reads: "open runs for this surface" and "this run's legs"
create index runs_channel on runs (channel_id, started_at desc);
create index runs_parent on runs (parent_run_id);
create index runs_open on runs (workspace_id, state) where state = 'running';
