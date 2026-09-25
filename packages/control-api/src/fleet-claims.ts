// The claim substrate's server half (docs/design/agent-sandbox-2026-09/plan.md §5.2): the bind
// nm-fleet performs when a claim adopts a spare, the bootstrap a spare performs to become that
// machine, and the promotion a login performs to leave the pool for a volume of its own.
//
// SQL-FIRST, the member-machines idiom: every function takes the postgres handle, the Store
// contract grows no delegates, and a store without postgres refuses the routes out loud.
//
// Custody, in one paragraph. The pool token (FLEET_POOL_TOKEN, shared with nm-fleet) can do one
// thing: redeem a (pod name, pod uid) that nm-fleet already bound. A pod uid is 122 random bits
// that never leave the pod's own env, so a compromised spare cannot redeem a sibling's identity.
// The bind clears the row's token hash, so nothing issued before it can speak for the new pod.
// A redeem rotates the hash again — re-issuable to the SAME pod (a restarted container has lost
// its copy), never to another one. Stop and promotion clear the binding.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import { z } from 'zod';
import { mintMachineToken } from './machine-auth';
import { sqlOf } from './credits';
import type { Store } from './store';

export type MachineSubstrate = 'volume' | 'claim';

/** what a NEW runner is made of: `claim` only where the cluster runs a pool (the k3d harness and,
 *  after the GKE arm proves it, production); members are always `volume`, a login lives there */
export const runnerSubstrateDefault = (): MachineSubstrate => (process.env['FLEET_RUNNER_SUBSTRATE'] === 'claim' ? 'claim' : 'volume');

const LIVE = (sql: postgres.Sql) => sql`(lifecycle is null or lifecycle <> 'destroyed')`;

/** nm-fleet's half: the adopted pod is now this machine. Idempotent per (pod, uid); a different
 *  pod (the controller re-created it) rebinds and kills the previous token by clearing its hash. */
export async function bindMachinePod(sql: postgres.Sql, machineId: string, pod: string, uid: string): Promise<{ id: string } | null> {
  const [row] = await sql<{ id: string }[]>`
    update machines
       set pod_name = ${pod}, pod_uid = ${uid}, bootstrapped_at = null,
           token_hash = case when pod_name is distinct from ${pod} or pod_uid is distinct from ${uid} then null else token_hash end
     where id = ${machineId}::uuid and substrate = 'claim' and kind <> 'local' and ${LIVE(sql)}
     returning id`;
  return row ?? null;
}

export interface BootstrapIdentity {
  machineId: string;
  workspaceId: string;
  kind: string;
  ownerUserId: string;
  token: string;
}

/** the pod's half: (pod, uid) in, the machine's identity and a fresh token out. null = unbound. */
export async function bootstrapMachine(sql: postgres.Sql, pod: string, uid: string): Promise<BootstrapIdentity | null> {
  const { token, hash } = mintMachineToken();
  const [row] = await sql<{ id: string; workspace_id: string; kind: string; owner_user_id: string }[]>`
    update machines
       set token_hash = ${hash}, bootstrapped_at = now()
     where pod_name = ${pod} and pod_uid = ${uid} and substrate = 'claim' and ${LIVE(sql)}
     returning id, workspace_id, kind, owner_user_id`;
  if (!row) return null;
  return { machineId: row.id, workspaceId: row.workspace_id, kind: row.kind, ownerUserId: row.owner_user_id, token };
}

/** a login is about to land, so this machine needs a disk of its own (round §4.2, D2): the row
 *  moves to `volume` awake, the binding is cleared, and the operator swaps the claim for a
 *  StatefulSet on its next tick (the token Secret mint rotates the hash there). */
export async function promoteMachine(sql: postgres.Sql, workspaceId: string, machineId: string): Promise<{ id: string } | null> {
  const [row] = await sql<{ id: string }[]>`
    update machines
       set substrate = 'volume', pod_name = null, pod_uid = null, bootstrapped_at = null, token_hash = null,
           desired_replicas = 1, last_wake_at = now(), started_at = now()
     where id = ${machineId}::uuid and workspace_id = ${workspaceId}::uuid and substrate = 'claim' and ${LIVE(sql)}
     returning id`;
  return row ?? null;
}

const digest = (v: string): Buffer => createHash('sha256').update(v).digest();
/** constant-time equality against the configured pool token; unset = the lane is closed */
export function poolTokenOk(presented: string | undefined): boolean {
  const expected = process.env['FLEET_POOL_TOKEN'];
  if (!expected || !presented) return false;
  return timingSafeEqual(digest(expected), digest(presented));
}

const BindSchema = z.object({ pod: z.string().min(1).max(253), uid: z.string().min(1).max(64) });
const BootstrapSchema = z.object({ poolToken: z.string().min(1), pod: z.string().min(1).max(253), uid: z.string().min(1).max(64) });

/** registered from fleetRoutes, i.e. ABOVE the /v1 gate: the bootstrap's credential is the pool
 *  token, not a bearer, and the bind's is the fleet secret */
export function claimRoutes<E extends Env>(app: Hono<E>, store: Store): void {
  const fleetSecretOk = (auth: string | undefined): boolean => {
    const secret = process.env['FLEET_SECRET'];
    return Boolean(secret) && auth === `Bearer ${secret}`;
  };

  app.post('/internal/machines/:id/bind', async (c) => {
    if (!fleetSecretOk(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'fleet not served by this store' }, 501);
    const id = z.string().uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'invalid machine id' }, 400);
    const body = BindSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body', issues: body.error.issues }, 400);
    const row = await bindMachinePod(sql, id.data, body.data.pod, body.data.uid);
    if (!row) return c.json({ error: 'no live claim machine with that id' }, 404);
    console.log(`machine_bound machine=${id.data} pod=${body.data.pod}`);
    return c.json({ ok: true });
  });

  // 404 until nm-fleet binds the pod — machined polls this every couple of seconds while unbound
  app.post('/v1/machines/bootstrap', async (c) => {
    const body = BootstrapSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    if (!poolTokenOk(body.data.poolToken)) return c.json({ error: 'unauthorized', code: 'POOL_TOKEN' }, 401);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'fleet not served by this store' }, 501);
    const identity = await bootstrapMachine(sql, body.data.pod, body.data.uid);
    if (!identity) return c.json({ error: 'not bound', code: 'UNBOUND' }, 404);
    console.log(`machine_bootstrapped machine=${identity.machineId} pod=${body.data.pod}`);
    return c.json(identity);
  });
}
