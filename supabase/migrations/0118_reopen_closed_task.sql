-- 0118 — reopen: the one edge out of `closed` (2026-08-11, George).
--
-- A closed task's reply field is disabled — replying into a terminal task asks nobody for
-- anything — so reopening is how a human gets it back. Closed was terminal by construction,
-- which was right about AGENTS and wrong about PEOPLE: a task cancelled by mistake, or one whose
-- reason resurfaced a week later, had no route home except a fresh task that abandons the thread.
--
-- The SQL guard mirrors TRANSITIONS in shared as defence-in-depth (0105's rule): an edge added
-- there and not here is rejected at the database AFTER the FSM allowed it, which is the worst
-- place to find out. `reopen` is HUMAN-ONLY in the FSM — an agent that could reopen its own
-- cancelled work would make "closed" a suggestion — and the trigger enforces only the shape.

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
    ('verifying', 'in_progress'), ('verifying', 'closed'),
    -- 0118: the one edge OUT of closed — human-only in the FSM, since the trigger knows states
    -- and not actors. It lands in `todo`, never mid-phase: the host aborts the run and drops the
    -- worktree on close, so any other landing would be a state with no work behind it.
    ('closed', 'todo')
  ) then
    return new;
  end if;
  raise exception 'illegal task transition: % -> %', old.state, new.state;
end;
$$;
