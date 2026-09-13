-- Publish `whiteboards` for PowerSync replication (docs/38). Prod applies this via migrate.mjs;
-- the dev stack + CI skip *publish* migrations and build the publication wholesale from
-- dev/stack/init/99-publication.sql instead (which also lists whiteboards). Mirrors 0097_publish_runs.
alter publication powersync add table public.whiteboards;
