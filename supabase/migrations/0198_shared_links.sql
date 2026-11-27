-- Published files (docs/design/inbox-sales-2026-11/plan.md I14, I15): a link on <host>.neuramesh.page that people
-- outside the workspace can open, for a video, an image or GIF, or an HTML page. A row is one link. The file id is
-- never in the URL: the URL holds a random 128-bit token. The row holds a copy of what the page shows (the host,
-- the title, the company name, the type and the object in the published bucket), so the pages service reads this
-- one table and nothing else. Remove is one update, and the API deletes the copy.
--
-- Server-only, like inbox_items: no client policy, no sync. The pages service has its own role (nm_pages, made by
-- the bootstrap job): it reads the columns that a page needs and changes only the view count, and only of a live
-- link. public.published_links_grant() gives those rights, and runs when the role exists: here, and after each
-- run of the migration job (scripts/migrate.mjs), because the role can come after this file.
--
-- The file name has no "publish": the test database scripts skip a file with that word (the old PowerSync
-- publication files), and this one must run there.
create table published_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  artifact_id uuid references artifacts (id) on delete set null,
  channel_id uuid references channels (id) on delete set null,
  -- the approved version: the sha256 of the bytes that the person published. A later edit never reaches the link
  version text not null check (version ~ '^[0-9a-f]{64}$'),
  audience text not null default 'public' check (audience in ('public')),
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{22}$'),
  kind text not null check (kind in ('video', 'image', 'page')),
  mime text not null check (mime in ('video/mp4', 'video/webm', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/html')),
  host text not null check (host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  title text not null check (length(title) between 1 and 200),
  company text not null check (length(company) between 1 and 200),
  object text not null check (object ~ '^v1/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}\.(mp4|webm|png|jpg|webp|gif|html)$'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 209715200),
  made_by uuid not null,
  made_at timestamptz not null default now(),
  ends_at timestamptz,
  removed_at timestamptz,
  removed_by uuid,
  view_count bigint not null default 0 check (view_count >= 0)
);
create index published_links_workspace on published_links (workspace_id, made_at desc);
-- one live link for each file: Publish again on a new version moves the same link to it
create unique index published_links_live_file on published_links (artifact_id) where removed_at is null and artifact_id is not null;
alter table published_links enable row level security;
revoke all on published_links from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on published_links from authenticated; end if;
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on published_links from anon; end if;
end $$;

-- the rights of the pages role. It runs with the rights of its caller: only the owner of the table can give them.
create or replace function public.published_links_grant(role_name text) returns boolean language plpgsql as $$
begin
  if not exists (select 1 from pg_roles where rolname = role_name) then return false; end if;
  execute format('grant usage on schema public to %I', role_name);
  execute format('revoke all on table public.published_links from %I', role_name);
  -- never the workspace, the file, the room or the person: a page needs none of them
  execute format('grant select (token, host, kind, mime, title, company, object, size_bytes, made_at, ends_at, removed_at, view_count) on table public.published_links to %I', role_name);
  execute format('grant update (view_count) on table public.published_links to %I', role_name);
  execute 'drop policy if exists nm_pages on public.published_links';
  execute format('create policy nm_pages on public.published_links to %I using (removed_at is null) with check (removed_at is null)', role_name);
  return true;
end $$;
revoke all on function public.published_links_grant(text) from public;
select public.published_links_grant('nm_pages');
