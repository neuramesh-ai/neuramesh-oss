-- Projects own channels (1:N): each channel belongs to exactly one project. This
-- replaces the M:N project_channels (0034) and the per-channel default projects
-- (0001) with ONE default project per workspace that holds the workspace's
-- channels. The work axis is now a clean hierarchy — Workspace → Projects →
-- Channels — and a task's project is simply its channel's project. The top-left
-- switcher selects one project at a time. docs/06-taxonomy.md, docs/03 §9.

-- 1. channel ownership (nullable during backfill)
alter table channels add column project_id uuid references projects (id) on delete restrict;

-- 2. consolidate each workspace to ONE default project holding all its channels
do $$
declare w record; canon uuid;
begin
  for w in (select id from workspaces) loop
    -- canonical default: the existing #general default project if present, else the
    -- oldest default, else a freshly created one
    select p.id into canon
      from projects p left join channels c on c.id = p.channel_id
      where p.workspace_id = w.id and p.is_default = true
      order by (c.slug = 'general') desc nulls last, p.created_at asc
      limit 1;
    if canon is null then
      insert into projects (workspace_id, name, slug, is_default, status)
        values (w.id, 'General', 'general', true, 'active')
        returning id into canon;
    end if;
    -- re-point tasks off the redundant per-channel default projects, then drop them.
    -- user-created projects are is_default=false and are preserved (they start with
    -- no channels — the user assigns channels into them).
    update tasks set project_id = canon
      where workspace_id = w.id
        and project_id in (select id from projects where workspace_id = w.id and is_default = true and id <> canon);
    delete from projects where workspace_id = w.id and is_default = true and id <> canon;
    -- every channel in the workspace now belongs to the canonical default project
    update channels set project_id = canon where workspace_id = w.id;
  end loop;
end $$;

-- 3. enforce: every channel belongs to a project
alter table channels alter column project_id set not null;

-- 4. one default per WORKSPACE (was per channel); fast project→channels lookup
drop index if exists projects_one_default_per_channel;
create unique index projects_one_default_per_workspace on projects (workspace_id) where is_default;
create index channels_by_project on channels (project_id);

-- 5. the M:N link is gone (dropping the table removes it from the publication)
drop table if exists project_channels;

-- 6. projects.channel_id was the ownership link (and the per-channel-default key);
--    ownership now lives on channels.project_id, so drop it. Its unique(channel_id,
--    slug) goes with it — replace with workspace-level slug uniqueness for the switcher.
alter table projects drop column channel_id;
alter table projects add constraint projects_workspace_slug_key unique (workspace_id, slug);
