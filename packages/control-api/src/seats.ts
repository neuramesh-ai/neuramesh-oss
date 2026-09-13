// The roster hooks for billing (review F4b): a join or a removal on a Pro workspace tells
// Stripe the new member count. SQL-first like member-machines.ts, so the Store contract grows
// no delegate; a store with no postgres (memory) simply does not sync seats. Skipped whenever
// billing is not configured, so Local mode and the dev stack never reach for Stripe.
import type postgres from 'postgres';
import { billingEnabled, setSubscriptionSeats } from './billing';
import { sqlOf } from './credits';
import type { Store } from './store';

export interface SeatSync {
  synced: boolean;
  seats?: number;
}

/** push the live member count onto the workspace's subscription, when there is one to push to */
export async function syncSeats(sql: postgres.Sql, workspaceId: string): Promise<SeatSync> {
  if (!billingEnabled()) return { synced: false };
  const [row] = await sql<{ plan: string; sub: string | null; n: string }[]>`
    select w.plan, w.stripe_subscription_id as sub,
           (select count(*) from workspace_members m where m.workspace_id = w.id) as n
      from workspaces w where w.id = ${workspaceId}::uuid`;
  if (!row || row.plan !== 'cloud' || !row.sub) return { synced: false };
  const seats = Math.max(1, Number(row.n));
  await setSubscriptionSeats(row.sub, seats);
  return { synced: true, seats };
}

/** the hook the handlers call — fire-and-forget like provisionForJoin: a Stripe outage must
 *  never fail a join or a removal, and the webhook's inbound quantity repairs a missed push */
export function syncSeatsForRoster(store: Store, workspaceId: string): void {
  const sql = sqlOf(store);
  if (!sql || !billingEnabled()) return;
  void syncSeats(sql, workspaceId)
    .then((r) => { if (r.synced) console.log(`seats_synced workspace=${workspaceId} seats=${r.seats}`); })
    .catch((e) => console.error(`seats_sync_failed workspace=${workspaceId}: ${e instanceof Error ? e.message : e}`));
}
