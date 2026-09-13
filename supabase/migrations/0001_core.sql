-- NeuraMesh core schema (docs/03). Writes flow through the control-api with
-- the Supabase service role; clients get read-only replication (PowerSync).
-- RLS select policies scope reads to workspace members.

create extension if not exists pgcrypto;

create type actor_kind as enum ('human', 'agent');
create type agent_role as enum ('worker', 'reviewer', 'orchestrator');
create type project_status as enum ('active', 'archived');
create type artifact_kind as enum ('screenshot', 'test_report', 'diff', 'doc', 'file');
create type task_state as enum ('todo', 'in_progress', 'blocked', 'in_review', 'done', 'accepted', 'closed');

-- ── tenancy ────────────────────────────────────────────────────────────────

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ── channels & projects ────────────────────────────────────────────────────

create table channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  slug text not null,
  topic text not null default '',
  -- orchestrator_agent_id, acceptance_policy, pr_at
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table channel_members (
  channel_id uuid not null references channels (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  name text not null,
  slug text not null,
  description text not null default '',
  status project_status not null default 'active',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (channel_id, slug)
);

create unique index projects_one_default_per_channel on projects (channel_id) where is_default;

create table repos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  provider text not null default 'github',
  org_name text not null,
  name text not null,
  default_branch text not null default 'main',
  clone_url text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, provider, org_name, name)
);

create table project_repos (
  project_id uuid not null references projects (id) on delete cascade,
  repo_id uuid not null references repos (id) on delete cascade,
  is_primary boolean not null default false,
  primary key (project_id, repo_id)
);

create unique index project_repos_one_primary on project_repos (project_id) where is_primary;

-- ── fleet ──────────────────────────────────────────────────────────────────

create table machines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id),
  name text not null,
  platform text not null default 'darwin',
  daemon_version text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  machine_id uuid not null references machines (id) on delete cascade,
  name text not null,
  role agent_role not null default 'worker',
  runtime text not null default 'claude-code',
  model text not null default 'claude-opus-4-8',
  card jsonb not null default '{}',
  status text not null default 'offline' check (status in ('online', 'offline')),
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

-- Channel registration = fan-out scope + artifact-library ACL (docs/03 §4, §7).
create table agent_channels (
  agent_id uuid not null references agents (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (agent_id, channel_id)
);

-- ── tasks ──────────────────────────────────────────────────────────────────

create table task_counters (
  workspace_id uuid primary key references workspaces (id) on delete cascade,
  last_number int not null
);

create function nm_next_task_number(ws uuid) returns int language sql as $$
  insert into task_counters (workspace_id, last_number)
  values (ws, 1001)
  on conflict (workspace_id) do update set last_number = task_counters.last_number + 1
  returning last_number;
$$;

create table tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  project_id uuid references projects (id) on delete set null,
  number int not null,
  title text not null,
  description text not null default '',
  state task_state not null default 'todo',
  creator_kind actor_kind not null,
  creator_id uuid not null,
  assignee_kind actor_kind,
  assignee_id uuid,
  repo_id uuid references repos (id) on delete set null,
  base_ref text,
  branch text,
  submitted_sha text,
  requirements jsonb,
  requirements_confirmed boolean not null default false,
  artifact_count int not null default 0,
  version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz,
  submitted_at timestamptz,
  accepted_at timestamptz,
  closed_at timestamptz,
  unique (workspace_id, number),
  check ((assignee_kind is null) = (assignee_id is null))
);

create index tasks_board on tasks (channel_id, state, updated_at desc);
create index tasks_project on tasks (project_id, state);

-- Defense-in-depth mirror of packages/shared/src/states.ts TRANSITIONS.
-- Role/evidence guards live in the control-api; the pairs are law everywhere.
create function nm_task_state_guard() returns trigger language plpgsql as $$
begin
  if old.state = new.state then
    return new;
  end if;
  if (old.state, new.state) in (
    ('todo', 'in_progress'), ('todo', 'closed'),
    ('in_progress', 'blocked'), ('blocked', 'in_progress'), ('blocked', 'closed'),
    ('in_progress', 'in_review'), ('in_review', 'in_progress'), ('in_review', 'done'),
    ('done', 'accepted'), ('accepted', 'closed')
  ) then
    return new;
  end if;
  raise exception 'illegal task transition: % -> %', old.state, new.state;
end;
$$;

create trigger tasks_state_guard before update of state on tasks
for each row execute function nm_task_state_guard();

create function nm_tasks_touch() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$$;

create trigger tasks_touch before update on tasks
for each row execute function nm_tasks_touch();

-- ── events (append-only audit log; Option C seed) ─────────────────────────

create table events (
  id text primary key check (char_length(id) = 26),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  type text not null,
  source text not null,
  target text not null,
  channel_id uuid references channels (id) on delete set null,
  task_id uuid references tasks (id) on delete set null,
  payload jsonb not null default '{}',
  in_reply_to text references events (id),
  ts timestamptz not null default now()
);

create index events_workspace_ts on events (workspace_id, ts);
create index events_task on events (task_id, ts);
create index events_channel on events (channel_id, ts);

create function nm_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'events are append-only';
end;
$$;

create trigger events_append_only before update or delete on events
for each row execute function nm_events_append_only();

-- ── messages (task_id set = the task's thread; null = main channel) ───────

create table messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  task_id uuid references tasks (id) on delete cascade,
  author_kind actor_kind not null,
  author_id uuid not null,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index messages_channel on messages (channel_id, created_at) where task_id is null;
create index messages_thread on messages (task_id, created_at) where task_id is not null;

-- ── artifacts (channel library, orchestrator-curated; docs/03 §7) ─────────

create table artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  project_id uuid references projects (id) on delete set null,
  task_id uuid references tasks (id) on delete set null,
  kind artifact_kind not null,
  name text not null,
  tags text[] not null default '{}',
  version int not null default 1,
  content_hash text,
  storage_path text not null,
  size_bytes bigint,
  promoted boolean not null default false,
  promoted_by uuid references agents (id),
  created_by_kind actor_kind not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create index artifacts_library on artifacts (channel_id, promoted, created_at desc);
create index artifacts_task on artifacts (task_id);

-- ── RLS: reads scoped to workspace members; writes via service role ───────

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table channels enable row level security;
alter table channel_members enable row level security;
alter table projects enable row level security;
alter table repos enable row level security;
alter table project_repos enable row level security;
alter table machines enable row level security;
alter table agents enable row level security;
alter table agent_channels enable row level security;
alter table task_counters enable row level security;
alter table tasks enable row level security;
alter table events enable row level security;
alter table messages enable row level security;
alter table artifacts enable row level security;

create function nm_is_member(ws uuid) returns boolean language sql stable as $$
  select exists (
    select 1 from workspace_members m where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

create policy members_read on workspaces for select using (nm_is_member(id));
create policy members_read on workspace_members for select using (nm_is_member(workspace_id));
create policy members_read on channels for select using (nm_is_member(workspace_id));
create policy members_read on channel_members for select using (
  exists (select 1 from channels c where c.id = channel_id and nm_is_member(c.workspace_id))
);
create policy members_read on projects for select using (nm_is_member(workspace_id));
create policy members_read on repos for select using (nm_is_member(workspace_id));
create policy members_read on project_repos for select using (
  exists (select 1 from projects p where p.id = project_id and nm_is_member(p.workspace_id))
);
create policy members_read on machines for select using (nm_is_member(workspace_id));
create policy members_read on agents for select using (nm_is_member(workspace_id));
create policy members_read on agent_channels for select using (
  exists (select 1 from agents a where a.id = agent_id and nm_is_member(a.workspace_id))
);
create policy members_read on tasks for select using (nm_is_member(workspace_id));
create policy members_read on events for select using (nm_is_member(workspace_id));
create policy members_read on messages for select using (nm_is_member(workspace_id));
create policy members_read on artifacts for select using (nm_is_member(workspace_id));
