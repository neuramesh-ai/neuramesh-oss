-- The shipper's drafting stage (`shipping`) was a dead end: its only exits were
-- ship_review (shipper-only), closed, and blocked. A human who asked for a second
-- round of release-plan changes — or who simply wanted to accept past a quiet
-- shipper — had no legal move, and the task parked indefinitely.
--
-- Two new pairs mirror packages/shared/src/states.ts:
--   shipping -> accepted    the human escape hatch (already true of every OTHER
--                           ship state, and already claimed by the FSM's comment)
--   shipping -> in_progress request_changes, when the fix belongs to the developer
--
-- The revise_ship_plan SELF-LOOP (shipping -> shipping) needs no pair here: the
-- guard returns early when the state is unchanged.
create or replace function nm_task_state_guard() returns trigger language plpgsql as $$
begin
  if old.state = new.state then
    return new;
  end if;
  if (old.state, new.state) in (
    ('backlog', 'todo'), ('backlog', 'closed'),
    ('todo', 'in_progress'), ('todo', 'closed'),
    ('todo', 'designing'), ('designing', 'design_review'), ('design_review', 'designing'),
    ('design_review', 'planning'), ('designing', 'closed'), ('design_review', 'closed'),
    ('todo', 'planning'), ('planning', 'plan_review'), ('plan_review', 'planning'),
    ('plan_review', 'in_progress'), ('planning', 'closed'), ('plan_review', 'closed'),
    ('in_progress', 'blocked'), ('planning', 'blocked'), ('designing', 'blocked'), ('in_review', 'blocked'),
    ('shipping', 'blocked'),
    ('blocked', 'in_progress'), ('blocked', 'planning'), ('blocked', 'designing'), ('blocked', 'in_review'),
    ('blocked', 'shipping'),
    ('blocked', 'closed'),
    ('in_progress', 'in_review'), ('in_progress', 'closed'), ('in_review', 'in_progress'),
    ('in_review', 'done'), ('in_review', 'closed'), ('done', 'closed'),
    ('done', 'in_progress'), ('done', 'accepted'), ('accepted', 'closed'),
    ('done', 'shipping'), ('shipping', 'ship_review'), ('ship_review', 'shipping'),
    ('ship_review', 'releasing'), ('releasing', 'accepted'), ('ship_review', 'accepted'),
    ('ship_review', 'in_progress'), ('releasing', 'in_progress'),
    ('shipping', 'accepted'), ('shipping', 'in_progress'),
    ('shipping', 'closed'), ('ship_review', 'closed'), ('releasing', 'closed'),
    ('in_progress', 'done'), ('todo', 'done'),
    ('releasing', 'verifying'), ('verifying', 'accepted'),
    ('verifying', 'in_progress'), ('verifying', 'closed')
  ) then
    return new;
  end if;
  raise exception 'illegal task transition: % -> %', old.state, new.state;
end;
$$;
