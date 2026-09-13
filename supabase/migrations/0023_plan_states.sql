-- Implementation-quality gate: a plan phase before execution (docs/03 §2).
-- New board states `planning` and `plan_review` sit between todo and
-- in_progress; a new `architect` agent role drafts the plan. Enum values are
-- added in their own migration (separate from the trigger that references them
-- in 0024) — a new enum value can't be USED in the same transaction it's added.
-- anchor only on pre-existing values (todo, in_progress) so neither ALTER
-- references a value added earlier in the same transaction. Result order:
-- todo, planning, plan_review, in_progress, …
alter type task_state add value if not exists 'planning' after 'todo';
alter type task_state add value if not exists 'plan_review' before 'in_progress';
alter type agent_role add value if not exists 'architect';
