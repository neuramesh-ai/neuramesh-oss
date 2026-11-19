// THE MACHINE BEARER CHECK of the routes that prove an nmm_ token themselves, above the /v1 gate
// (machine-facts.ts, machine-park-routes.ts, boards-credentials.ts and the Cloud Run lane). Public:
// Message boards reads it. It moved here from fleet-cloudrun-boot.ts, which re-exports it, so that the
// Cloud Run lane can stay private (docs/design/oss-private-seam-2026-11/plan.md).
import type { MachineIdentityRow } from './fleet';
import { hashMachineToken } from './machine-auth';
import type { Store } from './store';
import { sqlOf } from './credits';

interface TokenRow extends MachineIdentityRow { substrate: string; epoch: string; token_epoch: string | null; current: boolean; expired: boolean }

/** the machine behind an nmm_ bearer, with the epoch verdict a Cloud Run machine needs: a token from
 *  an older epoch is 409 STALE_EPOCH (machined fences on it), an expired one 401. The general lanes
 *  (fleet.ts machineByTokenHash) refuse both as 401; only this lane tells the two apart. `allowStale`
 *  is for the control read alone: it writes nothing, and its answer (a newer epoch) is itself the fence */
export async function machineFromBearer(store: Store, authorization: string | undefined, opts: { allowStale?: boolean } = {}): Promise<MachineIdentityRow | { error: string; code: string; status: 401 | 403 | 409 | 501 }> {
  const bearer = /^Bearer\s+(nmm_\S+)$/i.exec(authorization ?? '')?.[1];
  if (!bearer) return { error: 'this route is for a machine, never a person', code: 'MACHINE_ONLY', status: 403 };
  const hash = hashMachineToken(bearer);
  const sql = sqlOf(store);
  if (!sql) {
    // a store without postgres (unit tests): the store's own identity lookup, no epoch to check
    if (!store.machineByTokenHash) return { error: 'fleet not served by this store', code: 'NOT_CONFIGURED', status: 501 };
    return (await store.machineByTokenHash(hash)) ?? { error: 'unknown machine token', code: 'AUTH_FAILED', status: 401 };
  }
  const [row] = await sql<TokenRow[]>`
    select m.id, m.workspace_id, m.owner_user_id, m.kind, u.clerk_user_id as owner_clerk_id, m.substrate, m.epoch, m.token_epoch,
           (m.token_hash = ${hash}) as current,
           (m.token_expires_at is not null and m.token_expires_at <= now()) as expired
      from machines m left join nm_users u on u.id = m.owner_user_id
     where (m.token_hash = ${hash} or (m.prev_token_hash = ${hash} and m.substrate = 'cloudrun'))
       and m.kind <> 'local' and (m.lifecycle is null or m.lifecycle <> 'destroyed')
     limit 1`;
  if (!row) return { error: 'unknown machine token', code: 'AUTH_FAILED', status: 401 };
  if (row.substrate === 'cloudrun') {
    // a replaced token, or one from an older epoch: the newest boot owns the machine
    const stale = !row.current || Number(row.token_epoch ?? -1) < Number(row.epoch);
    if (row.current && row.expired) return { error: 'the machine token expired; boot again', code: 'AUTH_FAILED', status: 401 };
    if (stale && !opts.allowStale) return { error: 'a newer instance owns this machine', code: 'STALE_EPOCH', status: 409 };
  }
  return { id: row.id, workspace_id: row.workspace_id, owner_user_id: row.owner_user_id, kind: row.kind, owner_clerk_id: row.owner_clerk_id };
}
