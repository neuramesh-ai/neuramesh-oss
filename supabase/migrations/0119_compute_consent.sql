-- Compute consent (round 2, 2026-08-12): a machine is LENT, never taken.
--
-- 0118 let any member point their requests at anyone's machine, and let failover recruit any
-- capable machine — both spending the OWNER's subscription without ever asking them. The grant
-- closes that: `compute.shares` on the LENDER's row lists the members they lend their machines
-- to ('*' = the whole workspace). Every routing rung below continuity may only choose machines
-- granted to the member the work came from (packages/shared/src/compute.ts).
--
-- No new column: `workspace_members.compute` (0118) gains a `shares` key, so the sync rule
-- (select * from workspace_members) already carries it and no PowerSync work is needed.
--
-- ── the backfill, which is the load-bearing half ──────────────────────────────────────────
-- Every workspace that already exists has been sharing IMPLICITLY since 0114 — that is how it
-- has worked all along. Deploying a default-deny consent model without this would silently break
-- every live multi-member workspace the moment it landed: requests that ran fine yesterday would
-- start refusing today, with no user action to explain it. So consent applies to what happens
-- NEXT: everyone who is already a member keeps lending to the workspace, and can revoke from the
-- Members tab whenever they choose.
update workspace_members
   set compute = jsonb_set(coalesce(compute, '{}'::jsonb), '{shares}', '["*"]'::jsonb, true)
 where compute -> 'shares' is null;

comment on column workspace_members.compute is
  'The member''s compute settings: {machine, agents:{agentId→machineId}, shares:[userId|"*"]}. '
  '`machine`/`agents` are THEIR routing (0118, advisory — capability-gated at claim time). '
  '`shares` is the CONSENT they give (0119): the members their machines may serve. Backfilled to '
  '["*"] for pre-0119 members, who were already sharing implicitly. Set via member.set_compute '
  '(HUMAN_ONLY, self-only).';
