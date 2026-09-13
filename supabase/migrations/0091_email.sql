-- The email outbox (docs/27 §3). Every email — transactional, lifecycle, broadcast — is a
-- ROW before it is a send. Deliberately NOT in the powersync publication: this is operator
-- data, and it carries recipient addresses that no client needs replicated.
--
-- `dedupe_key` UNIQUE is the entire exactly-once model. Not a guard, not a cron that
-- remembers — a constraint. welcome:<user_id> · nudge_d3:<user_id> · invite:<invite_id> ·
-- broadcast:<id>:<user_id>. A double-fired cron, a redeploy mid-batch, two hosts racing:
-- the second insert raises 23505, which is the CORRECT outcome, not an incident.
create table if not exists emails (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  user_id uuid references nm_users(id) on delete set null,
  to_email text not null,
  template text not null,
  kind text not null default 'transactional' check (kind in ('transactional', 'lifecycle', 'broadcast')),
  subject text not null default '',
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  dedupe_key text not null unique,           -- THE exactly-once guarantee
  provider_id text,                          -- Resend's message id, the delivery receipt
  error text,
  payload jsonb,                             -- template props, so a resend needs no recomputation
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
-- the drain query: due + not yet sent, oldest first
create index if not exists emails_due_idx on emails(status, scheduled_at) where status = 'queued';
create index if not exists emails_user_idx on emails(user_id, created_at desc);

-- Email preferences on the identity row. Transactional mail ignores both of these (an invite
-- is a direct consequence of an action a human took); lifecycle and broadcast respect them,
-- applied IN THE SELECTOR QUERY, never in a template and never in a prompt.
alter table nm_users add column if not exists unsubscribed_at timestamptz;
alter table nm_users add column if not exists email_bounced_at timestamptz;  -- hard bounce or complaint

-- Activation clock for the lifecycle sequence. Set on first identity resolution; a NULL here
-- means a legacy user who predates the email system and must never receive a day-1 nudge
-- seven months late.
alter table nm_users add column if not exists onboarding_at timestamptz;
