-- Prod-only publication step (the 0075_publish_threads convention): dev/CI build the
-- publication wholesale via dev/stack/init/99-publication.sql, which lists schedules too.
-- Deploy note: this needs the PowerSync sync-rules redeploy that adds the schedules stream.
alter publication powersync add table public.schedules;
