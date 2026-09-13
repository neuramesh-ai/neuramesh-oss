-- Stop an actively-running task (docs/decisions 2026-06-17): a human (or the
-- orchestrator on their behalf) can cancel an `in_progress` task outright to halt
-- a wrong/runaway agent, instead of being forced to block-then-cancel. The host
-- aborts the in-flight run when the task lands in `closed`. Adds the single
-- `in_progress -> closed` pair to the defense-in-depth guard (mirrors states.ts).
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
    ('in_progress', 'in_review'), ('in_progress', 'closed'), ('in_review', 'in_progress'),
    ('in_review', 'done'), ('in_review', 'closed'), ('done', 'closed'),
    ('done', 'in_progress'), ('done', 'accepted'), ('accepted', 'closed')
  ) then
    return new;
  end if;
  raise exception 'illegal task transition: % -> %', old.state, new.state;
end;
$$;
