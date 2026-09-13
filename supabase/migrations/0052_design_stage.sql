-- The design stage (docs/14): a visual-quality gate BEFORE planning. Adds the
-- designing/design_review task states, the 'design' artifact kind (self-contained
-- HTML mockups rendered by the preview tier), and the guard pairs. Mirrors
-- packages/shared/src/states.ts TRANSITIONS — two sources, one law. approve_design
-- is human-only; that actor guard lives in the control-api (evaluateTransition),
-- this trigger is the defense-in-depth pair check.
alter type task_state add value if not exists 'designing';
alter type task_state add value if not exists 'design_review';
alter type artifact_kind add value if not exists 'design';

create or replace function nm_task_state_guard() returns trigger language plpgsql as $$
begin
  if old.state = new.state then
    return new;
  end if;
  if (old.state, new.state) in (
    ('todo', 'in_progress'), ('todo', 'closed'),
    ('todo', 'designing'), ('designing', 'design_review'), ('design_review', 'designing'),
    ('design_review', 'planning'), ('designing', 'closed'), ('design_review', 'closed'),
    ('todo', 'planning'), ('planning', 'plan_review'), ('plan_review', 'planning'),
    ('plan_review', 'in_progress'), ('planning', 'closed'), ('plan_review', 'closed'),
    ('in_progress', 'blocked'), ('blocked', 'in_progress'), ('blocked', 'closed'),
    ('in_progress', 'in_review'), ('in_progress', 'closed'), ('in_review', 'in_progress'),
    ('in_review', 'done'), ('in_review', 'closed'), ('done', 'closed'),
    ('done', 'in_progress'), ('done', 'accepted'), ('accepted', 'closed')
  ) then
    return new;
  end if;
  raise exception 'illegal task transition: % -> %', old.state, new.state;
end;
$$;
