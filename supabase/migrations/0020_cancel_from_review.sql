-- Humans may close unaccepted work outright (in_review/done -> closed) —
-- the board needs a sanctioned delete that keeps the events audit intact.
-- Mirrors packages/shared/src/states.ts TRANSITIONS (two sources, one law).
create or replace function nm_task_state_guard() returns trigger language plpgsql as $$
begin
  if old.state = new.state then
    return new;
  end if;
  if (old.state, new.state) in (
    ('todo', 'in_progress'), ('todo', 'closed'),
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
