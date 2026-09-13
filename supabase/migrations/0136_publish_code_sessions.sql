-- Publish `code_sessions` for PowerSync replication (mobile-cloud round, S0.1). Prod applies this
-- via migrate.mjs; the dev stack + CI skip *publish* migrations and build the publication wholesale
-- from dev/stack/init/99-publication.sql instead (which also lists code_sessions). Mirrors 0112.
alter publication powersync add table public.code_sessions;
