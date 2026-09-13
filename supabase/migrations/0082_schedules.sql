-- Schedules (marketing-channel plan §4.6): "run X at time T, once or on a cadence" — a
-- GENERIC primitive from day one (workspace-scoped, channel-anchored); marketing is just
-- its first customer, the calendar UI ships there first. Humans arm schedules (Cloud-gated
-- — the deep-funnel paywall, round 2); agents may only PROPOSE (a card, human-confirmed).
-- Execution is the daemon's minute-tick: a due run is CLAIMED by an atomic run_count CAS
-- (counter, not timestamp — the ship-stage lesson), so two machines never double-fire.
-- cadence is a small enum + local time-of-day in an IANA tz, not raw cron — it matches
-- the picker and keeps next-run math a pure, testable helper (shared/schedule.ts).
create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  title text not null,
  cadence text not null check (cadence in ('once', 'daily', 'weekdays', 'weekly')),
  at_time text not null default '09:00',          -- HH:MM, local to tz
  tz text not null default 'UTC',                 -- IANA name, from the arming client
  weekday integer,                                 -- 0-6 (Sun-Sat), weekly only
  next_run_at timestamptz,                         -- null once done
  run_count integer not null default 0,            -- the CAS claim token
  agent_id uuid references agents(id) on delete set null,
  payload jsonb,                                   -- { prompt } v1 — what the run asks the agent to do
  status text not null default 'active' check (status in ('active', 'paused', 'done')),
  created_by_kind text not null default 'human',
  created_by text not null default '',
  last_run_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists schedules_due_idx on schedules(status, next_run_at);
create index if not exists schedules_channel_idx on schedules(channel_id, created_at desc);
