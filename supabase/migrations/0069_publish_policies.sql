-- Publish `policies` for logical replication so PowerSync mirrors it to clients — the
-- desktop daemon reads it from the local replica to gate agent tool calls offline-fast.
-- Dev/CI builds the publication wholesale (dev/stack/init/99-publication.sql); this is
-- the prod step. Deploy note: a NEW synced table needs a PowerSync sync-rule redeploy.
alter publication powersync add table public.policies;
