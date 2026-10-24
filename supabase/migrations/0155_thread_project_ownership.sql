-- Channel retirement, first additive step. Old clients still write channel_id.
-- Existing threads stay nullable until the bounded backfill runs. No history,
-- permissions, policies, timestamps or publication addresses change here.
alter table threads add column project_id uuid references projects(id) on delete restrict;
create index threads_project_idx on threads(project_id, updated_at desc);

create function nm_thread_project_guard() returns trigger language plpgsql as $$
declare owner_project uuid;
begin
  -- SHARE serializes a thread write with channel reassignment. KEY SHARE would
  -- permit a concurrent project_id update and could leave the projection stale.
  select c.project_id into owner_project from channels c
    join projects p on p.id = c.project_id and p.workspace_id = c.workspace_id
    where c.id = new.channel_id and c.workspace_id = new.workspace_id
    for share of c;
  if owner_project is null then
    raise exception 'The thread channel and project must belong to its workspace.' using errcode = '23514';
  end if;
  if new.project_id is null then
    new.project_id := owner_project;
  elsif tg_op = 'UPDATE' then
    -- An old client moves only channel_id. A supplied, different project must
    -- agree with that channel. Never silently replace an explicit conflict.
    if new.channel_id is distinct from old.channel_id and new.project_id is not distinct from old.project_id then
      new.project_id := owner_project;
    end if;
  end if;
  if new.project_id <> owner_project then
    raise exception 'The thread project must match its channel project.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger threads_project_guard before insert or update of channel_id, project_id, workspace_id
  on threads for each row execute function nm_thread_project_guard();

create function nm_channel_project_guard() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from projects p where p.id = new.project_id and p.workspace_id = new.workspace_id) then
    raise exception 'The channel project must belong to its workspace.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger channels_project_guard before insert or update of project_id, workspace_id
  on channels for each row execute function nm_channel_project_guard();

create function nm_channel_project_follow() returns trigger language plpgsql as $$
begin
  -- Covers channel.assign, project.create with existing rooms, and old writers.
  -- A move remains atomic and does not make old work appear newly active.
  update threads set project_id = new.project_id where channel_id = new.id;
  update tasks set project_id = new.project_id where channel_id = new.id;
  return new;
end $$;
create trigger channels_project_follow after update of project_id on channels
  for each row when (old.project_id is distinct from new.project_id)
  execute function nm_channel_project_follow();
