-- A reader-first rollout retains legacy bytes beside the durable object reference.
-- Require at least one source; cloud-only rows remain valid after the client upgrade gate.
alter table content_media drop constraint content_media_storage_check;
alter table content_media add constraint content_media_storage_check check (
  bytes is not null or object_ref is not null
);
