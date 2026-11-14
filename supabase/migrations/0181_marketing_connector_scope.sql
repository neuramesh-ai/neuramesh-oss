-- Build GitHub connections remain available to coding members. Marketing GitHub rooms
-- still follow the channel classification below, like their threads and artifacts.
create or replace function nm_marketing_row(w uuid, tab text, r jsonb) returns boolean language plpgsql stable as $$
declare cid uuid; tid uuid; taskid uuid; sid uuid;
begin
  if tab in ('content_items','reply_reminders') then return true; end if;
  if tab='connectors' and coalesce(r->>'provider','') <> 'github' then return true; end if;
  if tab='channels' then return coalesce(r->>'kind'='marketing',false); end if;
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
  return coalesce(exists(select 1 from channels where id=cid and workspace_id=w and kind='marketing'),false);
end $$;
