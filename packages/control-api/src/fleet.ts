// the fleet's desired-state feed (docs/design/cloud-first-2026-08/architecture.md §3):
// cloud machine rows in, the nm-fleet operator's DesiredState contract out. served by
// GET /internal/fleet-desired behind FLEET_SECRET; the operator polls it every ~10 s.
// the shape mirrors packages/fleet/src/types.ts exactly — that file is the contract.

import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import { z } from 'zod';
import { clerkJwks } from './clerk';
import { localMode } from './localmode';
import { hashMachineToken, machinePublicJwk, mintMachineToken, signMachineSyncJwt } from './machine-auth';
import type { Store } from './store';

export interface FleetMachine {
  id: string;
  kind: 'member' | 'runner';
  ownerUserId?: string;
  replicas: 0 | 1;
  cpu: string;
  memory: string;
  cpuLimit: string;
  memoryLimit: string;
  disk: string;
}

export interface FleetWorkspace {
  id: string;
  plan: string;
  quotaCpu: string;
  quotaMemory: string;
  quotaPvcCount: string;
  machines: FleetMachine[];
}

export interface FleetDesired {
  workspaces: FleetWorkspace[];
}

// per-plan namespace ceilings — the plan-guard knob (billing doc). server-side by design:
// changing a tier must never require a template edit or an operator deploy.
const QUOTAS: Record<string, { cpu: string; memory: string; pvc: string }> = {
  free: { cpu: '4', memory: '8Gi', pvc: '2' },
  cloud: { cpu: '16', memory: '64Gi', pvc: '12' },
};

// pod defaults when a machine row's resources jsonb doesn't say (requests bill; limits burst)
const DEFAULTS = { cpu: '500m', memory: '2Gi', cpuLimit: '4', memoryLimit: '8Gi', disk: '10Gi' };

// per-plan machine defaults, layered over DEFAULTS. only `disk` varies today, because a PVC
// bills for the whole time it EXISTS — including while the pod is scaled to zero (~$5/mo per
// 50Gi on pd-balanced) — so the free tier's starting disk is a real recurring cost lever on a
// signup form open to strangers. unknown/missing plans take the free row: an unrecognised tier
// must never provision the expensive disk. FORWARD-ONLY — this map decides what NEW machines
// are CREATED with; it never resizes an existing PVC, and kubernetes PVCs can grow but not
// shrink, so changing 'free' here affects new machines only.
const PLAN_DEFAULTS: Record<string, Partial<typeof DEFAULTS>> = {
  free: { disk: '10Gi' },
  cloud: { disk: '50Gi' },
};

/**
 * The disk a plan's machines are created with, in GB, for surfaces that want to SAY it.
 *
 * Exported from here rather than re-derived beside the meter, because a second copy of this map
 * would eventually disagree with the one the fleet actually provisions — and a storage figure the
 * UI invented is worse than the "not yet metered" line it replaces. Unknown plans take the free
 * row, exactly as provisioning does.
 *
 * It is the ALLOCATION, not usage. Nothing meters bytes on the PVC yet, so a surface may say
 * "10 GB included" and must not say "3 of 10 GB used".
 */
export function planDiskGb(plan: string): number {
  const disk = (PLAN_DEFAULTS[plan] ?? PLAN_DEFAULTS['free']!).disk ?? DEFAULTS.disk;
  return Number.parseInt(disk, 10) || 10;
}

export interface CloudMachineRow {
  id: string;
  workspace_id: string;
  workspace_plan: string;
  kind: string;
  owner_user_id: string | null;
  desired_replicas: number;
  lifecycle: string | null;
  resources: Record<string, unknown>;
}

/** pure mapper — rows in, the operator's contract out. unit-tested; the query stays thin. */
export function rowsToDesired(rows: CloudMachineRow[]): FleetDesired {
  const byWorkspace = new Map<string, FleetWorkspace>();
  for (const r of rows) {
    if (r.kind !== 'member' && r.kind !== 'runner') continue;
    if (r.lifecycle === 'destroyed') continue;
    let ws = byWorkspace.get(r.workspace_id);
    if (!ws) {
      const quota = QUOTAS[r.workspace_plan] ?? QUOTAS['free']!;
      ws = {
        id: r.workspace_id,
        plan: r.workspace_plan,
        quotaCpu: quota.cpu,
        quotaMemory: quota.memory,
        quotaPvcCount: quota.pvc,
        machines: [],
      };
      byWorkspace.set(r.workspace_id, ws);
    }
    const res = r.resources ?? {};
    // the row's own resources jsonb wins over its plan default, which wins over the base —
    // an explicitly sized machine is never downsized by the tier it happens to sit in
    const planDefaults = PLAN_DEFAULTS[r.workspace_plan] ?? PLAN_DEFAULTS['free']!;
    const str = (key: keyof typeof DEFAULTS): string => {
      const v = res[key];
      if (typeof v === 'string' && v.length > 0) return v;
      return planDefaults[key] ?? DEFAULTS[key];
    };
    ws.machines.push({
      id: r.id,
      kind: r.kind,
      // runners carry their provisioning owner too — it is their sync principal
      // (machined refuses to boot without one; the live roll proved it)
      ...(r.owner_user_id ? { ownerUserId: r.owner_user_id } : {}),
      replicas: r.desired_replicas === 1 ? 1 : 0,
      cpu: str('cpu'),
      memory: str('memory'),
      cpuLimit: str('cpuLimit'),
      memoryLimit: str('memoryLimit'),
      disk: str('disk'),
    });
  }
  // the PVC ceiling follows the rows: every member machine is one more claim, and a fourth free
  // member must be a seat question, never a silent PVC refusal (member-machines plan §3)
  for (const ws of byWorkspace.values()) ws.quotaPvcCount = String(Math.max(Number(ws.quotaPvcCount), ws.machines.length + 1));
  return { workspaces: [...byWorkspace.values()] };
}

// the fleet operator's poll (architecture.md §3): nm-fleet GETs this with `authorization:
// Bearer $FLEET_SECRET` every ~10s and reconciles cloud machines to it. read-only; 501 on
// stores that don't serve fleet (memory) — never an empty fleet, which would read as
// "delete every machine" to a correctly paranoid operator (it delete-guards by label, but
// the contract stays honest anyway).
const CreateMachineSchema = z.object({
  workspaceId: z.string().uuid(),
  kind: z.enum(['member', 'runner']),
  ownerUserId: z.string().uuid(),
  name: z.string().min(1).max(60),
});

export function fleetRoutes<E extends Env>(app: Hono<E>, store: Store): void {
  const fleetSecretOk = (auth: string | undefined): boolean => {
    const secret = process.env['FLEET_SECRET'];
    return Boolean(secret) && auth === `Bearer ${secret}`;
  };

  app.get('/internal/fleet-desired', async (c) => {
    if (!fleetSecretOk(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    if (!store.fleetDesired) return c.json({ error: 'fleet not served by this store' }, 501);
    return c.json(await store.fleetDesired());
  });

  // provision a cloud machine row + mint its token — returned exactly once, only the
  // hash lands in postgres (architecture.md §3.3). fleet-secret callers only (the
  // provisioning flow); the one-runner-per-workspace unique index turns dupes into 409.
  app.post('/internal/machines', async (c) => {
    if (!fleetSecretOk(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    if (!store.createCloudMachine) return c.json({ error: 'fleet not served by this store' }, 501);
    const body = CreateMachineSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body', issues: body.error.issues }, 400);
    const { token, hash } = mintMachineToken();
    try {
      const { id } = await store.createCloudMachine({ ...body.data, tokenHash: hash });
      return c.json({ machineId: id, token }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('machines_one_runner')) return c.json({ error: 'workspace already has a runner' }, 409);
      throw e;
    }
  });

  // the operator's token-custody mint (architecture.md §3.3): called when a machine's
  // Secret is absent from the cluster — fresh token out, only its hash at rest. rotating
  // the hash kills any prior token by construction, which is exactly right: a missing
  // secret means nobody legitimate still holds one.
  app.post('/internal/machines/:id/token', async (c) => {
    if (!fleetSecretOk(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    if (!store.rotateMachineToken) return c.json({ error: 'fleet not served by this store' }, 501);
    const id = z.string().uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'invalid machine id' }, 400);
    const { token, hash } = mintMachineToken();
    const row = await store.rotateMachineToken(id.data, hash);
    if (!row) return c.json({ error: 'unknown machine' }, 404);
    return c.json({ token }, 201);
  });

  // the daemon's sync-credential exchange: machine token in, short-lived RS256 PowerSync
  // JWT out. sub = the machine's owner (member machines sync as their member; runners as
  // the workspace owner who provisioned them — workspace-scoped by the sync rules).
  app.post('/v1/machines/sync-token', async (c) => {
    const auth = c.req.header('authorization') ?? '';
    if (!auth.startsWith('Bearer nmm_')) return c.json({ error: 'unauthorized' }, 401);
    if (!store.machineByTokenHash) return c.json({ error: 'fleet not served by this store' }, 501);
    const pem = process.env['FLEET_JWT_PRIVATE_KEY'];
    if (!pem) return c.json({ error: 'machine issuer key not configured' }, 503);
    const row = await store.machineByTokenHash(hashMachineToken(auth.slice('Bearer '.length)));
    if (!row) return c.json({ error: 'unauthorized' }, 401);
    // sub must be the CLERK id — the sync rules' my_workspaces joins
    // nm_users.clerk_user_id = auth.user_id(); an internal uuid syncs zero buckets
    const sub = row.owner_clerk_id ?? row.owner_user_id;
    const jwt = signMachineSyncJwt({ sub, machineId: row.id, workspaceId: row.workspace_id }, pem);
    return c.json({ token: jwt, expiresInSeconds: 900, sub });
  });

  // the merged JWKS: PowerSync validates against exactly ONE key source, so this document
  // carries clerk's live keys plus the machine issuer's — resolution is by kid. public by
  // nature (JWKS are). point the PowerSync instance's jwks_uri here (deploy note).
  app.get('/v1/sync-jwks', async (c) => {
    // the local stack has no Clerk and no egress for this: its PowerSync points here for the
    // machine issuer's key alone (dev/stack/powersync/powersync.yaml, PS_NM_JWKS_URI)
    const keys: Record<string, unknown>[] = localMode() ? [] : [...(await clerkJwks())];
    const pem = process.env['FLEET_JWT_PRIVATE_KEY'];
    if (pem) keys.push(machinePublicJwk(pem));
    return c.json({ keys });
  });
}

export interface CloudMachineCreate {
  workspaceId: string;
  kind: 'member' | 'runner';
  ownerUserId: string;
  name: string;
  tokenHash: string;
  /** 1 = born awake (the runner: its first message needs it) · 0 = born asleep (a member machine:
   *  no pod and, because the volume claim is created with the pod, no PVC — $0 until first use) */
  replicas?: 0 | 1;
}

export interface MachineIdentityRow {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  kind: string;
  /** the sync principal PowerSync's rules key on (my_workspaces joins nm_users.clerk_user_id) */
  owner_clerk_id: string | null;
}

export async function createCloudMachine(sql: postgres.Sql, m: CloudMachineCreate): Promise<{ id: string }> {
  const [row] = await sql<{ id: string }[]>`
    insert into machines (workspace_id, owner_user_id, name, platform, kind, lifecycle, desired_replicas, token_hash)
    values (${m.workspaceId}::uuid, ${m.ownerUserId}::uuid, ${m.name}, 'linux', ${m.kind}, 'provisioning', ${m.replicas ?? 1}, ${m.tokenHash})
    returning id`;
  return { id: row!.id };
}

export async function rotateMachineToken(sql: postgres.Sql, machineId: string, tokenHash: string): Promise<{ id: string } | null> {
  const [row] = await sql<{ id: string }[]>`
    update machines set token_hash = ${tokenHash}
     where id = ${machineId}::uuid and kind <> 'local' and (lifecycle is null or lifecycle <> 'destroyed')
     returning id`;
  return row ?? null;
}

export async function machineByTokenHash(sql: postgres.Sql, hash: string): Promise<MachineIdentityRow | null> {
  const [row] = await sql<MachineIdentityRow[]>`
    select m.id, m.workspace_id, m.owner_user_id, m.kind, u.clerk_user_id as owner_clerk_id
      from machines m
      left join nm_users u on u.id = m.owner_user_id
     where m.token_hash = ${hash} and m.kind <> 'local' and (m.lifecycle is null or m.lifecycle <> 'destroyed')
     limit 1`;
  return row ?? null;
}

export async function computeFleetDesired(sql: postgres.Sql): Promise<FleetDesired> {
  const rows = await sql<CloudMachineRow[]>`
    select m.id, m.workspace_id, w.plan as workspace_plan, m.kind, m.owner_user_id,
           m.desired_replicas, m.lifecycle, m.resources
      from machines m
      join workspaces w on w.id = m.workspace_id
     where m.kind <> 'local'
     order by m.workspace_id, m.created_at`;
  return rowsToDesired(rows);
}
