-- Definition of Done (docs/decisions 2026-06-17): the authoritative, human-editable
-- acceptance contract for a task. The architect writes a `## Definition of Done`
-- section in the implementation plan and architectFlow extracts it onto this field;
-- for non-plan tasks the orchestrator sets it at offer time. The reviewer gates the
-- submission against it (falling back to `requirements` when empty). Distinct from
-- `requirements` (the intake checklist record): the DoD is the crisp bar that must
-- be met, edited in the task view, never derived from prompt etiquette.
-- Additive text column — rides the existing `select *` tasks sync rule + the
-- whole-table publication, so no PowerSync rule edit is needed.
alter table tasks add column definition_of_done text not null default '';
