-- A committed change feed for the self-hosted Local replica. It stays dormant on hosted
-- deployments. The Local API enables it before its first consistent bootstrap.
create table if not exists public.local_sync_state (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  revision bigint not null default 0,
  retained_after bigint not null default 0
);
insert into public.local_sync_state(singleton) values (true) on conflict do nothing;

create table if not exists public.local_sync_changes (
  revision bigint primary key,
  transaction_id bigint not null,
  workspace_id uuid not null,
  table_name text not null,
  row_id text not null,
  row_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists local_sync_changes_scope on public.local_sync_changes(workspace_id, revision);
create index if not exists local_sync_changes_transaction on public.local_sync_changes(transaction_id, revision);
alter table public.local_sync_state enable row level security;
alter table public.local_sync_changes enable row level security;

create or replace function public.lock_local_sync_revision() returns trigger language plpgsql as $$
begin
  -- Take the order lock before a statement locks any data rows. Taking it only from a row
  -- trigger can deadlock two transactions that later touch each other's first rows.
  if (select enabled from public.local_sync_state where singleton) then
    perform revision from public.local_sync_state where singleton for update;
  end if;
  return null;
end $$;

create or replace function public.record_local_sync_change() returns trigger language plpgsql as $$
declare payload jsonb; old_payload jsonb; scope uuid; old_scope uuid; rev bigint;
begin
  if not (select enabled from public.local_sync_state where singleton) then
    return coalesce(new, old);
  end if;
  payload := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  old_payload := case when tg_op = 'UPDATE' then to_jsonb(old) else payload end;
  if payload ? 'workspace_id' then
    scope := (payload->>'workspace_id')::uuid;
    old_scope := (old_payload->>'workspace_id')::uuid;
  elsif tg_table_name = 'agent_channels' then
    select workspace_id into scope from public.agents where id = (payload->>'agent_id')::uuid;
    if scope is null then select workspace_id into scope from public.local_sync_changes where table_name = 'agents' and row_id = payload->>'agent_id' order by revision desc limit 1; end if;
    select workspace_id into old_scope from public.agents where id = (old_payload->>'agent_id')::uuid;
  elsif tg_table_name = 'project_repos' then
    select workspace_id into scope from public.repos where id = (payload->>'repo_id')::uuid;
    if scope is null then select workspace_id into scope from public.local_sync_changes where table_name = 'repos' and row_id = payload->>'repo_id' order by revision desc limit 1; end if;
    select workspace_id into old_scope from public.repos where id = (old_payload->>'repo_id')::uuid;
  elsif tg_table_name = 'channel_members' then
    select workspace_id into scope from public.channels where id = (payload->>'channel_id')::uuid;
    if scope is null then select workspace_id into scope from public.local_sync_changes where table_name = 'channels' and row_id = payload->>'channel_id' order by revision desc limit 1; end if;
    select workspace_id into old_scope from public.channels where id = (old_payload->>'channel_id')::uuid;
  end if;
  -- Child deletes during a cascading parent delete resolve the scope from the prior change.
  if scope is null then
    select workspace_id into scope from public.local_sync_changes
      where table_name = tg_table_name and row_id = payload->>'id' order by revision desc limit 1;
  end if;
  if scope is null then return coalesce(new, old); end if;
  -- Unlike a sequence, this row lock remains held until COMMIT. A reader cannot advance past
  -- a revision allocated by an earlier transaction that has not committed yet.
  if old_scope is not null and old_scope <> scope then
    update public.local_sync_state set revision = revision + 1 where singleton returning revision into rev;
    insert into public.local_sync_changes values (rev, txid_current(), old_scope, tg_table_name, payload->>'id', null, now());
  end if;
  update public.local_sync_state set revision = revision + 1 where singleton returning revision into rev;
  insert into public.local_sync_changes values
    (rev, txid_current(), scope, tg_table_name, payload->>'id', case when tg_op = 'DELETE' then null else payload end, now());
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['channels','projects','messages','threads','tasks','machines','agents',
    'agent_channels','repos','project_repos','artifacts','beats','runs','decisions','policies',
    'memory_blocks','skills','skill_packs','schedules','content_items','connectors',
    'workspace_members','channel_members','whiteboards','code_sessions','reply_reminders'] loop
    execute format('drop trigger if exists local_sync_change on public.%I', t);
    execute format('drop trigger if exists local_sync_delete on public.%I', t);
    execute format('drop trigger if exists local_sync_guard on public.%I', t);
    execute format('create trigger local_sync_guard before insert or update or delete on public.%I for each statement execute function public.lock_local_sync_revision()', t);
    execute format('create trigger local_sync_change after insert or update on public.%I for each row execute function public.record_local_sync_change()', t);
    execute format('create trigger local_sync_delete before delete on public.%I for each row execute function public.record_local_sync_change()', t);
  end loop;
end $$;
