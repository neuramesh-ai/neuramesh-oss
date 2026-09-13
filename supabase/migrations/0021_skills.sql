-- Agent Skills (docs/decisions 2026-06-13): the third memory tier — reusable
-- named procedures agents + humans author and apply, so the team compounds
-- competence instead of rediscovering. SKILL.md-shaped: frontmatter
-- (name/description/scope) + markdown body. Channel-scoped by default,
-- promotable to workspace-global. Slice 1 is human-authored + active; agent
-- self-authoring (draft → curate, versioned/dedup) lands in slice 2.
create table skills (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  channel_id uuid references channels (id) on delete cascade, -- null = global
  name text not null,
  description text not null default '',
  scope text not null default 'channel' check (scope in ('channel', 'global')),
  body text not null default '',
  status text not null default 'active' check (status in ('draft', 'active', 'deprecated')),
  author_kind actor_kind not null,
  author_id uuid not null,
  version int not null default 1,
  superseded_by uuid references skills (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- one ACTIVE skill per name per scope (a channel, or the global namespace)
create unique index skills_name_channel on skills (workspace_id, channel_id, name) where status = 'active' and channel_id is not null;
create unique index skills_name_global on skills (workspace_id, name) where status = 'active' and channel_id is null;
create index skills_ws on skills (workspace_id, status);

alter table skills enable row level security;
create policy members_read on skills for select using (nm_is_member(workspace_id));
