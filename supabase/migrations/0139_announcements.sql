-- The public door (docs/design/release-drafts-2026-09 §4.8): neuramesh.app/announce. A stranger
-- pastes a repository, leaves a website and an email, and a minute cron drafts the announcement
-- on the Starter brain: the release read, the site read, the brief, the posts, a release card.
-- One row per request, keyed by nothing a workspace owns: the row is PUBLIC data plus an email,
-- so it is deliberately NOT in the PowerSync publication and never reaches a client replica. A
-- sign-in later CLAIMS it into a workspace (claimed_*), and the drafts become that workspace's
-- content items through the ordinary commands.
create table announcements (
  id                   uuid primary key default gen_random_uuid(),
  repo                 text not null,                                 -- owner/name
  tag                  text,                                          -- the release key, once the read names it
  website              text not null,
  email                text not null,
  status               text not null default 'queued'
                       check (status in ('queued', 'reading', 'drafting', 'ready', 'failed')),
  private              boolean not null default false,
  installation_id      bigint,                                        -- the GitHub App install that read a private repository
  digest               jsonb,                                         -- the scan: candidates, pull requests
  brand                jsonb,                                         -- the site read: palette, fonts, voice
  brief                text,                                          -- the release brief, markdown
  posts                jsonb not null default '[]'::jsonb,            -- [{ platform, body, imageBrief? }]
  image                bytea,                                         -- the release card, served at /announce/:id/image
  image_mime           text,
  error                text,
  ip_hash              text,                                          -- sha256 of the requester's address, for the caps
  created_at           timestamptz not null default now(),
  started_at           timestamptz,
  ready_at             timestamptz,
  claimed_by           uuid,                                          -- the nm_users id that signed in and saved it
  claimed_workspace_id uuid references workspaces (id) on delete set null,
  claimed_thread_id    uuid,
  claimed_at           timestamptz
);
create index announcements_queue on announcements (created_at) where status = 'queued';
create index announcements_email_recent on announcements (email, created_at desc);
create index announcements_ip_recent on announcements (ip_hash, created_at desc);
-- one draft set per release per email: a second paste of the same tag serves the first row
create unique index announcements_one_per_release on announcements (repo, tag, email) where tag is not null;
comment on table announcements is
  'the public announce door: one request per row, drafted by a cron on the Starter brain, claimed into a workspace on sign-in; never synced';

-- The GitHub App's installations (plan §4.8, the grant): which repositories a person let the App
-- read. The App's private key mints an installation token per read (one hour, never stored),
-- so this table holds ids and names, never a token.
create table github_installations (
  installation_id      bigint primary key,
  account              text not null default '',
  repos                text[] not null default '{}',                  -- owner/name, lowercased
  workspace_id         uuid references workspaces (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index github_installations_repos on github_installations using gin (repos);
comment on table github_installations is
  'GitHub App installations: the repositories a person granted; tokens are minted per read and never stored';

-- RLS on, no policy = deny-all to PostgREST (0100's stance): every read and write goes through
-- the control-api, which connects as the owner (never FORCE, 0100 lines 24-26).
alter table announcements enable row level security;
alter table github_installations enable row level security;
