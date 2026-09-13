-- Beats (docs/17): the ordered, high-level steps an agent declares for the phase it just
-- picked up, checked off live and synced so the human can watch progress from any machine
-- (unlike the machine-local agent_logs activity feed). One set per phase-attempt, grouped by
-- run_id; the set's `role` drives its color in the tracker (the assigned agent's role hue).
-- Descriptive only — beats never gate an FSM transition. New synced table → also joins the
-- powersync publication (0059_publish_beats.sql, prod) and the sync rules (dev/stack + deploy).
create type beat_status as enum ('pending', 'active', 'done', 'blocked');

create table beats (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  task_id      uuid not null references tasks (id) on delete cascade,
  run_id       uuid not null,                 -- groups one declared set (a phase-attempt)
  phase        task_state not null,           -- the FSM state this set belongs to
  role         text not null,                 -- who declared it (architect/developer/designer/reviewer)
  seq          int not null,                  -- order within the set
  title        text not null,
  status       beat_status not null default 'pending',
  started_at   timestamptz,                   -- stamped when the beat goes active
  done_at      timestamptz,                   -- stamped when the beat goes done
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (run_id, seq)
);
create index beats_task on beats (task_id);
