-- A post's Postiz route (docs/design/postiz-connector-2026-11, P4): the Postiz channel a person picked for the
-- post (the integration id), the post Postiz holds once a person approves it, and the channel's settings (a
-- Reddit title, a YouTube title). `platform` takes `postiz` for a network that NeuraMesh has no connector for.
-- A post with a route goes out through Postiz, never through the minute tick's own posters.
alter table content_items
  add column if not exists postiz_channel text,
  add column if not exists postiz_post_id text,
  add column if not exists postiz_settings jsonb;
alter table content_items drop constraint if exists content_items_platform_check;
alter table content_items add constraint content_items_platform_check
  check (platform in ('x', 'instagram', 'linkedin', 'tiktok', 'email', 'postiz'));
-- the tick reads the posts that Postiz holds
create index if not exists content_items_postiz_in_flight on content_items (scheduled_at) where status = 'scheduled' and postiz_post_id is not null;
