-- Hosted bytes for a draft's image (marketing-workflow §4.7). Every network that accepts media
-- accepts it ONLY as a public https URL that someone else fetches: Instagram has Meta pull the
-- URL directly, TikTok pulls through our domain-verified proxy, and X wants the bytes uploaded —
-- which still means we must be able to hand something the raw image. A generated picture lives on
-- the machine that made it, so without hosting it could never publish at all.
--
-- So: the bytes land here, and `content_items.media.image_id` points at the row. The public,
-- HMAC-gated /media/:id route (mediaSig, keyed on NM_CONNECTOR_KEY) is what Meta and our own
-- TikTok proxy fetch. Deliberately NOT in the PowerSync publication — blobs must never replicate
-- to every client; the card renders the small inline `thumb` on the content item instead.
create table if not exists content_media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  mime text not null,
  bytes bytea not null,
  size_bytes integer not null,
  created_by_kind text not null default 'agent',
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists content_media_item_idx on content_media (content_item_id);
