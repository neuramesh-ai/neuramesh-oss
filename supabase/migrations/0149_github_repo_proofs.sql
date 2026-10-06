-- The GitHub owner proof (docs/design/github-owner-proof-2026-10/plan.md, 2026-10-04). GitHub does
-- not sign the installation_id that its Setup URL carries, so a recorded installation proves no
-- person: a member of one workspace could record another account's installation for their own. A
-- proof row says which repositories one person's own GitHub account could read through the App, as
-- GitHub's user-token lists answered when that person sent the grant's code back to the API with
-- their own session. A room connects a repository only when the person who asks holds a row younger
-- than 24 hours whose repo_ids hold the id the installation reads.
--
-- One row per (workspace, person, installation), and a new proof replaces the person's rows. Ids
-- and names only, never a token: the API deletes the user token on GitHub after the reads. The row
-- belongs to the membership (the composite foreign key), so the rows of a person who leaves the
-- workspace, or deletes the account, go with the membership. Server-only: no sync rule, no
-- publication, and no client reads it.
create table github_repo_proofs (
  workspace_id    uuid not null,
  actor_id        uuid not null,                                 -- the nm_users id that proved
  installation_id bigint not null,                               -- the App's installation that GitHub listed for the person
  github_user_id  bigint not null,                               -- GET /user's id: the account that read
  github_login    text not null default '',                      -- for display only
  repo_ids        bigint[] not null default '{}',                -- GitHub's repository ids
  repos           text[] not null default '{}',                  -- owner/name, lowercased
  proven_at       timestamptz not null default now(),
  primary key (workspace_id, actor_id, installation_id),
  foreign key (workspace_id, actor_id) references workspace_members (workspace_id, user_id) on delete cascade
);
comment on table github_repo_proofs is
  'the GitHub owner proof: the repositories a person''s own GitHub account read through the App, per installation; counts for 24 hours; never synced, never a token';

-- RLS on, no policy = deny-all to PostgREST (0100's stance): every read and write goes through
-- the control-api, which connects as the owner (never FORCE, 0100 lines 24-26).
alter table github_repo_proofs enable row level security;
