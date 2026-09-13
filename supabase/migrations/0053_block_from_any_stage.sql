-- Block is legal from every WORKING stage, and unblock returns to the stage the
-- task was blocked from. The architect/designer failure paths and the reviewer's
-- evidence gate all post task.block from planning/designing/in_review — pairs the
-- guard rejected, so those blocks silently 4xx'd and the task stranded while the
-- thread claimed "blocked". tasks.blocked_from is stamped by the server at block
-- time; unblock reads it (legacy null = the historical in_progress return).
-- Mirrors packages/shared/src/states.ts TRANSITIONS — two sources, one law.
alter table tasks add column if not exists blocked_from task_state;

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
    ('in_progress', 'blocked'), ('planning', 'blocked'), ('designing', 'blocked'), ('in_review', 'blocked'),
    ('blocked', 'in_progress'), ('blocked', 'planning'), ('blocked', 'designing'), ('blocked', 'in_review'),
    ('blocked', 'closed'),
    ('in_progress', 'in_review'), ('in_progress', 'closed'), ('in_review', 'in_progress'),
    ('in_review', 'done'), ('in_review', 'closed'), ('done', 'closed'),
    ('done', 'in_progress'), ('done', 'accepted'), ('accepted', 'closed')
  ) then
    return new;
  end if;
  raise exception 'illegal task transition: % -> %', old.state, new.state;
end;
$$;
