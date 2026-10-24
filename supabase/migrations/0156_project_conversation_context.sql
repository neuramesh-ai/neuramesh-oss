-- Project defaults are explicit. The address is retained solely for the supported
-- desktop/machine protocol. Historical addresses keep their original access grants.
alter table projects add column context_channel_id uuid references channels(id) on delete set null;
alter table projects add column brand_profile jsonb;
alter table projects add column settings jsonb not null default '{}'::jsonb;

-- Empty projects must be usable without asking a person to create a room.
insert into channels(workspace_id, project_id, slug)
  select p.workspace_id, p.id, 'general' from projects p
  where not exists (select 1 from channels c where c.project_id = p.id);
update projects p set context_channel_id = (
  select c.id from channels c where c.project_id = p.id and c.workspace_id = p.workspace_id
  order by (c.slug = 'general') desc, c.id limit 1
);
update projects p set settings = c.settings from channels c where c.id = p.context_channel_id;
-- Copy only an unambiguous brand. Distinct historical profiles stay on their source
-- records and are not merged or overwritten by this migration.
update projects p set brand_profile = (
  select c.marketing from channels c where c.project_id = p.id and c.marketing is not null
  order by c.id limit 1
) where (select count(distinct (c.marketing - 'setup_at' - 'setup_by')) from channels c
  where c.project_id = p.id and c.marketing is not null) = 1;

create function nm_project_context_guard() returns trigger language plpgsql as $$
begin
  if new.context_channel_id is not null and not exists (
    select 1 from channels c where c.id = new.context_channel_id and c.project_id = new.id and c.workspace_id = new.workspace_id
  ) then
    raise exception 'Project context must belong to this project and workspace.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger projects_context_guard before insert or update of context_channel_id, workspace_id
  on projects for each row execute function nm_project_context_guard();

create table project_agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(project_id, agent_id)
);
-- Do not union access from unrelated historical addresses. The default context's
-- existing roster is the initial project team. A new project starts with its lead.
insert into project_agents(workspace_id, project_id, agent_id)
  select p.workspace_id, p.id, ac.agent_id from projects p
  join agent_channels ac on ac.channel_id = p.context_channel_id;
alter table project_agents enable row level security;
create policy project_agents_read on project_agents for select using (nm_is_member(workspace_id));

-- Old clients still register through agent_channels. Mirror ONLY the project's
-- compatibility address. Historical grants remain specific to their old threads.
create function nm_context_agent_to_project() returns trigger language plpgsql as $$
declare ch uuid; ag uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then ch := old.channel_id; ag := old.agent_id; else ch := new.channel_id; ag := new.agent_id; end if;
  if tg_op = 'DELETE' then
    delete from project_agents pa using projects p where pa.project_id = p.id and p.context_channel_id = ch and pa.agent_id = ag;
  else
    insert into project_agents(workspace_id, project_id, agent_id)
      select p.workspace_id, p.id, ag from projects p join agents a on a.id = ag and a.workspace_id = p.workspace_id
      where p.context_channel_id = ch on conflict do nothing;
  end if;
  return null;
end $$;
create trigger context_agent_to_project after insert or delete on agent_channels
  for each row execute function nm_context_agent_to_project();

create function nm_project_agent_to_context() returns trigger language plpgsql as $$
declare p projects; ag uuid;
begin
  if tg_op = 'DELETE' then select * into p from projects where id = old.project_id; ag := old.agent_id;
  else
    select * into p from projects where id = new.project_id and workspace_id = new.workspace_id;
    ag := new.agent_id;
    if p.id is null or not exists (select 1 from agents a where a.id = ag and a.workspace_id = p.workspace_id) then
      raise exception 'Project agent must belong to this workspace.' using errcode = '23514';
    end if;
  end if;
  if pg_trigger_depth() > 1 or p.context_channel_id is null then return null; end if;
  if tg_op = 'DELETE' then delete from agent_channels where channel_id = p.context_channel_id and agent_id = ag;
  else insert into agent_channels(channel_id, agent_id) values (p.context_channel_id, ag) on conflict do nothing;
  end if;
  return null;
end $$;
create trigger project_agent_to_context after insert or delete on project_agents
  for each row execute function nm_project_agent_to_context();

create function nm_project_context_roster() returns trigger language plpgsql as $$
begin
  -- The context is initialized after project creation has populated its compatibility address.
  insert into project_agents(workspace_id, project_id, agent_id)
    select new.workspace_id, new.id, ac.agent_id from agent_channels ac
    join agents a on a.id = ac.agent_id and a.workspace_id = new.workspace_id
    where ac.channel_id = new.context_channel_id on conflict do nothing;
  return null;
end $$;
create trigger project_context_roster after update of context_channel_id on projects
  for each row when (old.context_channel_id is distinct from new.context_channel_id)
  execute function nm_project_context_roster();
