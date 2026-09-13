-- Dev workspace seed (idempotent). Requires -v uid=<auth user uuid>.
\set ON_ERROR_STOP on

insert into workspaces (id, name, slug, created_by)
values ('a0000000-0000-0000-0000-00000000000a', 'Acme Robotics', 'acme', :'uid')
on conflict (slug) do nothing;

insert into workspace_members (workspace_id, user_id, role)
values ('a0000000-0000-0000-0000-00000000000a', :'uid', 'owner')
on conflict do nothing;

insert into channels (id, workspace_id, slug, topic)
values
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'general', 'Workspace home'),
  ('c0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a', 'dev', 'Engineering')
on conflict (workspace_id, slug) do nothing;

-- Every channel auto-creates a default project (docs/03 §9).
insert into projects (workspace_id, channel_id, name, slug, is_default)
values
  ('a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', 'general', 'general', true),
  ('a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000b', 'dev', 'dev', true)
on conflict (channel_id, slug) do nothing;

select 'seeded: workspace acme, channels #general #dev, default projects' as result;
