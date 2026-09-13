-- Smoke: seed one workspace end-to-end, prove counter, claim CAS, and the
-- transition guard. Runs as superuser (RLS bypassed by design here).
--
-- ⚠ STALE — this fixture stopped matching the schema a long time ago and is only PARTLY
-- repaired (2026-08-08). Fixed here: the missing `nm_users` row (0032 repointed the user FKs
-- off auth.users, and its backfill can't cover rows inserted later). Still broken below:
-- `channels.project_id` went NOT NULL at 0035, so the channel/project inserts need reordering
-- — and there may be more after it; each layer only surfaces once the one above it passes.
--
-- The MIGRATIONS themselves are verified: scripts/validate-db.sh applies all of them cleanly
-- (its own two bugs — the alpine image with no pgvector, and a pg_isready race against the
-- entrypoint's temporary server — are fixed), and `pnpm test:pg` runs 112 tests against the
-- real schema. This file is the assertion layer on top, and it is the piece still owed.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001');
-- …and the nm_users row every user FK actually points at. 0032 repointed
-- workspaces.created_by (and the rest) from auth.users to nm_users, and its backfill only
-- covers rows that existed WHEN IT RAN — a fixture inserted afterwards has to seed both, or
-- the very first insert here trips workspaces_created_by_fkey. Stale since 0032.
insert into nm_users (id, clerk_user_id) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001')
  on conflict (id) do nothing;

insert into workspaces (id, name, slug, created_by)
values ('10000000-0000-0000-0000-000000000001', 'Acme Robotics', 'acme', '00000000-0000-0000-0000-000000000001');

insert into workspace_members (workspace_id, user_id, role)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner');

insert into channels (id, workspace_id, slug, topic)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'dev', 'Engineering');

insert into projects (id, workspace_id, channel_id, name, slug, is_default)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'marketing-site', 'marketing-site', true);

insert into repos (id, workspace_id, org_name, name, clone_url)
values ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'acme', 'marketing-site', 'git@github.com:acme/marketing-site.git');

insert into project_repos (project_id, repo_id, is_primary)
values ('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', true);

insert into machines (id, workspace_id, owner_user_id, name)
values ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'georges-mbp');

insert into agents (id, workspace_id, machine_id, name, role)
values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'patch', 'worker'),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'gem', 'reviewer');

insert into agent_channels (agent_id, channel_id) values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001');

-- task numbers: 1001 then 1002
do $$
declare n int;
begin
  n := nm_next_task_number('10000000-0000-0000-0000-000000000001');
  if n <> 1001 then raise exception 'expected first task number 1001, got %', n; end if;
  n := nm_next_task_number('10000000-0000-0000-0000-000000000001');
  if n <> 1002 then raise exception 'expected second task number 1002, got %', n; end if;
end $$;

insert into tasks (id, workspace_id, channel_id, project_id, number, title, creator_kind, creator_id, repo_id, base_ref, branch)
values ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 1001, 'fix mobile navigation', 'human', '00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'main', 'nm/1001-fix-mobile-navigation');

-- atomic claim: first CAS wins, second touches zero rows
do $$
declare hits int;
begin
  update tasks set state = 'in_progress', assignee_kind = 'agent', assignee_id = '60000000-0000-0000-0000-000000000001', claimed_at = now()
  where id = '70000000-0000-0000-0000-000000000001' and state = 'todo';
  get diagnostics hits = row_count;
  if hits <> 1 then raise exception 'first claim should win, hit % rows', hits; end if;

  update tasks set state = 'in_progress', assignee_kind = 'agent', assignee_id = '60000000-0000-0000-0000-000000000002'
  where id = '70000000-0000-0000-0000-000000000001' and state = 'todo';
  get diagnostics hits = row_count;
  if hits <> 0 then raise exception 'second claim should lose, hit % rows', hits; end if;
end $$;

-- the guard rejects illegal jumps
do $$
begin
  update tasks set state = 'accepted' where id = '70000000-0000-0000-0000-000000000001';
  raise exception 'guard failed: in_progress -> accepted was allowed';
exception when others then
  if sqlerrm not like 'illegal task transition%' then raise; end if;
end $$;

-- legal path walks: in_review -> done -> accepted -> closed, version bumps
update tasks set state = 'in_review', submitted_sha = '8f3c2d1', submitted_at = now() where number = 1001;
update tasks set state = 'done' where number = 1001;
update tasks set state = 'accepted', accepted_at = now() where number = 1001;
update tasks set state = 'closed', closed_at = now() where number = 1001;

do $$
declare v int;
begin
  select version into v from tasks where number = 1001;
  if v < 5 then raise exception 'version trigger missing, version=%', v; end if;
end $$;

-- events are append-only
insert into events (id, workspace_id, type, source, target, task_id)
values ('01JD8B2C3D4E5F6G7H8J9K0M1N', '10000000-0000-0000-0000-000000000001', 'task.created', 'human:george', 'task:1001', '70000000-0000-0000-0000-000000000001');

do $$
begin
  update events set type = 'task.exploded' where id = '01JD8B2C3D4E5F6G7H8J9K0M1N';
  raise exception 'events should be append-only';
exception when others then
  if sqlerrm not like 'events are append-only%' then raise; end if;
end $$;

insert into messages (workspace_id, channel_id, task_id, author_kind, author_id, body)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'agent', '60000000-0000-0000-0000-000000000001', 'Requirements check before I start');

insert into artifacts (workspace_id, channel_id, project_id, task_id, kind, name, storage_path, created_by_kind, created_by)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'screenshot', 'after.png', 'ws/acme/artifacts/after.png', 'agent', '60000000-0000-0000-0000-000000000001');

-- second default project in the same channel must be rejected
do $$
begin
  insert into projects (workspace_id, channel_id, name, slug, is_default)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'docs', 'docs-platform', true);
  raise exception 'one-default-project-per-channel index missing';
exception when unique_violation then
  null;
end $$;

rollback;

\echo smoke assertions passed
