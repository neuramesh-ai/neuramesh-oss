-- Credits (docs/design/cloud-first-2026-08/starter-brain-and-credits.md). A workspace runs on
-- a platform-provided brain until it connects its own, and credits are what bound that: the
-- balance is read on every metered call and the meter is written in the same transaction, so
-- the cap is a server invariant rather than a client promise.
--
-- Units: micro-dollars (µUSD, 1e-6 USD) as bigint. Three meters — brain, machine, storage —
-- share one integer unit, and integer math has no float drift to reconcile. Users see credits
-- (1 credit = $0.01 = 10,000 µUSD); the rate card lives in packages/shared/src/rates.ts.
--
-- Not in the powersync publication, deliberately: this is operator data read over /v1, the
-- same doctrine as machine_usage and workspaces.

-- the balance. one row per workspace, a PK lookup on every metered write — never an aggregate
-- over the grant ledger, which would make the guard's cost grow with a workspace's history.
create table workspace_credits (
  workspace_id   uuid primary key references workspaces (id) on delete cascade,
  granted_micros bigint      not null default 0,
  spent_micros   bigint      not null default 0,
  -- the monthly-refill anchor. no rollover: a refill RESETS to the grant rather than adding,
  -- so an idle month cannot bank a stockpile the pricing never intended.
  period_start   date        not null default (now() at time zone 'utc')::date,
  updated_at     timestamptz not null default now(),
  check (granted_micros >= 0 and spent_micros >= 0)
);
alter table workspace_credits enable row level security;

-- every grant, auditable. "why does this workspace have credits" must always have an answer,
-- and a reprice must never silently restate history — hence rate_version on the row.
create table credit_grants (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid   not null references workspaces (id) on delete cascade,
  micros       bigint not null check (micros > 0),
  kind         text   not null check (kind in ('signup', 'monthly', 'promo', 'manual', 'purchase')),
  rate_version text,
  note         text,
  created_at   timestamptz not null default now()
);
create index credit_grants_ws on credit_grants (workspace_id, created_at desc);
alter table credit_grants enable row level security;

-- the DAILY breakdown stays where it already is: machine_usage is the per-(workspace, day)
-- ledger, written by one owner, already out of the publication. workspace_credits carries the
-- running total the guard reads; this carries what made it up.
--
-- storage_gb_hours is defined now and written later, on purpose: the meter must not be shaped
-- as if tokens were the only axis just because tokens are the only one priced today.
alter table machine_usage
  add column model_calls      int     not null default 0,
  add column model_in_tokens  bigint  not null default 0,
  add column model_out_tokens bigint  not null default 0,
  add column model_micros     bigint  not null default 0,
  add column machine_micros   bigint  not null default 0,
  add column storage_gb_hours numeric not null default 0,
  add column storage_micros   bigint  not null default 0;
