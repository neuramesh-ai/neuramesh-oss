-- Publish `decisions` for PowerSync replication (docs/12 slice 2). Prod applies this via
-- migrate.mjs; the dev stack + CI skip *publish* migrations and build the publication
-- wholesale from dev/stack/init/99-publication.sql instead (which also lists decisions).
-- Mirrors 0059_publish_beats.
alter publication powersync add table public.decisions;
