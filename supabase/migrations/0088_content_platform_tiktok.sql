-- TikTok joins the content platforms (round 13 — the official TikTok Ads MCP wave made it
-- a first-class target). The platform list lives in a CHECK, so widening is a re-add.
alter table content_items drop constraint content_items_platform_check;
alter table content_items add constraint content_items_platform_check
  check (platform in ('x', 'instagram', 'linkedin', 'tiktok', 'email'));
