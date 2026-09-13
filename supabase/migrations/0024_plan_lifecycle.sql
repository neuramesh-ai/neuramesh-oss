-- Plan lifecycle FSM (mirrors packages/shared/src/states.ts TRANSITIONS — two
-- sources, one law). Adds the planning/plan_review edges. There is no
-- planning -> in_progress edge: a developer cannot start while the plan is
-- unsettled. Defense-in-depth; role/evidence guards live in the control-api.
create or replace function nm_task_state_guard() returns trigger language plpgsql as $$
begin
  if old.state = new.state then
    return new;
  end if;
  if (old.state, new.state) in (
    ('todo', 'in_progress'), ('todo', 'closed'),
    ('todo', 'planning'), ('planning', 'plan_review'), ('plan_review', 'planning'),
    ('plan_review', 'in_progress'), ('planning', 'closed'), ('plan_review', 'closed'),
    ('in_progress', 'blocked'), ('blocked', 'in_progress'), ('blocked', 'closed'),
    ('in_progress', 'in_review'), ('in_review', 'in_progress'), ('in_review', 'done'),
    ('in_review', 'closed'), ('done', 'closed'),
    ('done', 'accepted'), ('accepted', 'closed')
  ) then
    return new;
  end if;
  raise exception 'illegal task transition: % -> %', old.state, new.state;
end;
$$;
