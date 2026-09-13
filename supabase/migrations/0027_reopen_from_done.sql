-- Reopen an approved (done) task for changes (docs/decisions 2026-06-17): the
-- human is the final acceptance gate, so a done task isn't a dead end — the human
-- (or the orchestrator on their behalf) can bounce it back to in_progress with a
-- change request if the reviewer missed something. Mirrors the new states.ts edge.
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
    ('in_review', 'closed'), ('done', 'closed'), ('done', 'in_progress'),
    ('done', 'accepted'), ('accepted', 'closed')
  ) then
    return new;
  end if;
  raise exception 'illegal task transition: % -> %', old.state, new.state;
end;
$$;
