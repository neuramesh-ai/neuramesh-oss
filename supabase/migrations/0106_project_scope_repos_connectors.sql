-- Two surfaces that never learned the project axis (George, 2026-08-02, on a fresh project whose
-- #marketing channel showed another project's X account, and whose ＋ menu offered to open files
-- "from flowe-ai"). Both are cases of the same thing: the replica had no way to ask which project
-- a row belongs to, so the client guessed and guessed wrong.

-- ── 1 · project_repos becomes syncable ────────────────────────────────────────────────────────
-- `nm:channel-meta` returned EVERY repo in the replica because the repo→project link lives here
-- and this table is not synced — a terminal opened from one project's channel would run in
-- another project's checkout. PowerSync requires a primary key named `id`, and this table was
-- built with a composite (project_id, repo_id), so it needs one before it can sync at all.
-- The composite stays UNIQUE: it is still the real key, `id` is the surrogate PowerSync needs.
alter table project_repos add column if not exists id uuid not null default gen_random_uuid();

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'project_repos'::regclass and contype = 'p' and conname = 'project_repos_pkey'
       and (select count(*) from unnest(conkey)) > 1
  ) then
    alter table project_repos drop constraint project_repos_pkey;
    alter table project_repos add constraint project_repos_pkey primary key (id);
    alter table project_repos add constraint project_repos_project_repo_key unique (project_id, repo_id);
  end if;
end $$;

-- ── 2 · connectors become per-PROJECT ─────────────────────────────────────────────────────────
-- `unique (workspace_id, provider)` made a connector workspace-unique: one X account per
-- workspace, full stop. Connecting X in a second project did not add an account, it OVERWROTE
-- the first (upsertConnector conflicts on that key). Two products cannot share one X handle, so
-- the scope George chose is the project.
--
-- `channel_id` stays — it records which room the OAuth round-trip was started from — but the
-- project is what identity belongs to, so it is the column the constraint reads.
alter table connectors add column if not exists project_id uuid references projects (id) on delete cascade;

-- backfill: the room it was connected from names the project…
update connectors c set project_id = ch.project_id
  from channels ch where ch.id = c.channel_id and c.project_id is null and ch.project_id is not null;
-- …and a connector with no room (or a room since deleted — channel_id is ON DELETE SET NULL)
-- lands on the workspace's default project rather than becoming unreachable.
update connectors c set project_id = p.id
  from projects p where c.project_id is null and p.workspace_id = c.workspace_id and p.is_default;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'connectors'::regclass and conname = 'connectors_workspace_id_provider_key') then
    alter table connectors drop constraint connectors_workspace_id_provider_key;
  end if;
end $$;

-- Partial, because a NULL project_id would otherwise be treated as distinct on every insert and
-- silently re-open the duplicate door the constraint exists to close.
create unique index if not exists connectors_ws_project_provider_key
  on connectors (workspace_id, project_id, provider) where project_id is not null;
create index if not exists connectors_project_idx on connectors (project_id);
