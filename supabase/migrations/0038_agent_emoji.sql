-- Agent persona emoji — the face a human picks for an agent (e.g. the orchestrator at
-- onboarding). Nullable: null means "derive a persona from the name" (the client's
-- deterministic fallback). Syncs to clients via the existing `select * from agents` rule.
alter table agents add column emoji text;
