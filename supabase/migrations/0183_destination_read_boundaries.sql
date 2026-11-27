-- Destination privacy also applies to legacy authenticated database reads. Current
-- clients use the scoped API replica; restricted project brand profiles must not be
-- exposed through a table-wide legacy SELECT grant.
alter table channels add column restricted_destination text check(restricted_destination is null or restricted_destination='marketing');
create function nm_keep_marketing_scope() returns trigger language plpgsql as $$
begin
  if new.kind='marketing' or (tg_op='UPDATE' and old.restricted_destination='marketing') then new.restricted_destination='marketing'; end if;
  return new;
end $$;
create trigger nm_keep_marketing_scope before insert or update on channels for each row execute function nm_keep_marketing_scope();
create or replace function nm_marketing_row(w uuid, tab text, r jsonb) returns boolean language plpgsql stable as $$
declare cid uuid; tid uuid; taskid uuid; sid uuid;
begin
  if tab in ('content_items','reply_reminders','events') then return true; end if;
  if tab='connectors' and coalesce(r->>'provider','') <> 'github' then return true; end if;
  if tab='channels' then
    if r->>'kind'='marketing' or r->>'restricted_destination'='marketing' then return true; end if;
    return not exists(select 1 from channels where id=(r->>'id')::uuid and workspace_id=w and restricted_destination is null);
  end if;
  if coalesce(r->>'channel_id','') ~ '^[0-9a-f-]{36}$' then cid=(r->>'channel_id')::uuid; end if;
  if cid is null and coalesce(r->>'task_id','') ~ '^[0-9a-f-]{36}$' then
    taskid=(r->>'task_id')::uuid; select channel_id into cid from tasks where id=taskid and workspace_id=w;
  end if;
  if cid is null and coalesce(r->>'thread_id','') ~ '^[0-9a-f-]{36}$' then
    tid=(r->>'thread_id')::uuid; select channel_id into cid from threads where id=tid and workspace_id=w;
  end if;
  if cid is null and coalesce(r->>'schedule_id','') ~ '^[0-9a-f-]{36}$' then
    sid=(r->>'schedule_id')::uuid; select channel_id into cid from schedules where id=sid and workspace_id=w;
  end if;
  if tab='memory_blocks' and cid is null then return true; end if;
  if cid is null and (taskid is not null or tid is not null or sid is not null) then return true; end if;
  if cid is not null and not exists(select 1 from channels where id=cid and workspace_id=w) then return true; end if;
  return coalesce(exists(select 1 from channels where id=cid and workspace_id=w and (kind='marketing' or restricted_destination='marketing')),false);
end $$;

-- These bounded boolean helpers must read the membership/parent rows without
-- recursively entering their own RLS policies. No data payload is returned.
alter function nm_is_member(uuid) security definer;
alter function nm_is_member(uuid) set search_path=pg_catalog,public,pg_temp;
alter function nm_destination_access(uuid,text,uuid,text) security definer;
alter function nm_destination_access(uuid,text,uuid,text) set search_path=pg_catalog,public,pg_temp;
alter function nm_marketing_row(uuid,text,jsonb) security definer;
alter function nm_marketing_row(uuid,text,jsonb) set search_path=pg_catalog,public,pg_temp;
do $$ declare tab text; safe_columns text; role_name text;
begin
  foreach tab in array array['channels','threads','tasks','messages','artifacts','beats','runs','decisions','memory_blocks','facts','schedules','content_items','connectors','whiteboards','code_sessions','reply_reminders','events'] loop
    execute format('alter table %I enable row level security',tab);
    execute format('create policy destination_member_read on %I for select using (nm_is_member(workspace_id))',tab);
    execute format('create policy destination_restricted_read on %I as restrictive for select using (not nm_marketing_row(workspace_id,%L,to_jsonb(%I)) or nm_destination_access(workspace_id,''human'',auth.uid(),''marketing''))',tab,tab,tab);
  end loop;
  create policy destination_channel_members_read on channel_members as restrictive for select using (exists(select 1 from channels c where c.id=channel_id));
  create policy destination_agent_channels_read on agent_channels as restrictive for select using (exists(select 1 from channels c where c.id=channel_id));
  -- Column grants compose with RLS: direct callers may read public project metadata,
  -- and use the authorized API for brand profiles. Control-api retains its SQL role.
  select string_agg(quote_ident(column_name),',') into safe_columns from information_schema.columns where table_schema='public' and table_name='projects' and column_name<>'brand_profile';
  revoke select on projects from public;
  foreach role_name in array array['authenticated','anon'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke select on projects from %I',role_name);
      execute format('revoke select(brand_profile) on projects from %I',role_name);
      execute format('grant select(%s) on projects to %I',safe_columns,role_name);
    end if;
  end loop;
end $$;
update channels set restricted_destination='marketing' where kind='marketing';
insert into workspace_destination_revisions(workspace_id,destination,revision)
select distinct workspace_id,'marketing',1 from channels where restricted_destination='marketing'
on conflict(workspace_id,destination) do update set revision=workspace_destination_revisions.revision+1;
