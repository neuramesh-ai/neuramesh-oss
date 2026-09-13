-- 0072: settle stale 'active' beats on terminal tasks (docs/17, the #1018 screenshot).
--
-- Flows that settled their final beat AFTER their own phase transition had the write
-- refused by the phase-ownership gate (BEAT_PHASE_ROLES has no entry for the human's
-- review phases), so terminal tasks kept one forever-pulsing beat — e.g. the shipper's
-- "Propose the release plan" stuck 3/4 on an ACCEPTED task. Going forward the handler
-- settles active beats whenever a task reaches 'accepted' (and the ship flow settles
-- before its transition); this repairs history. 'pending' beats are left untouched —
-- they honestly never ran. Data-only; beats sync as select *, so replicas converge
-- without any PowerSync work.
update beats b
   set status = 'done',
       done_at = coalesce(b.done_at, now()),
       updated_at = now()
 where b.status = 'active'
   and exists (
     select 1 from tasks t
      where t.id = b.task_id
        and t.state in ('accepted', 'closed')
   );
