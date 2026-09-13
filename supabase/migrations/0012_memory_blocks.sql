-- Memory spine slice 1 (docs/03 §6): one small, editable, always-in-context
-- summary block per channel, refreshed by a sleep-time worker on the
-- orchestrator's machine. Project briefs share the table (kind).
create table memory_blocks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  project_id uuid references projects (id) on delete cascade,
  kind text not null default 'channel_summary' check (kind in ('channel_summary', 'project_brief')),
  content text not null default '',
  basis_count int not null default 0,
  updated_at timestamptz not null default now()
);
create unique index memory_blocks_channel on memory_blocks (channel_id, kind) where project_id is null;
create unique index memory_blocks_project on memory_blocks (project_id, kind) where project_id is not null;
alter table memory_blocks enable row level security;
create policy members_read on memory_blocks for select using (nm_is_member(workspace_id));
