-- 0120 — plan-first units + thread-owned work (2026-08-17, George).
--
-- Every unit of work starts with an implementation plan the HUMAN reviews in the unit's own
-- thread before anything is built: rex triages in the conversation, gathers requirements with
-- its question cards, and the create carries the plan — declared journey legs + proposed
-- subtasks + the approach prose — so the unit is BORN in plan_review. approve_plan (already
-- human-only) releases it to its declared legs. And the conversation OWNS the unit:
-- tasks.origin_thread_id anchors many units to one thread (inverting the legacy 1:1
-- threads.task_id upgrade), with a ‹task:id› unit-card message posted at creation.
--
-- Both columns are additive + nullable and `tasks` syncs `select *` — PowerSync: none
-- (the 0098/0099/ship_plan precedent).

alter table tasks add column if not exists work_plan jsonb;
alter table tasks add column if not exists origin_thread_id uuid references threads(id) on delete set null;
create index if not exists tasks_origin_thread_idx on tasks (origin_thread_id) where origin_thread_id is not null;

-- The SQL guard mirrors TRANSITIONS in shared as defence-in-depth (0105's rule). Two pairs join:
--   plan_review -> designing   a plan-first unit whose approved plan declares a design leg
--                              routes to the designer (PLAN_NOT_APPROVED gates it in the FSM;
--                              the trigger enforces only the shape, as always)
--   design_review -> todo      the approve_design fork: a plan-first unit already HAS its plan,
--                              so an approved design releases it to todo for the build offer
--                              (legacy tasks keep design_review -> planning)
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
    -- 0120: plan-first units — approved plans route to their declared legs
    ('plan_review', 'designing'), ('design_review', 'todo'),
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
