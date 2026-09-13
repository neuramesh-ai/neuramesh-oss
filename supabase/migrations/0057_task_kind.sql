-- Work-type taxonomy for tasks (docs/16 — sophisticated triage). The orchestrator
-- LABELS each task at triage (bug/feature/refactor/chore/docs/research/spike/design);
-- the label is a routing PRIOR, never a gate — any kind may take any route (design/
-- plan/direct), decided per request by the orchestrator, not by a schema check.
-- Nullable + additive: legacy rows, parked backlog items, and bare todos read null
-- until categorized; the tasks sync rule is `select *` (dev/stack/powersync/sync-config.yaml)
-- so the column replicates to every client with NO PowerSync redeploy and nothing to
-- backfill. Enum values are append-only — mirror @neuramesh/shared TASK_KINDS.
create type task_kind as enum ('bug', 'feature', 'refactor', 'chore', 'docs', 'research', 'spike', 'design');
alter table tasks add column kind task_kind;
