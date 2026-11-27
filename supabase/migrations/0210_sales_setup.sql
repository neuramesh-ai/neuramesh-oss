-- SALES SETUP (docs/design/sales-onboarding-2026-11/plan.md SO1 to SO17, approved 2026-11-26).
--
-- `setup_runs` is one guided first run of an area for a workspace: a chat session in the area's room that the area's
-- agent answers, with one card for each step. A step's "done" is derived from the step's real home (the company
-- profile, the mail link, the Sales rows), so the run keeps only what has no other home: the steps the person
-- skipped, the last step card the API posted (so it posts each card once), and the end. One run for each workspace
-- and flow. It is not synced: GET /v1/sales/setup reads it with the facts, for a person with access to the area.
create table setup_runs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  flow         text not null check (length(flow) between 1 and 40),
  channel_id   uuid not null references channels (id) on delete cascade,
  thread_id    uuid references threads (id) on delete set null,
  started_by   text not null,
  skipped      text[] not null default '{}',
  step         text,
  ended_at     timestamptz,
  completed_at timestamptz,
  hidden_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, flow)
);
comment on table setup_runs is 'one guided first run of an area (Sales setup): skipped steps, the last card posted, the end';
alter table setup_runs enable row level security;

-- a lead is an open deal in the Lead stage that names a company and says why it fits (SO9). A contact gains its role
-- and the free address check, and both rows learn the two new sources: the web (pike) and a list (the person)
alter table sales_contacts add column title text not null default '' check (length(title) <= 120);
alter table sales_contacts add column address_check text check (address_check is null or address_check in ('ok', 'risky', 'bad'));
alter table sales_contacts add column checked_at timestamptz;
alter table sales_contacts drop constraint if exists sales_contacts_source_check;
alter table sales_contacts add constraint sales_contacts_source_check check (source in ('gmail', 'human', 'site', 'agent', 'web', 'list'));

alter table sales_deals add column fit text not null default '' check (length(fit) <= 280);
alter table sales_deals add column source_url text not null default '' check (length(source_url) <= 500);
alter table sales_deals add column source text not null default 'human' check (source in ('gmail', 'human', 'site', 'agent', 'web', 'list'));
alter table sales_deals add column setup_run uuid references setup_runs (id) on delete set null;
create index sales_deals_setup_run on sales_deals (setup_run) where setup_run is not null;

-- a first email to a new person has its own daily cap (SO17): a send of that kind is recorded as 'first'
alter table mail_sends drop constraint if exists mail_sends_kind_check;
alter table mail_sends add constraint mail_sends_kind_check check (kind in ('reply', 'email', 'first'));
