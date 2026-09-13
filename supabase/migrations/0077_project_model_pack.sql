-- Per-project brains (docs/10). A project may OVERRIDE the workspace's model pack;
-- null = inherit, which is every existing row. Nullable + additive, so the PowerSync
-- rule (`select * from projects`) picks it up with no rule redeploy.
--
-- Note this is NOT materialized like workspaces.active_model_pack: agents are
-- workspace-scoped with a single `model` column, so two projects wanting different
-- brains for the same agent cannot both be written down. The daemon resolves the
-- seat at RUN time instead (channel -> project -> pack -> role), which is why this
-- column stores a pack id and nothing else changes on the agents table.
alter table projects add column if not exists model_pack text;
