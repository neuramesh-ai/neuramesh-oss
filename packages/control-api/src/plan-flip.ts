// THE PLAN FLIP — the Stripe webhook's other named path (source release, 2026-09-12). Before
// it, `setWorkspacePlan` was the whole story and every workspace was born with a runner and a
// signup grant. Now the flip `free → cloud` IS the moment a workspace earns its runner and its
// first credits, so the previous plan is read BEFORE the write and the two side effects fire
// exactly once per subscription:
//
// · the seat grant rides `grantCredits(..., 'promo', <subscription id>)`, which the ledger
//   dedupes by note — a redelivered event grants nothing. It runs BEFORE the plan write: a
//   failed grant answers non-2xx with the plan still `free`, so Stripe's redelivery retries the
//   whole flip instead of leaving a paying customer on Pro with zero credits and no retry.
// · the runner is minted only when no live `kind = 'runner'` row exists, best-effort AFTER the
//   plan write: a workspace on Pro with no machine yet is recoverable, a paid Pro that never
//   flipped is not. Owner = the `role = 'owner'` member. `fleetOn()` keeps dev stacks quiet.
//
// Its own module, not credits.ts: it needs `fleetOn` from member-machines, which imports
// credits.ts for `sqlOf` — and this codebase does not close import cycles.
import { CLOUD_SEAT_MONTHLY_CREDITS } from '@neuramesh/shared';
import type postgres from 'postgres';
import type { PlanPatch } from './billing';
import { grantCredits, sqlOf, type WebhookOutcome } from './credits';
import { mintMachineToken } from './machine-auth';
import { fleetOn } from './member-machines';
import type { Store } from './store';

/**
 * `seats` is the patch's inbound quantity when the event carries one (subscription events), else
 * the row's last-known Stripe quantity (a checkout completion carries none). Stripe does not
 * order events, so a checkout that lands before its subscription event grants at the row's seats
 * and the monthly refill trues the allocation up on the 1st.
 */
export async function applyPlanPatch(store: Store, mapped: { workspace: string; patch: PlanPatch }): Promise<WebhookOutcome> {
  const { workspace, patch } = mapped;
  const flips = patch.plan === 'cloud' && (await store.workspacePlan(workspace)) !== 'cloud';
  if (!flips) { await store.setWorkspacePlan(workspace, patch); return 'ok'; }
  const sql = sqlOf(store);
  if (!sql) {
    console.error(`plan_flip_unavailable workspace=${workspace}: store has no sql pool`);
    return 'unavailable';
  }
  try {
    const [row] = await sql<{ seats: number }[]>`select seats from workspaces where id = ${workspace}::uuid`;
    const seats = Math.max(1, Number(patch.seats ?? row?.seats ?? 1));
    // the note is the idempotency key: the subscription id when Stripe named one, else a
    // workspace-keyed stand-in so a malformed event still cannot double-grant on replay
    const note = patch.stripeSubscriptionId ?? `plan-flip:${workspace}`;
    await grantCredits(sql, workspace, CLOUD_SEAT_MONTHLY_CREDITS * seats, 'promo', note);
  } catch (e) {
    console.error(`plan_flip_grant_failed workspace=${workspace}: ${e instanceof Error ? e.message : e}`);
    return 'failed';
  }
  await store.setWorkspacePlan(workspace, patch);
  await mintWorkspaceRunner(store, sql, workspace, 'plan_flip');
  return 'ok';
}

/** the workspace's runner, once — from the plan flip, and from the first hosted sign-in
 *  (first-workspace.ts: cloud is Pro, and it starts with a machine that bills from its 500
 *  credits, George 2026-09-25). The hash minted here is a placeholder nobody holds: the operator
 *  rotates in the real token when it writes the machine's Secret (the pre-release create-time idiom). */
export async function mintWorkspaceRunner(store: Store, sql: postgres.Sql, workspace: string, why: 'plan_flip' | 'signup'): Promise<void> {
  if (!fleetOn() || !store.createCloudMachine) return;
  try {
    const [live] = await sql<{ id: string }[]>`
      select id from machines where workspace_id = ${workspace}::uuid and kind = 'runner'
         and (lifecycle is null or lifecycle <> 'destroyed') limit 1`;
    if (live) return;
    const [owner] = await sql<{ user_id: string }[]>`
      select user_id from workspace_members where workspace_id = ${workspace}::uuid and role = 'owner' limit 1`;
    if (!owner) { console.error(`${why}_runner_skipped workspace=${workspace}: no owner row`); return; }
    const { id } = await store.createCloudMachine({
      workspaceId: workspace, kind: 'runner', ownerUserId: owner.user_id, name: 'runner', tokenHash: mintMachineToken().hash,
    });
    console.log(`${why}_runner workspace=${workspace} machine=${id}`);
  } catch (e) {
    // a failed mint must never fail the flip — the plan is already Pro, and the runner is recoverable
    console.error(`${why}_runner_failed workspace=${workspace}: ${e instanceof Error ? e.message : e}`);
  }
}
