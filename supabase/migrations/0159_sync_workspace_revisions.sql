-- PER-WORKSPACE SYNC REVISIONS (design §10.2, risk R18, gate A1). The feed of 0152 numbered every
-- change from ONE counter in local_sync_state, and every write to a synced table took that row's lock
-- from its first statement until COMMIT. So all writers in the database ran one at a time.
--
-- Now:
--   · sync_heads holds one revision counter per workspace. A change carries its workspace and the
--     next revision of THAT workspace only.
--   · The counter is taken at COMMIT, by a deferred constraint trigger, not at the write. A writer
--     holds a workspace's lock only for its own commit, never across its statements or the client's
--     round trips. So two writers in different workspaces never wait for each other, and two writers
--     in one workspace wait only for the other's commit.
--   · The lock is still held through COMMIT. So a reader that sees revision R of a workspace has
--     seen every change at or below R, and one transaction's revisions in a workspace are
--     contiguous (a page never splits it).
--   · A transaction that writes several workspaces takes their locks in workspace-id order. A row
--     trigger notes each workspace in a transaction-local setting as the rows are written, and the
--     first deferred change locks them all. Two such transactions cannot deadlock on each other.
--   · Each commit NOTIFYs channel nm_sync once per workspace it changed (payload: the workspace id),
--     so nm-api can answer a waiting long-poll at once (local-sync.ts). local_sync_state.notify off
--     turns that off without a deploy.
--   · The change payload leaves out the vector and tsvector columns (the 384-dim embeddings and the
--     full-text columns). No client reads them, and they were most of a message's bytes. An update
--     that changes nothing but those columns (the embedder filling `embedding`) records no change.
--
-- UPGRADE IN PLACE. The new log is a new table, sync_changes, filled from local_sync_changes with each
-- workspace's own numbering, so the scope fallback for cascaded deletes keeps its history. The old
-- table stays, frozen, for an nm-api of the previous release that serves during the traffic shift:
-- it reads no new changes, and it cannot corrupt the new log. A cursor of that release (version 1)
-- gets 409 RESET_REQUIRED from the new release, and the client bootstraps again.
--
-- UNDER LIVE TRAFFIC (the first sandbox deploy of this file deadlocked twice). A writer of the old
-- feed holds its table's lock and then waits for the local_sync_state row. This file used to take
-- that row first and then the tables, one at a time. Now:
--   · it takes the 26 synced tables first, in name order, in SHARE ROW EXCLUSIVE (what CREATE TRIGGER
--     needs: writers wait, readers do not). A waiting request also stops new writers from queueing in
--     front of it, so a busy table drains (a NOWAIT loop starved behind three busy writers in CI).
--   · one attempt may wait 400 ms in all, then it lets go of every table, sleeps 100 to 500 ms and
--     tries again, at most 120 times (a few minutes), then fails cleanly. A writer can wait on this
--     file only after this attempt began, and Postgres looks for a deadlock only after
--     deadlock_timeout (1 s by default), so this file has always given up first: no writer is ever
--     the victim of a deadlock with it.
--   · once it holds every synced table, no old-feed writer is inside a transaction, so nobody holds
--     the local_sync_state row: it is not locked at all.
--   · it drops no trigger (DROP TRIGGER wants ACCESS EXCLUSIVE, which would also queue the readers).
--     The old functions become no-ops, and their triggers stay until a quiet migration drops them.
--   · every other lock it takes waits at most lock_timeout.
do $lock$
declare
  tries int := 0;
  started timestamptz;
  left_ms int;
  t text;
begin
  loop
    begin
      started := clock_timestamp();
      foreach t in array array['agent_channels','agents','artifacts','beats','channel_members','channels','code_sessions','connectors','content_items','decisions','machines','memory_blocks','messages','policies','project_repos','projects','reply_reminders','repos','runs','schedules','skill_packs','skills','tasks','threads','whiteboards','workspace_members'] loop
        left_ms := 400 - (extract(epoch from clock_timestamp() - started) * 1000)::int;
        if left_ms < 1 then raise exception 'lock budget spent' using errcode = '55P03'; end if;
        perform set_config('lock_timeout', left_ms || 'ms', true);
        execute format('lock table public.%I in share row exclusive mode', t);
      end loop;
      perform set_config('lock_timeout', '5s', true);
      exit;
    exception when lock_not_available then
      tries := tries + 1;
      if tries >= 120 then
        raise exception '0159: the synced tables never came free together in % tries. Deploy again at a quieter moment', tries;
      end if;
      perform pg_sleep(0.1 + random() * 0.4);
    end;
  end loop;
end $lock$;
set local lock_timeout = '5s';

create table if not exists public.sync_heads (
  workspace_id uuid primary key,
  revision bigint not null default 0,
  -- every change at or below this revision is pruned: an older cursor must reset
  retained_after bigint not null default 0
);

create table if not exists public.sync_changes (
  workspace_id uuid not null,
  revision bigint not null,
  -- commit order across workspaces, for one page that spans several (a sequence, so no lock)
  seq bigint generated always as identity,
  transaction_id bigint not null,
  table_name text not null,
  row_id text not null,
  row_data jsonb,
  created_at timestamptz not null default now(),
  primary key (workspace_id, revision)
);
create index if not exists sync_changes_transaction on public.sync_changes(transaction_id);
-- the scope fallback (a child row deleted with its parent) looks up a row's last workspace. Only these
-- tables are looked up, and they are small next to messages, so the index is partial
create index if not exists sync_changes_parent on public.sync_changes(row_id, table_name)
  where table_name in ('agents', 'repos', 'channels', 'agent_channels', 'project_repos', 'channel_members');
create index if not exists sync_changes_created on public.sync_changes using brin(created_at);
alter table public.sync_heads enable row level security;
alter table public.sync_changes enable row level security;

-- only when missing: ALTER TABLE takes ACCESS EXCLUSIVE even when the column exists
do $notify$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'local_sync_state' and column_name = 'notify') then
    alter table public.local_sync_state add column notify boolean not null default true;
  end if;
end $notify$;

insert into public.sync_changes (workspace_id, revision, transaction_id, table_name, row_id, row_data, created_at)
select workspace_id, row_number() over (partition by workspace_id order by revision), transaction_id, table_name, row_id, row_data, created_at
  from public.local_sync_changes
 where not exists (select 1 from public.sync_changes)
 order by revision;
insert into public.sync_heads (workspace_id, revision)
select workspace_id, max(revision) from public.sync_changes group by workspace_id
on conflict (workspace_id) do update set revision = greatest(sync_heads.revision, excluded.revision);

-- The workspace of a synced row, as the triggers see it. The three child tables have no workspace
-- column: they take their parent's.
create or replace function public.sync_row_workspace(tbl text, payload jsonb) returns uuid language plpgsql stable as $$
declare ws uuid;
begin
  if payload is null then return null; end if;
  if tbl = 'agent_channels' then select workspace_id into ws from public.agents where id = (payload->>'agent_id')::uuid;
  elsif tbl = 'project_repos' then select workspace_id into ws from public.repos where id = (payload->>'repo_id')::uuid;
  elsif tbl = 'channel_members' then select workspace_id into ws from public.channels where id = (payload->>'channel_id')::uuid;
  else ws := (payload->>'workspace_id')::uuid;
  end if;
  return ws;
end $$;

-- The workspace's last change of a row, for a row whose parent is already gone (a cascade)
create or replace function public.sync_last_workspace(tbl text, id text) returns uuid language sql stable as $$
  select workspace_id from public.sync_changes where table_name = tbl and row_id = id order by seq desc limit 1
$$;

-- IMMEDIATE, per row: note the workspaces this transaction writes, so the commit can lock them in one
-- order. Cheap on purpose: it reads the row's workspace column (or one parent row) and nothing else.
create or replace function public.note_sync_workspace() returns trigger language plpgsql as $$
declare noted text; ws uuid; old_ws uuid;
begin
  if tg_table_name = 'agent_channels' then
    if tg_op <> 'DELETE' then select workspace_id into ws from public.agents where id = new.agent_id; end if;
    if tg_op <> 'INSERT' then select workspace_id into old_ws from public.agents where id = old.agent_id; end if;
  elsif tg_table_name = 'project_repos' then
    if tg_op <> 'DELETE' then select workspace_id into ws from public.repos where id = new.repo_id; end if;
    if tg_op <> 'INSERT' then select workspace_id into old_ws from public.repos where id = old.repo_id; end if;
  elsif tg_table_name = 'channel_members' then
    if tg_op <> 'DELETE' then select workspace_id into ws from public.channels where id = new.channel_id; end if;
    if tg_op <> 'INSERT' then select workspace_id into old_ws from public.channels where id = old.channel_id; end if;
  else
    if tg_op <> 'DELETE' then ws := new.workspace_id; end if;
    if tg_op <> 'INSERT' then old_ws := old.workspace_id; end if;
  end if;
  noted := coalesce(current_setting('nm.sync_noted', true), '');
  if ws is not null and strpos(noted, ws::text) = 0 then noted := noted || ws::text || ','; end if;
  if old_ws is not null and strpos(noted, old_ws::text) = 0 then noted := noted || old_ws::text || ','; end if;
  if noted <> coalesce(current_setting('nm.sync_noted', true), '') then perform set_config('nm.sync_noted', noted, true); end if;
  return null;
end $$;

-- Lock one workspace's head for the rest of this transaction, creating it on first use, and NOTIFY
-- its waiters (delivered at COMMIT, once per workspace).
create or replace function public.lock_sync_head(ws uuid) returns void language plpgsql as $$
declare locked text := coalesce(current_setting('nm.sync_locked', true), '');
begin
  if strpos(locked, ws::text) > 0 then return; end if;
  insert into public.sync_heads (workspace_id) values (ws) on conflict (workspace_id) do nothing;
  perform 1 from public.sync_heads where workspace_id = ws for update;
  if coalesce((select notify from public.local_sync_state where singleton), true) then
    perform pg_notify('nm_sync', ws::text);
  end if;
  perform set_config('nm.sync_locked', locked || ws::text || ',', true);
end $$;

-- DEFERRED to COMMIT, per row: the change itself. tg_argv names the columns the payload leaves out.
create or replace function public.record_sync_change() returns trigger language plpgsql as $$
declare
  payload jsonb; old_payload jsonb; scope uuid; old_scope uuid; rev bigint; ws uuid;
  heavy text[] := coalesce(tg_argv::text[], '{}');
begin
  if not coalesce((select enabled from public.local_sync_state where singleton), false) then return null; end if;
  payload := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end - heavy;
  old_payload := case when tg_op = 'UPDATE' then to_jsonb(old) - heavy else null end;
  -- nothing a client reads changed (an embedding filled in, a no-op update): no change to record
  if tg_op = 'UPDATE' and payload = old_payload then return null; end if;
  scope := public.sync_row_workspace(tg_table_name, payload);
  if scope is null and tg_table_name in ('agent_channels', 'project_repos', 'channel_members') then
    -- the parent went first, in this transaction: its own last change still names the workspace
    scope := public.sync_last_workspace(case tg_table_name when 'agent_channels' then 'agents' when 'project_repos' then 'repos' else 'channels' end,
      payload->>case tg_table_name when 'agent_channels' then 'agent_id' when 'project_repos' then 'repo_id' else 'channel_id' end);
  end if;
  if scope is null then scope := public.sync_last_workspace(tg_table_name, payload->>'id'); end if;
  if scope is null then return null; end if;
  old_scope := public.sync_row_workspace(tg_table_name, old_payload);

  -- the first change this transaction records locks every workspace it noted, in one order
  if coalesce(current_setting('nm.sync_locked', true), '') = '' then
    for ws in select distinct w::uuid from unnest(string_to_array(coalesce(current_setting('nm.sync_noted', true), ''), ',')) w where w <> '' order by 1 loop
      perform public.lock_sync_head(ws);
    end loop;
  end if;
  -- a row that moved workspace: the old workspace's readers lose it
  if old_scope is not null and old_scope <> scope then
    perform public.lock_sync_head(old_scope);
    update public.sync_heads set revision = revision + 1 where workspace_id = old_scope returning revision into rev;
    insert into public.sync_changes (workspace_id, revision, transaction_id, table_name, row_id, row_data)
      values (old_scope, rev, txid_current(), tg_table_name, payload->>'id', null);
  end if;
  perform public.lock_sync_head(scope);
  update public.sync_heads set revision = revision + 1 where workspace_id = scope returning revision into rev;
  insert into public.sync_changes (workspace_id, revision, transaction_id, table_name, row_id, row_data)
    values (scope, rev, txid_current(), tg_table_name, payload->>'id', case when tg_op = 'DELETE' then null else payload end);
  return null;
end $$;

-- Install the feed's triggers on every synced table that lacks them, with each table's heavy columns
-- read from the catalog. A later migration that adds a vector or tsvector column calls it with
-- `force_replace => true`, which drops and recreates them (ACCESS EXCLUSIVE: take the tables first, as this
-- file does). If it does not, the column only rides the log: the API still serves contract columns
-- alone (localReplicaRow).
drop function if exists public.install_sync_triggers();
create or replace function public.install_sync_triggers(force_replace boolean default false) returns void language plpgsql as $$
declare t text; heavy text; present boolean;
begin
  foreach t in array array['channels','projects','messages','threads','tasks','machines','agents',
    'agent_channels','repos','project_repos','artifacts','beats','runs','decisions','policies',
    'memory_blocks','skills','skill_packs','schedules','content_items','connectors',
    'workspace_members','channel_members','whiteboards','code_sessions','reply_reminders'] loop
    select coalesce(string_agg(quote_literal(a.attname), ',' order by a.attnum), '') into heavy
      from pg_attribute a
     where a.attrelid = format('public.%I', t)::regclass and a.attnum > 0 and not a.attisdropped
       and (a.atttypid = 'tsvector'::regtype or format_type(a.atttypid, a.atttypmod) like 'vector%');
    select exists (select 1 from pg_trigger where tgrelid = format('public.%I', t)::regclass and tgname = 'sync_change') into present;
    if present and not force_replace then continue; end if;
    if present then
      execute format('drop trigger if exists sync_note on public.%I', t);
      execute format('drop trigger if exists sync_change on public.%I', t);
    end if;
    execute format('create trigger sync_note after insert or update or delete on public.%I for each row execute function public.note_sync_workspace()', t);
    execute format('create constraint trigger sync_change after insert or update or delete on public.%I deferrable initially deferred for each row execute function public.record_sync_change(%s)', t, heavy);
  end loop;
end $$;

-- The 0152 triggers stay, calling these no-ops, so that nothing here needs ACCESS EXCLUSIVE. A BEFORE
-- DELETE trigger that returned null would cancel the delete, so the row function returns the row.
create or replace function public.lock_local_sync_revision() returns trigger language plpgsql as $$
begin
  return null;
end $$;
create or replace function public.record_local_sync_change() returns trigger language plpgsql as $$
begin
  return coalesce(new, old);
end $$;

select public.install_sync_triggers();
