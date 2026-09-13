-- Backfill: retire nmq decision cards that outlived their task. Before this, nothing
-- closed a decision when its task reached a terminal state (accept ships it, cancel/
-- archive close it) — a question resolved by the work simply proceeding (rather than a
-- human clicking Answer/Dismiss) left its row `open` forever, so Mission Control's
-- queue, badge, and ⌘K palette surfaced it indefinitely. Going forward the command
-- handler dismisses these in the same transaction as the terminal transition
-- (handler.ts → MutationResult.dismissOpenDecisions); this one-time sweep clears the
-- cards already orphaned. Idempotent: a re-run matches nothing (rows are no longer open).
update decisions d
   set status = 'dismissed', answered_at = now()
  from tasks t
 where d.task_id = t.id
   and d.status = 'open'
   and t.state in ('accepted', 'closed');
