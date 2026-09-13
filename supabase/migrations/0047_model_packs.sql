-- Model config packs: per-workspace default-brain policy + per-agent override provenance.
--
-- A pack is a named role->model map (packages/shared/src/model-packs.ts). `active_model_pack` is
-- the workspace's chosen pack — the single server-truth the settings/onboarding pickers read and
-- the apply path writes. 'custom' (the default) means "no pack is managing this workspace": every
-- existing agent's model stands untouched, so this migration is non-breaking. It rides
-- GET /v1/workspaces like `plan`/`auto_failover` (workspaces is not in the PowerSync publication),
-- so no sync-rule edit. No check() constraint — pack ids are a fixed enum validated in
-- @neuramesh/shared + the command handler, keeping "add a pack" a code-only change.
--
-- `model_source` records WHY an agent is on its model: 'pack' = set by the active pack and eligible
-- for re-materialization when the pack changes; 'manual' = a human pinned it via the Brain editor,
-- so a pack-apply MUST skip it. This is what lets "switching packs updates every role at once" and
-- "individual overrides are preserved" both hold (enforced, not prompted — NeuraMesh #4). Default
-- 'pack' so existing agents become pack-managed and a first pack pick normalizes them (the UI shows
-- a before/after preview). agents is already published; the renderer reads model_source via the
-- client Table to badge a pinned agent.
alter table workspaces add column active_model_pack text not null default 'custom';
alter table agents add column model_source text not null default 'pack' check (model_source in ('pack', 'manual'));
