-- PROJECT TEAMS ON THE PER-WORKSPACE FEED (round 7, after the upstream merge).
--
-- Upstream 0156 added project_agents (a project's agent team) and put it in the client contract
-- (packages/client-core/src/schema.ts). Upstream 0159_project_replica_feed then wired it to the 0152
-- feed: lock_local_sync_revision() and record_local_sync_change(). Our 0159_sync_workspace_revisions
-- made both of those no-ops and moved the feed to sync_changes, with its own triggers on a fixed list of
-- 26 tables. In every order the two files can run, project_agents was on neither feed, so a desktop,
-- HQ tab or machine never learned that an agent joined or left a project after its first snapshot.
--
-- This file adds project_agents to install_sync_triggers() and installs its triggers. The table has its
-- own workspace_id, so sync_row_workspace and note_sync_workspace need no change. The 3 upstream 0152
-- triggers on it stay and call the no-ops (harmless, and DROP TRIGGER would want ACCESS EXCLUSIVE).
--
-- Locks: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on project_agents only (writers wait, readers do not).
-- It is a small table written by team changes, so lock_timeout is enough. Idempotent: a second run
-- finds the triggers present and changes nothing.
set local lock_timeout = '5s';

create or replace function public.install_sync_triggers(force_replace boolean default false) returns void language plpgsql as $$
declare t text; heavy text; present boolean;
begin
  foreach t in array array['channels','projects','messages','threads','tasks','machines','agents',
    'agent_channels','repos','project_repos','artifacts','beats','runs','decisions','policies',
    'memory_blocks','skills','skill_packs','schedules','content_items','connectors',
    'workspace_members','channel_members','whiteboards','code_sessions','reply_reminders',
    'project_agents'] loop
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

-- the rows that exist already reach a client through its next snapshot (a new schema hash resets
-- every cursor), so no backfill of sync_changes is needed
select public.install_sync_triggers();
