-- Subtasks (docs/24): companion work under a parent task. A subtask is a task
-- row with parent_task_id set — real numbers/refs/history for free — restricted
-- server-side to the lean claim → finish → cancel lifecycle (the parent's gates
-- cover review/ship for the sum) and validated at creation (one level deep,
-- ≤8 live per parent, same channel, no repo of its own). The new trigger pairs
-- ('in_progress','done') and ('todo','done') exist for the subtask `finish`
-- move (assignee, or any HUMAN as the boss check-off — no subtask can become a
-- blocker); the server rejects `finish` for parents and every non-lean move for
-- subtasks — this trigger stays the pair-level defense, same split as 0052/0070.
-- Parents cannot pass submit/accept/approve_ship_plan/execute_ship with open
-- subtasks (SUBTASKS_PENDING, enforced in the control-api).
alter table tasks add column if not exists parent_task_id uuid references tasks(id) on delete cascade;
create index if not exists tasks_parent_idx on tasks (parent_task_id) where parent_task_id is not null;

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
    ('shipping', 'closed'), ('ship_review', 'closed'), ('releasing', 'closed'),
    ('in_progress', 'done'), ('todo', 'done')
  ) then
    return new;
  end if;
  raise exception 'illegal task transition: % -> %', old.state, new.state;
end;
$$;
