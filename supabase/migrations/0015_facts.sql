-- Fact store (docs/03 §6, mem0 + Graphiti patterns): durable facts distilled
-- from chat by the sleep-time worker. Contradicted facts are INVALIDATED
-- (valid_until + superseded_by), never overwritten — history stays queryable.
create table facts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade,
  content text not null,
  embedding vector(384),
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  basis_count int not null default 0,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  superseded_by uuid references facts (id),
  created_at timestamptz not null default now()
);
create index facts_valid on facts (channel_id) where valid_until is null;
create index facts_fts on facts using gin (fts);
create index facts_embedding on facts using hnsw (embedding vector_cosine_ops);
alter table facts enable row level security;
create policy members_read on facts for select using (nm_is_member(workspace_id));
