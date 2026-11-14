-- DURABLE PARKS AND FACTS (docs/design/cloud-run-2026-10/architecture.md §4, §6.3). A Cloud Run
-- machine lives in RAM and sleeps when idle, so two kinds of machine state move to Postgres:
--
-- machine_facts: the ALREADY-HANDLED facts the daemon kept in its local harness.db (merged,
-- reclaimed, …). One row per (workspace, kind, subject). Insert-if-absent is the whole protocol:
-- the first writer creates the row, every later writer (a restarted process, a new epoch, another
-- machine of the workspace) reads `created: false` and does not act again. Every write names the
-- writer's epoch and is refused with 409 STALE_EPOCH when that epoch is not the machine's current one.
--
-- parks: a turn waiting on a human (an approval card, a question) or a timer, persisted with a
-- reference to the checkpoint it resumes from, so the machine can drain and sleep while a person
-- decides. open → resolved (a human answered) | expired (the TTL passed: resolved as a denial, as
-- the old 10-minute in-memory wait did) → claimed (a booted epoch took it, claimed_epoch) → done
-- (the resumed turn applied the resolution). A claim by an epoch that died before `done` is
-- re-claimable by a later epoch, so a crash never strands a resolution.
-- Additive only: nothing existing reads either table.

create table machine_facts (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z0-9_-]{0,63}$'),
  subject_key text not null check (length(subject_key) between 1 and 512),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by_machine uuid references machines (id) on delete set null,
  epoch bigint not null default 0,
  primary key (workspace_id, kind, subject_key)
);

comment on table machine_facts is
  'already-handled facts a machine must never act on twice (harness.db on desktop/GKE). insert-if-absent, epoch-fenced';

create index machine_facts_recent on machine_facts (workspace_id, kind, created_at desc);

create table parks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  machine_id uuid not null references machines (id) on delete cascade,
  -- the machine's own idempotency key for the wait (an approval: where + question; a Code
  -- session: thread + tool + input digest). One live park per (machine, key)
  key text not null check (length(key) between 1 and 512),
  thread_id uuid,
  task_id uuid,
  turn_id text,
  kind text not null check (kind in ('approval', 'question', 'timer')),
  -- the card message and its question: how decision.answer and a reply-line answer find the park
  message_id uuid,
  question text,
  request jsonb not null default '{}'::jsonb,
  -- a REFERENCE to the turn's checkpoint (a task's in_progress row + its work dir snapshot, a Code
  -- session's runtime checkpoint), never the bytes
  checkpoint jsonb not null default '{}'::jsonb,
  wake_condition jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'expired', 'claimed', 'done')),
  resolution jsonb,
  expires_at timestamptz not null,
  created_epoch bigint not null default 0,
  claimed_epoch bigint,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  claimed_at timestamptz,
  done_at timestamptz
);

comment on table parks is
  'turns waiting on a human or a timer, durable across machine sleep: open → resolved | expired → claimed → done';

create unique index parks_live_key on parks (machine_id, key) where status <> 'done';
create index parks_machine_status on parks (machine_id, status);
create index parks_open_expiry on parks (expires_at) where status = 'open';
create index parks_open_message on parks (workspace_id, message_id) where status = 'open' and message_id is not null;
create index parks_open_question on parks (workspace_id, question) where status = 'open' and question is not null;

-- server-only: control-api reads and writes both through its own connection; no client lane
alter table machine_facts enable row level security;
alter table parks enable row level security;
