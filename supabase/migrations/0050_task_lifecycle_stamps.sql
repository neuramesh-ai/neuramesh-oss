-- Task lifecycle timestamps (claimed/submitted/accepted/closed_at) were declared
-- in 0001 but no runtime path ever wrote them — found by the Mission Control
-- evidence run (docs/12 §7 1e), whose shipped/throughput counts read them.
-- Stamp them in the schema so every writer gets them right (enforced, not
-- prompted), and backfill history from the append-only events log.
--
--   claimed_at   first entry into in_progress (re-claims after bounce don't move it)
--   submitted_at latest entry into in_review (the accepted submission is the last one)
--   accepted_at  entry into accepted (the human sign-off — powers "shipped" counts)
--   closed_at    entry into closed

create or replace function nm_stamp_task_lifecycle() returns trigger
language plpgsql as $$
begin
  if old.state is distinct from new.state then
    if new.state = 'in_progress' and new.claimed_at is null then new.claimed_at := now(); end if;
    if new.state = 'in_review' then new.submitted_at := now(); end if;
    if new.state = 'accepted' and new.accepted_at is null then new.accepted_at := now(); end if;
    if new.state = 'closed' and new.closed_at is null then new.closed_at := now(); end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_lifecycle_stamps on tasks;
create trigger tasks_lifecycle_stamps before update of state on tasks
for each row execute function nm_stamp_task_lifecycle();

-- Backfill from events (idempotent — only fills nulls, types match the live log).
update tasks t set claimed_at = e.ts
  from (select task_id, min(ts) as ts from events where type = 'task.claimed' group by task_id) e
  where e.task_id = t.id and t.claimed_at is null;
update tasks t set submitted_at = e.ts
  from (select task_id, max(ts) as ts from events where type = 'task.submitted' group by task_id) e
  where e.task_id = t.id and t.submitted_at is null;
update tasks t set accepted_at = e.ts
  from (select task_id, max(ts) as ts from events where type = 'task.accepted' group by task_id) e
  where e.task_id = t.id and t.accepted_at is null;
update tasks t set closed_at = e.ts
  from (select task_id, max(ts) as ts from events where type in ('task.cancelled', 'task.archived') group by task_id) e
  where e.task_id = t.id and t.closed_at is null;
