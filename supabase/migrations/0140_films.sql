-- The video rung (docs/design/video-rung-2026-09, issue #539): a video post's hook filmed on the
-- platform's fal.ai key, metered on cloud credits. One row per film, the server's job record: the
-- door writes it at submit (the credits already debited, the pools it drained recorded so a
-- refund reverses exactly), the minute cron works it to done or failed. Deliberately NOT in the
-- PowerSync publication: the draft the film lands on is the synced object, this is operator data.
create table films (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces (id) on delete cascade,
  item_id          uuid not null references content_items (id) on delete cascade,
  tier             text not null,                                    -- starter · xpress · premium (the person's word)
  model            text not null,                                    -- the registry key, e.g. seedance-2.0-fast
  endpoint         text not null,                                    -- the fal endpoint the submit went to
  request_id       text,                                             -- fal's request id, null until the submit answered
  seconds          int  not null,
  micros           bigint not null check (micros >= 0),              -- what the clip cost, at the day's rate
  grant_micros     bigint not null default 0,                        -- how the charge split across the two pools,
  purchased_micros bigint not null default 0,                        --   so a refund puts each back where it came from
  status           text not null default 'queued'
                   check (status in ('queued', 'running', 'done', 'failed')),
  error            text,
  created_by       uuid,                                             -- the actor who pressed Generate video
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index films_open on films (created_at) where status in ('queued', 'running');
create index films_ws on films (workspace_id, created_at desc);
alter table films enable row level security;
comment on table films is
  'the video rung: one film per row, submitted to fal by the door and worked by the minute cron; credits debited at submit and refunded on failure; never synced';

-- a failed film gives the credits back. The reversal happens on the spent counters (each pool
-- exactly as it was drained), and this row is the audit line beside the charge.
alter table credit_grants drop constraint if exists credit_grants_kind_check;
alter table credit_grants add constraint credit_grants_kind_check
  check (kind in ('signup', 'monthly', 'promo', 'manual', 'purchase', 'refund'));

-- the daily meter learns the third thing a credit buys. A film is not a model call with zero
-- tokens: it gets its own columns, so the dashboard's burn shows brain, machine and video apart.
alter table machine_usage
  add column if not exists video_clips   int    not null default 0,
  add column if not exists video_seconds int    not null default 0,
  add column if not exists video_micros  bigint not null default 0;

-- the workspace's pick among the tiers the server serves (Pro): null = the default tier.
alter table workspaces add column if not exists video_tier text
  check (video_tier is null or video_tier in ('starter', 'xpress', 'premium'));
