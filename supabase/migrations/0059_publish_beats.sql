-- Publish `beats` for PowerSync replication (docs/17). Prod applies this via migrate.mjs;
-- the dev stack + CI skip *publish* migrations and build the publication wholesale from
-- dev/stack/init/99-publication.sql instead (which also lists beats). Mirrors 0011_publish_artifacts.
alter publication powersync add table public.beats;
