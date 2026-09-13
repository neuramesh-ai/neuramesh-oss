-- 0105 — the owner opens a phase from in_progress (docs/29 §4d).
--
-- The SQL guard mirrors TRANSITIONS in shared as defence-in-depth, so an edge added there and not
-- here is rejected at the database with "illegal task transition" — after the FSM has already
-- allowed it. That is the worst place to find out.
--
-- Under orchestrator ownership rex CLAIMS a task first and only then decides which phase it needs.
-- While `request_design` existed only from `todo`, taking a task made its own design phase
-- unreachable: the board could describe an owned design round and nothing could get into one.
--
-- Orchestrator/human only — enforced in the FSM, since the trigger knows states and not actors.

create or replace function nm_task_state_guard() returns trigger language plpgsql as $$
begin
  if old.state = new.state then
    return new;
  end if;
  if (old.state, new.state) in (
    ('backlog', 'todo'), ('backlog', 'closed'),
    ('todo', 'in_progress'), ('todo', 'closed'),
    ('todo', 'designing'), ('designing', 'design_review'), ('design_review', 'designing'),
    -- the OWNER opens a phase from in_progress (docs/29 §4d)
    ('in_progress', 'designing'), ('in_progress', 'planning'),
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
