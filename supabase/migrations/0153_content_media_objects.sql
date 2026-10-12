-- New draft images and films use the same private durable store as the brain. Existing rows
-- keep their inline bytes until an explicit backfill. Public delivery still checks mediaSig.
alter table content_media add column object_ref jsonb;
alter table content_media alter column bytes drop not null;
alter table content_media add constraint content_media_storage_check check (
  (bytes is not null and object_ref is null) or (bytes is null and object_ref is not null)
);
alter table content_media enable row level security;
