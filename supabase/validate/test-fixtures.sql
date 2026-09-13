-- Fixtures for the PostgresStore integration tests (ephemeral container only).
\set ON_ERROR_STOP on
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'george@acme.dev');
insert into workspaces (id, name, slug, created_by)
values ('a0000000-0000-0000-0000-00000000000a', 'Acme Robotics', 'acme', '00000000-0000-0000-0000-000000000001');
insert into workspace_members (workspace_id, user_id, role)
values ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'owner');
insert into channels (id, workspace_id, slug, topic) values
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'general', ''),
  ('c0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a', 'dev', 'Engineering');
insert into projects (workspace_id, channel_id, name, slug, is_default) values
  ('a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', 'general', 'general', true),
  ('a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000b', 'dev', 'dev', true);
insert into repos (id, workspace_id, org_name, name, clone_url) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'acme', 'marketing-site', 'git@github.com:acme/marketing-site.git'),
  -- e2e: a local bare remote the smoke creates before offering a repo-backed task
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'acme', 'e2e-local', 'file:///tmp/nm-e2e-remote.git');
