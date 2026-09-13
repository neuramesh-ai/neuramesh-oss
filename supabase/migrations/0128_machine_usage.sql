-- wake/idle-stop + starter-compute metering (docs/design/cloud-first-2026-08 plan: Free
-- capped starter · Cloud duty-cycled). control-api meters cloud-machine wake minutes per
-- workspace per utc day; the machine-sweep cron accrues them and reads them back to
-- force-stop free workspaces at the daily cap. rows are written by the sweep only and read
-- over GET /v1/machines/usage — deliberately NOT in the powersync publication (operator
-- data, the /v1/workspaces doctrine).

create table machine_usage (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  day date not null,
  minutes int not null default 0,
  primary key (workspace_id, day)
);

-- deny-all posture (0100): reached through control-api only, which connects as the owner
alter table machine_usage enable row level security;

comment on table machine_usage is
  'Cloud-machine wake minutes per workspace per UTC day, accrued by the machine-sweep cron '
  '(NM_MACHINE_SWEEP_MIN per pass; the vercel cron must run at that cadence). ONE meter for '
  'all key sources by design (v1): the free cap applies to machine wake minutes, BYOK or not.';

-- 0126 shipped idle_stop_min NOT NULL DEFAULT 30; the sweep's contract is "NULL = never
-- auto-stop", so the column learns to hold that choice. the default stays — a fresh machine
-- still idle-stops after 30 minutes unless a human opts it out.
alter table machines alter column idle_stop_min drop not null;

comment on column machines.idle_stop_min is
  'Idle minutes before the machine-sweep cron scales this machine to 0. last_wake_at is the '
  'idle clock (bumped by every delivered workspace message). NULL = never auto-stop.';
