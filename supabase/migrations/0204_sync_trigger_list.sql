-- THE SYNC TRIGGER LIST, WITH EVERY SYNCED TABLE (docs/design/inbox-sales-2026-11/plan.md I12 and S1).
-- 0201 added sales_contacts and sales_deals to install_sync_triggers, and 0203 wrote the function again from the
-- list it knew, without them. Their triggers stay in place, because a run without force_replace keeps a trigger
-- that exists. But a later run with force_replace would skip the two tables. This writes the function once more,
-- with the whole list. 0203 is not changed, because a migration that ran is never written again.
set local lock_timeout = '5s';
create or replace function public.install_sync_triggers(force_replace boolean default false) returns void language plpgsql as $$
declare t text; heavy text; present boolean;
begin
  foreach t in array array['channels','projects','messages','threads','tasks','machines','agents',
    'agent_channels','repos','project_repos','artifacts','beats','runs','decisions','policies',
    'memory_blocks','skills','skill_packs','schedules','content_items','connectors',
    'workspace_members','channel_members','whiteboards','code_sessions','reply_reminders',
    'project_agents','email_drafts','sales_contacts','sales_deals','mail_grants'] loop
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
-- nothing to install: every table of the list has its triggers. This only puts the list right
select public.install_sync_triggers();
