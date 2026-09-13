-- Lessons (docs/03 §6, 2026-07-01): review corrections become durable channel memory.
-- A lesson IS a fact — same table, same bitemporal reconcile, same recall — distinguished
-- by kind='lesson' + task provenance, and writable by ANY teammate via the dedicated
-- memory.record_lesson command (plain facts stay orchestrator/human-only). Reconcile is
-- kind-scoped so a lesson never supersedes a decision-fact or vice versa. `facts` is
-- server-side only (not in the powersync publication) — no sync-rule work rides this.
alter table facts add column kind text not null default 'fact' check (kind in ('fact', 'lesson'));
alter table facts add column task_id uuid references tasks (id) on delete set null;
