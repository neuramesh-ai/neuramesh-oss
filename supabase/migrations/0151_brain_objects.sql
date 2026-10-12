-- Full transcripts stay in immutable object storage. Only verified object references enter
-- the transaction that advances a thread. These private tables never join PowerSync.
create table brain_commits (
  thread_id uuid not null references threads(id) on delete cascade,
  revision bigint not null check (revision > 0),
  commit_id uuid not null,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  device_id text not null,
  actor_kind actor_kind not null,
  actor_id uuid not null,
  request_sha256 text not null check (length(request_sha256) = 64),
  segment jsonb not null,
  snapshot jsonb,
  event_count integer not null check (event_count >= 0),
  created_at timestamptz not null default now(),
  primary key (thread_id, revision),
  unique (thread_id, commit_id)
);
create table brain_event_ids (
  thread_id uuid not null references threads(id) on delete cascade,
  event_id text not null,
  revision bigint not null,
  primary key (thread_id, event_id),
  foreign key (thread_id, revision) references brain_commits(thread_id, revision) on delete cascade
);
create table brain_artifacts (
  artifact_id uuid primary key references artifacts(id) on delete cascade,
  thread_id uuid not null references threads(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  object_ref jsonb not null,
  request_sha256 text not null check (length(request_sha256) = 64),
  created_at timestamptz not null default now()
);
create index brain_artifacts_thread on brain_artifacts(thread_id);
alter table brain_commits enable row level security;
alter table brain_event_ids enable row level security;
alter table brain_artifacts enable row level security;
-- No client policies: only the authenticated API with its service connection can read them.
