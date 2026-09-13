-- Projects become the work axis: workspace-scoped initiatives that span the
-- channels their work happens in. project_channels is the M:N link (mirrors
-- project_repos / agent_channels); projects.channel_id stays as the primary/home
-- channel pointer, so the per-channel default project + its partial unique index
-- are unchanged and there's zero data-migration risk. docs/06-taxonomy.md, docs/03 §9.

create table project_channels (
  -- PowerSync keys every replicated row by a single `id` (0008): a composite-PK-only
  -- table collapses to one visible row on the client, so carry an explicit id.
  id uuid not null default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (project_id, channel_id)
);

create unique index project_channels_id on project_channels (id);
create unique index project_channels_one_primary on project_channels (project_id) where is_primary;
create index project_channels_by_channel on project_channels (channel_id);

-- backfill: every existing project's current channel becomes its primary
-- association, so the link table is the complete source of truth from day one.
insert into project_channels (workspace_id, project_id, channel_id, is_primary)
  select workspace_id, id, channel_id, true from projects
  on conflict do nothing;

-- the top-left switcher lists projects workspace-wide, grouped by status.
create index projects_by_workspace on projects (workspace_id, status);

-- PowerSync: replicate the link to clients read-only (mirrors 0005). In production
-- the publication already exists (0002), so this adds the table; the dev stack
-- creates the publication later in 99-publication.sql (which lists this table), so
-- guard on the publication existing to stay a no-op there. Cloud rules live in the
-- dashboard — the workspace sync rule needs the matching
-- `select * from project_channels where workspace_id in (...)` line added there too.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'powersync')
     and not exists (select 1 from pg_publication_tables where pubname = 'powersync' and tablename = 'project_channels') then
    alter publication powersync add table public.project_channels;
  end if;
end $$;
