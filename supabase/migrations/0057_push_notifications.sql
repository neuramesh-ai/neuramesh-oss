-- Push notifications for the mobile companion (mobile slice 7). control-api ONLY —
-- deliberately NOT synced to PowerSync (no publication, no sync rule): device_tokens
-- is write-only from the owning client and read only by the server fan-out; syncing
-- it would leak every device's push token into every workspace replica. iOS does not
-- background-sync PowerSync, so when a task hits a human gate (done / design_review /
-- plan_review / blocked) or an agent posts a decision card (nmq / nmauth), the server
-- sends an Expo push carrying render-ready title/body + deep-link ids. push_log dedupes
-- re-fires of the same event within a short window.
-- (Numbered 0057, not 0056: main reserves 0056 for the agent-hire feature; this branch
-- skips it to avoid a duplicate migration number on merge.)
create table device_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references nm_users (id) on delete cascade,
  platform     text not null check (platform in ('ios', 'android')),
  token        text not null,
  device_name  text,
  app_version  text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz,
  unique (user_id, token)
);
-- fan-out reads live (non-revoked) tokens for a set of users
create index device_tokens_user_idx on device_tokens (user_id) where revoked_at is null;

create table push_log (
  user_id    uuid not null references nm_users (id) on delete cascade,
  dedupe_key text not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, dedupe_key)
);
create index push_log_sent_idx on push_log (sent_at);
