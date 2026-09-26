// Per-member cloud machines (docs/design/member-machines-2026-09/plan.md): the member kind's
// lifecycle — provisioned at join, tombstoned at leave, woken ONE at a time — and the reach
// check the wake route, the relay and the commands share.
//
// SQL-FIRST, the credit-ledger idiom: every function takes the postgres handle from
// `sqlOf(store)`, so the Store contract grows no delegates and pgstore stays at its ratchet
// cap. A store with no postgres (memory) simply does not serve cloud machines, and the callers
// say so rather than half-doing it.
import type postgres from 'postgres';
import { creditBalance } from './credit-ledger';
import { sqlOf } from './credits';
import { createCloudMachine } from './fleet';
import { mintMachineToken } from './machine-auth';
import type { Store } from './store';

/** the same switch the runner mint honours — 'off' is for stacks with no fleet (tests, dev) */
export const fleetOn = (): boolean => process.env['FLEET_AUTOPROVISION'] !== 'off';

const LIVE = (sql: postgres.Sql) => sql`(lifecycle is null or lifecycle <> 'destroyed')`;

/** the member's live machine in this workspace, or null */
export async function memberMachineOf(sql: postgres.Sql, workspaceId: string, userId: string): Promise<{ id: string } | null> {
  const [row] = await sql<{ id: string }[]>`
    select id from machines
     where workspace_id = ${workspaceId}::uuid and owner_user_id = ${userId}::uuid and kind = 'member'
       and ${LIVE(sql)} limit 1`;
  return row ?? null;
}

export interface ProvisionResult {
  id: string | null;
  created: boolean;
  /** why nothing was minted: the workspace cannot pay for compute (decision 3, George 2026-09-03) */
  refused?: 'no_credits';
}

/**
 * Mint the member's machine — BORN ASLEEP. `desired_replicas = 0` means no pod and, because the
 * StatefulSet's volume claim is created with the pod, no PVC either: a provisioned-but-unused
 * machine costs nothing. Idempotent: an existing live machine is returned, never duplicated
 * (the 0133 partial unique index makes the race a re-read rather than a second row).
 *
 * The credits gate is about promises, not disk: a workspace that cannot fund a wake should not
 * be handed a machine that will refuse to start. The moment credits arrive, the next join or an
 * explicit `machine.provision` succeeds.
 */
export async function provisionMemberMachine(sql: postgres.Sql, workspaceId: string, userId: string): Promise<ProvisionResult> {
  const existing = await memberMachineOf(sql, workspaceId, userId);
  if (existing) return { id: existing.id, created: false };
  if ((await creditBalance(sql, workspaceId)).remainingMicros <= 0) return { id: null, created: false, refused: 'no_credits' };
  try {
    // the hash is a placeholder nobody holds — the operator rotates in the real token when it
    // writes the machine's Secret (the runner's own idiom, handler/workspace.ts)
    const { id } = await createCloudMachine(sql, {
      workspaceId, kind: 'member', ownerUserId: userId, name: `member-${userId.slice(0, 8)}`, tokenHash: mintMachineToken().hash, replicas: 0,
    });
    return { id, created: true };
  } catch (e) {
    const raced = await memberMachineOf(sql, workspaceId, userId);
    if (raced) return { id: raced.id, created: false };
    throw e;
  }
}

/**
 * Tombstone the member's machine(s) here. The desired feed drops destroyed rows, so the operator
 * removes the StatefulSet, the token Secret and the PVC — the logins die with the membership,
 * by construction (architecture.md §2). The name is freed too: `(workspace_id, name)` is unique,
 * and a member who re-joins mints `member-<id>` again.
 */
export async function destroyMemberMachine(sql: postgres.Sql, workspaceId: string, userId: string): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    update machines
       set lifecycle = 'destroyed', desired_replicas = 0, started_at = null, token_hash = null,
           name = name || '-gone-' || left(id::text, 8)
     where workspace_id = ${workspaceId}::uuid and owner_user_id = ${userId}::uuid and kind = 'member'
       and ${LIVE(sql)}
     returning id`;
  return rows.map((r) => r.id);
}

export interface MachineReach {
  workspaceId: string;
  kind: string;
  ownerUserId: string | null;
  /** the OWNER's grant (workspace_members.compute.shares, 0119): '*' or the member ids they lend to */
  shares: string[];
}

/** a live cloud machine with its owner's grant joined on — the one read every reach check uses */
export async function machineReach(sql: postgres.Sql, machineId: string): Promise<MachineReach | null> {
  const [row] = await sql<{ workspace_id: string; kind: string; owner_user_id: string | null; shares: unknown }[]>`
    select m.workspace_id, m.kind, m.owner_user_id, coalesce(wm.compute -> 'shares', '[]'::jsonb) as shares
      from machines m
      left join workspace_members wm on wm.workspace_id = m.workspace_id and wm.user_id = m.owner_user_id
     where m.id = ${machineId}::uuid and m.kind <> 'local'
       and (m.lifecycle is null or m.lifecycle <> 'destroyed')
     limit 1`;
  if (!row) return null;
  const shares = Array.isArray(row.shares) ? row.shares.filter((s): s is string => typeof s === 'string') : [];
  return { workspaceId: row.workspace_id, kind: row.kind, ownerUserId: row.owner_user_id, shares };
}

/** May this member USE the machine — wake it, have work routed onto it? The runner is the
 *  workspace's, so any member; a member machine only for its owner or whoever they lend it to.
 *  The grant IS the consent: lending means "run here on my subscription", and waking it is the
 *  same thing said earlier. */
export const mayUse = (m: MachineReach, userId: string): boolean =>
  m.kind === 'runner' || m.ownerUserId === userId || m.shares.includes('*') || m.shares.includes(userId);

/** May this member SHELL into it? Only the owner of a member machine — the vendor logins live
 *  there. The runner stays open to every member: it is where `gh` lives for repo work. */
export const mayAttach = (m: Pick<MachineReach, 'kind' | 'ownerUserId'>, userId: string): boolean =>
  m.kind === 'runner' || m.ownerUserId === userId;

/** wake ONE machine, credits permitting — the by-id half of fleet-lifecycle's workspace wake */
export async function wakeMachine(sql: postgres.Sql, machineId: string): Promise<{ woken: boolean; capped: boolean }> {
  const reach = await machineReach(sql, machineId);
  if (!reach) return { woken: false, capped: false };
  if ((await creditBalance(sql, reach.workspaceId)).remainingMicros <= 0) return { woken: false, capped: true };
  const rows = await sql<{ id: string }[]>`
    update machines
       set desired_replicas = 1, last_wake_at = now(),
           -- only a STOPPED machine is starting; re-waking a running one must not reset its clock
           started_at = case when desired_replicas = 0 then now() else started_at end
     where id = ${machineId}::uuid and kind <> 'local' and ${LIVE(sql)}
     returning id`;
  return { woken: rows.length > 0, capped: false };
}

/**
 * THE TEAM SHAPE (plan §3; George, 2026-09-03: Individual and Team). On Individual the runner IS
 * the owner's machine — their subscriptions are signed in on it, and nobody else can exist to
 * shell into them. The moment a Team workspace issues its first invitation, that runner becomes
 * the owner's member machine (same volume, same logins, same token — only `kind` and the name
 * change) and a fresh runner is minted for keys and the starter brain. Done BEFORE the invite
 * exists, so a second human can never attach to the runner while the owner's logins are on it.
 * Idempotent: a workspace already in team shape is left alone. One transaction: a workspace is
 * never left without a runner.
 */
export async function ensureTeamShape(sql: postgres.Sql, workspaceId: string): Promise<{ promoted: string | null; runner: string | null }> {
  const out = await (sql.begin(async (_tx) => {
    const tx = _tx as unknown as postgres.Sql;
    const [runner] = await tx<{ id: string; owner_user_id: string; substrate: string }[]>`
      select id, owner_user_id, substrate from machines
       where workspace_id = ${workspaceId}::uuid and kind = 'runner' and ${LIVE(tx)}
       for update`;
    if (!runner) return { promoted: null, runner: null, claimOwner: null };
    if (await memberMachineOf(tx, workspaceId, runner.owner_user_id)) return { promoted: null, runner: runner.id, claimOwner: null };
    // A CLAIM runner holds no login and no volume: a login promotes it to a volume first
    // (fleet-claims.ts), and a promoted runner reads `volume` here. So the conversion's reason, the
    // owner's logins moving with their machine, does not apply to it. Converting it anyway left two
    // awake claims serving one workspace, and a daemon that still believed it was the runner (the
    // k3d e2e, 2026-09-25). The claim stays the workspace's runner, and the owner gets a machine of
    // their own below, born asleep, exactly like anyone who joins.
    if (runner.substrate === 'claim') return { promoted: null, runner: runner.id, claimOwner: runner.owner_user_id };
    await tx`update machines set kind = 'member', name = ${`member-${runner.owner_user_id.slice(0, 8)}`} where id = ${runner.id}::uuid`;
    const fresh = await createCloudMachine(tx, {
      workspaceId, kind: 'runner', ownerUserId: runner.owner_user_id, name: 'runner', tokenHash: mintMachineToken().hash, replicas: 1,
    });
    console.log(`team_shape workspace=${workspaceId} promoted=${runner.id} runner=${fresh.id}`);
    return { promoted: runner.id, runner: fresh.id, claimOwner: null };
  }) as Promise<{ promoted: string | null; runner: string | null; claimOwner: string | null }>);
  if (out.claimOwner) {
    const mine = await provisionMemberMachine(sql, workspaceId, out.claimOwner);
    console.log(`team_shape workspace=${workspaceId} runner=${out.runner} stays a claim, owner machine ${mine.created ? `provisioned ${mine.id}` : mine.refused ?? 'exists'}`);
  }
  return { promoted: out.promoted, runner: out.runner };
}

/** the join hook — fire-and-forget, like the runner mint: a failed insert must never fail a join,
 *  and it logs loudly so a silent miss is not mistaken for "provisioning is slow". Team only: on
 *  Individual there is no second member to provision for, and the runner is the owner's. */
export function provisionForJoin(store: Store, workspaceId: string, userId: string): void {
  const sql = sqlOf(store);
  if (!sql || !fleetOn()) return;
  void store.workspacePlan(workspaceId).then((plan) => (plan === 'cloud' ? provisionMemberMachine(sql, workspaceId, userId) : null))
    .then((r) => { if (r) console.log(`member_machine workspace=${workspaceId} user=${userId} ${r.created ? `provisioned ${r.id}` : r.refused ?? 'exists'}`); })
    .catch((e) => console.error(`member_machine_failed workspace=${workspaceId} user=${userId}: ${e instanceof Error ? e.message : e}`));
}


/** the leave/remove hook — the membership is already gone; the machine follows it */
export function destroyForLeave(store: Store, workspaceId: string, userId: string): void {
  const sql = sqlOf(store);
  if (!sql) return;
  void destroyMemberMachine(sql, workspaceId, userId)
    .then((ids) => { if (ids.length) console.log(`member_machine_destroyed workspace=${workspaceId} user=${userId} machines=${ids.join(',')}`); })
    .catch((e) => console.error(`member_machine_destroy_failed workspace=${workspaceId} user=${userId}: ${e instanceof Error ? e.message : e}`));
}
