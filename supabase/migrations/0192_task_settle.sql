-- SETTLE A TASK (the needs-you round, George 2026-11-23). Settle (0137) stamps threads.settled_at,
-- but a task made on the board, a promoted backlog item or an older unit has no thread row and no
-- owning conversation, so its Needs you row (and every card hung on it) had nothing to stamp.
-- tasks.settled_at is the same moment-not-flag stamp: a gate or card older than it leaves Needs you,
-- and a newer one brings the task back. Written only by task.settle / task.unsettle (HUMAN_ONLY).
alter table tasks add column if not exists settled_at timestamptz;
comment on column tasks.settled_at is
  'the human''s Settle on a task with no thread of its own (0192): hides gates and cards older than it';

-- A settle is the person's status, never the task's activity: it must not move updated_at (the
-- queue reads the stamp against it) or version (an agent's command in flight would lose its race).
-- The 0159 project-only exception stays as it was.
create or replace function nm_tasks_touch() returns trigger language plpgsql as $$
begin
  if new.project_id is distinct from old.project_id
    and (to_jsonb(new) - 'project_id') = (to_jsonb(old) - 'project_id') then return new; end if;
  if new.settled_at is distinct from old.settled_at
    and (to_jsonb(new) - 'settled_at') = (to_jsonb(old) - 'settled_at') then return new; end if;
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end $$;
