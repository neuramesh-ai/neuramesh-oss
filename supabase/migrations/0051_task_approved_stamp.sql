-- approved_at: when the task last entered `done` (review passed, awaiting the
-- human's accept). Founder feedback on Mission Control: accept is HUMAN_ONLY,
-- so nothing is "accepted while you were away" today — the honest overnight
-- story is review passing. Latest entry wins (a bounce + re-approve moves it),
-- mirroring submitted_at. Same enforced-in-schema pattern as 0050.

alter table tasks add column if not exists approved_at timestamptz;

create or replace function nm_stamp_task_lifecycle() returns trigger
language plpgsql as $$
begin
  if old.state is distinct from new.state then
    if new.state = 'in_progress' and new.claimed_at is null then new.claimed_at := now(); end if;
    if new.state = 'in_review' then new.submitted_at := now(); end if;
    if new.state = 'done' then new.approved_at := now(); end if;
    if new.state = 'accepted' and new.accepted_at is null then new.accepted_at := now(); end if;
    if new.state = 'closed' and new.closed_at is null then new.closed_at := now(); end if;
  end if;
  return new;
end;
$$;

-- Backfill from the events log (idempotent — only fills nulls).
update tasks t set approved_at = e.ts
  from (select task_id, max(ts) as ts from events where type = 'task.approved' group by task_id) e
  where e.task_id = t.id and t.approved_at is null;
