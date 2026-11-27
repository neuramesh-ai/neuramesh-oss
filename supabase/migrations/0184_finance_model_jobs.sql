-- Finance model context remains server-only and encrypted, never part of sync_changes.
alter table machines add column finance_chat_version integer not null default 0;
create table workspace_finance_model_jobs (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kinshi_session uuid not null,
  chat_id uuid not null references workspace_finance_chats(id) on delete cascade,
  requester_id uuid not null references nm_users(id) on delete cascade,
  machine_id uuid not null references machines(id) on delete cascade,
  model text not null,
  thinking text check(thinking in ('low','medium','high')),
  sealed_input text not null,
  lease_hash text,
  state text not null default 'queued' check(state in ('queued','running','complete','failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '5 minutes'
);
create index finance_model_jobs_machine_pending on workspace_finance_model_jobs(machine_id,created_at) where state='queued';
alter table workspace_finance_model_jobs enable row level security;
revoke all on workspace_finance_model_jobs from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on workspace_finance_model_jobs from authenticated; end if;
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on workspace_finance_model_jobs from anon; end if;
end $$;
