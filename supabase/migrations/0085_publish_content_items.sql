-- Prod-only publication step (the 0075_publish_threads convention); dev/CI build the
-- publication wholesale via dev/stack/init/99-publication.sql, which lists content_items.
-- Deploy note: needs the PowerSync sync-rules redeploy that adds the content_items stream.
alter publication powersync add table public.content_items;
