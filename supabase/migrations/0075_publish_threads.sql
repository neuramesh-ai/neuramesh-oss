-- Publish `threads` for logical replication so PowerSync mirrors the conversation rows
-- to clients (history panel, the conversation sheet's title, the task-upgrade swap).
-- Dev/CI builds the publication wholesale (dev/stack/init/99-publication.sql); this is
-- the prod step — kept in its own *publish* migration so the CI bootstrap skips it,
-- exactly like 0059/0062/0069. Deploy note: the sync-rules workflow redeploys on merge.
alter publication powersync add table public.threads;
