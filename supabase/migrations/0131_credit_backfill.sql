-- BACKFILL THE CREDIT POOL FOR EVERY WORKSPACE THAT PREDATES IT.
--
-- 0130 added the pools and deliberately backfilled nothing: "existing rows default the new pool
-- columns to 0". That reasoning covered the COLUMNS and missed the ROWS — a workspace created
-- before the credits round has no `workspace_credits` row at all, and three things then compose
-- into an outage nobody would predict from any one of them:
--
--   1. the signup grant fires only inside workspace.create, so it never reached them;
--   2. workspacesDueRefill selects FROM workspace_credits, so a workspace with no row is not in
--      the monthly worklist and never will be — the balance is not low, it is unreachable;
--   3. bumpMachineWake sets desired_replicas = 1 only when the balance is > 0.
--
-- So every pre-existing workspace's cloud machine became permanently unwakeable the moment the
-- credits round deployed. The symptom is silent and points nowhere near billing: a message says
-- "waking the cloud machine…", the fleet operator reconciles cleanly, and the StatefulSet sits
-- at 0/0 forever because the row it reconciles from says zero. Found in production within the
-- hour by a workspace whose machine would not start (George, 2026-09-01).
--
-- ONE ROW PER WORKSPACE, sized by plan, with the audit row the ledger's own invariant expects
-- (a balance is always explainable by its grants). Idempotent by the left join: run it twice and
-- the second pass inserts nothing. `period_start` is set to this month so the workspace is on
-- the normal refill cadence from here — not backdated, which would make it instantly "due" and
-- hand out a second grant on the next sweep.
insert into workspace_credits (workspace_id, granted_micros, spent_micros, period_start)
select w.id,
       case when w.plan = 'cloud' then 1500 * greatest(coalesce(w.seats, 1), 1) else 500 end * 10000,
       0,
       date_trunc('month', (now() at time zone 'utc')::date)
  from workspaces w
  left join workspace_credits c on c.workspace_id = w.id
 where c.workspace_id is null;

-- the matching audit trail. 'monthly' is the honest kind: this IS the workspace's first monthly
-- allowance, arriving late, and it puts them on the same footing as one created today.
insert into credit_grants (workspace_id, micros, kind, rate_version, note)
select wc.workspace_id, wc.granted_micros, 'monthly', '2026-08-31.1',
       'backfill: first monthly grant for a workspace created before credits'
  from workspace_credits wc
  left join credit_grants g on g.workspace_id = wc.workspace_id
 where g.workspace_id is null
   and wc.granted_micros > 0;
