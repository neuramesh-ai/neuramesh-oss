-- Direct ownership for the remaining work/library records. Nullable only for a
-- resumable backfill and workspace-global skills. Source channel IDs are provenance
-- and the legacy wire address, never another navigation layer.
alter table schedules add column project_id uuid references projects(id) on delete restrict;
alter table content_items add column project_id uuid references projects(id) on delete restrict;
alter table whiteboards add column project_id uuid references projects(id) on delete restrict;
alter table facts add column project_id uuid references projects(id) on delete restrict;
alter table skills add column project_id uuid references projects(id) on delete restrict;
alter table skill_packs add column project_id uuid references projects(id) on delete restrict;
create index schedules_project on schedules(project_id);
create index content_items_project on content_items(project_id);
create index whiteboards_project on whiteboards(project_id);
create index facts_project on facts(project_id);
create index skills_project on skills(project_id);
create index skill_packs_project on skill_packs(project_id);

create function nm_work_project_guard() returns trigger language plpgsql as $$
declare owner_project uuid;
begin
  if new.channel_id is null then
    if new.project_id is null then return new; end if; -- global skill
    select p.context_channel_id into new.channel_id from projects p
      where p.id = new.project_id and p.workspace_id = new.workspace_id;
  end if;
  select c.project_id into owner_project from channels c
    where c.id = new.channel_id and c.workspace_id = new.workspace_id for share;
  if owner_project is null then raise exception 'Work must belong to a project in its workspace.' using errcode = '23514'; end if;
  if new.project_id is null then new.project_id := owner_project;
  elsif tg_op = 'UPDATE' then
    if new.channel_id is distinct from old.channel_id and new.project_id is not distinct from old.project_id then new.project_id := owner_project; end if;
  end if;
  if new.project_id <> owner_project then raise exception 'Work and its conversation address must belong to the same project.' using errcode = '23514'; end if;
  return new;
end $$;
do $$ declare tbl text; begin
  foreach tbl in array array['tasks','schedules','content_items','whiteboards','facts','skills','skill_packs'] loop
    execute format('create trigger %I before insert or update of workspace_id, channel_id, project_id on %I for each row execute function nm_work_project_guard()', tbl || '_project_guard', tbl);
  end loop;
end $$;

create or replace function nm_channel_project_follow() returns trigger language plpgsql as $$
declare context_id uuid := gen_random_uuid(); context_slug text;
begin
  update threads set project_id = new.project_id where channel_id = new.id;
  update tasks set project_id = new.project_id where channel_id = new.id;
  update schedules set project_id = new.project_id where channel_id = new.id;
  update content_items set project_id = new.project_id where channel_id = new.id;
  update whiteboards set project_id = new.project_id where channel_id = new.id;
  update facts set project_id = new.project_id where channel_id = new.id;
  update skills set project_id = new.project_id where channel_id = new.id;
  update skill_packs set project_id = new.project_id where channel_id = new.id;
  -- A legacy room move must not move the old project's default address or team.
  -- Give it a new empty transport address. Never re-grant agents to historical work.
  if exists (select 1 from projects where id = old.project_id and context_channel_id = new.id) then
    context_slug := case when exists (select 1 from channels where project_id = old.project_id and slug = 'general') then 'context-' || left(context_id::text, 8) else 'general' end;
    insert into channels(id, workspace_id, project_id, slug) values(context_id, old.workspace_id, old.project_id, context_slug);
    update projects set context_channel_id = context_id where id = old.project_id;
    insert into agent_channels(channel_id, agent_id) select context_id, agent_id from project_agents where project_id = old.project_id on conflict do nothing;
  end if;
  return new;
end $$;

-- Context roster IDs are immutable. Membership changes are insert/delete, so every
-- writer crosses the same workspace validation and compatibility bridge.
create function nm_project_agent_immutable() returns trigger language plpgsql as $$
begin
  if new.workspace_id <> old.workspace_id or new.project_id <> old.project_id or new.agent_id <> old.agent_id then
    raise exception 'Replace project membership with an explicit remove/add.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger project_agent_immutable before update on project_agents for each row execute function nm_project_agent_immutable();

-- The publication may not exist yet on a new installation.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'powersync' and not puballtables)
    and not exists (select 1 from pg_publication_tables where pubname = 'powersync' and tablename = 'project_agents') then
    alter publication powersync add table project_agents;
  end if;
end $$;
-- Artifact library ownership is direct. A promoted file may deliberately have a
-- different library project from its source conversation, so retain that provenance.
create function nm_artifact_project_guard() returns trigger language plpgsql as $$
declare source_project uuid;
begin
  if new.channel_id is not null then
    select c.project_id into source_project from channels c where c.id = new.channel_id and c.workspace_id = new.workspace_id;
    if source_project is null then raise exception 'Artifact source must belong to its workspace.' using errcode = '23514'; end if;
    if new.project_id is null then new.project_id := source_project; end if;
  end if;
  if new.project_id is not null and not exists (select 1 from projects p where p.id = new.project_id and p.workspace_id = new.workspace_id) then
    raise exception 'Artifact project must belong to its workspace.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger artifacts_project_guard before insert or update of workspace_id, channel_id, project_id on artifacts
  for each row execute function nm_artifact_project_guard();
