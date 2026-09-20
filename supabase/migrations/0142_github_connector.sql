-- GitHub as a connector (docs/design/github-connector-2026-09): the project's repository, readable
-- by its agents through the platform's GitHub App.
--
-- 1 · `connectors` may name GitHub. The visible half stays the same row shape as a social account
--     (provider, handle = the repository slug the project reads, the four statuses); the grant behind
--     it is the App's installation, so there is no connector_secrets row and no token anywhere.
alter table connectors drop constraint if exists connectors_provider_check;
alter table connectors add constraint connectors_provider_check
  check (provider in ('x', 'linkedin', 'instagram', 'tiktok', 'github'));

-- 2 · an installation on "all repositories" resolves by ACCOUNT, not by an ever-stale list: GitHub
--     answers the repository list one page at a time, and a new repository in the org would never be
--     in it. `selected` keeps the 0139 behaviour (match on `repos`).
alter table github_installations add column if not exists selection text not null default 'selected'
  check (selection in ('all', 'selected'));
comment on column github_installations.selection is
  'GitHub''s repository_selection: all = every repository of the account reads through this installation';
