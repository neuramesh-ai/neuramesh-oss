-- Publish `runs` for PowerSync replication (docs/29). Prod applies this via migrate.mjs; the
-- dev stack + CI skip *publish* migrations and build the publication wholesale from
-- dev/stack/init/99-publication.sql instead (which also lists runs). Mirrors 0059_publish_beats.
alter publication powersync add table public.runs;
