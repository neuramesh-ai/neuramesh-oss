// THE ALWAYS ON ADD-ON (decision D2, 2026-11-05). Every cloud machine stops after one idle window
// (NM_IDLE_STOP_MIN, 15 min on Cloud Run). A person can switch one machine to Always on, and then the
// idle sweeps leave it awake. The data model had the escape hatch from the start: `idle_stop_min IS
// NULL` means never auto-stop (fleet-lifecycle.ts idleStopMin, the two idle sweeps). This module is
// the one thing that sets it.
//
//   POST /v1/machines/always-on   { workspace, machineId, on }   human only
//
// WHO MAY. A member machine holds its owner's logins and bills its owner's choice, so only its owner
// switches it. The runner is the workspace's, so a workspace owner or admin switches it. Everybody
// else gets 403, and a local machine gets 409: it runs on the person's own computer and has no idle
// stop to switch off.
//
// BILLED AS ACTIVE (George, 2026-11-06). While Always on is on and the machine is up, every awake second
// costs the active price, also when it does no work (machine-beat.ts). On also starts the billing
// window here (billed_through = now()), so the first beat after it charges only from the switch.
//
// WHAT IT DOES NOT DO. It does not wake the machine. It does not touch the credit cap: the cap sweep
// still parks an Always on machine at a zero balance (machineSweep, cloudRunSweep capDrains). It
// does not touch the crash-loop breaker: a machine with boot_loop_at set stays asleep until a person
// wakes it. A Cloud Run machine that is already in an idle drain finishes that drain. Always on
// applies from its next wake.
//
// OFF writes the column DEFAULT back (0126: 30). The sweeps read only "null or not null" and use the
// one effective window, so off means "stops after NM_IDLE_STOP_MIN idle", which machineIntent reports.
// Both directions are idempotent: a switch to the state the machine already has changes nothing and
// records nothing.
import { createEvent, type Actor } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import { sqlOf } from './credits';
import { idleStopMin } from './fleet-lifecycle';
import type { Store } from './store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** the facts the role rule reads */
export interface AlwaysOnSubject {
  kind: string;
  ownerUserId: string | null;
}

/** May this person switch Always on for this machine? `role` is their workspace role, null when
 *  they are not a member. The owner of a member machine for their own machine, a workspace owner or
 *  admin for the runner. Nobody for a local machine. */
export function mayChangeAlwaysOn(m: AlwaysOnSubject, actorId: string, role: string | null): boolean {
  if (role === null) return false;
  if (m.kind === 'member') return m.ownerUserId === actorId;
  if (m.kind === 'runner') return role === 'owner' || role === 'admin';
  return false;
}

export interface AlwaysOnResult {
  /** false when the machine was already in the asked state */
  changed: boolean;
  /** the stored column after the write: null = Always on */
  storedIdleStopMin: number | null;
}

/** Switch one machine. On stores NULL, off stores the column default. One statement each way, so a
 *  repeat is a no-op, and the event lands in the same transaction as the change. */
export async function setAlwaysOn(sql: postgres.Sql, machineId: string, on: boolean, actor: Actor): Promise<AlwaysOnResult> {
  return sql.begin(async (tx) => {
    const rows = on
      ? await tx<{ id: string; workspace_id: string; kind: string; idle_stop_min: number | null }[]>`
          update machines set idle_stop_min = null, billed_through = now()
           where id = ${machineId}::uuid and kind <> 'local' and idle_stop_min is not null
           returning id, workspace_id, kind, idle_stop_min`
      : await tx<{ id: string; workspace_id: string; kind: string; idle_stop_min: number | null }[]>`
          update machines set idle_stop_min = default
           where id = ${machineId}::uuid and kind <> 'local' and idle_stop_min is null
           returning id, workspace_id, kind, idle_stop_min`;
    const row = rows[0];
    if (!row) {
      const [now] = await tx<{ idle_stop_min: number | null }[]>`select idle_stop_min from machines where id = ${machineId}::uuid`;
      return { changed: false, storedIdleStopMin: now?.idle_stop_min ?? null };
    }
    const event = createEvent({
      type: 'machine.always_on_set',
      source: `${actor.kind}:${actor.id}`,
      target: `machine:${row.id}`,
      workspace: row.workspace_id,
      payload: { machineId: row.id, kind: row.kind, on },
    });
    await tx`insert into events (id, workspace_id, type, source, target, payload)
      values (${event.id}, ${event.workspace}::uuid, ${event.type}, ${event.source}, ${event.target}, ${tx.json(event.payload as never)})`;
    return { changed: true, storedIdleStopMin: row.idle_stop_min };
  }) as Promise<AlwaysOnResult>;
}

async function roleOf(sql: postgres.Sql, workspaceId: string, userId: string): Promise<string | null> {
  const [row] = await sql<{ role: string }[]>`
    select role from workspace_members where workspace_id = ${workspaceId}::uuid and user_id = ${userId}::uuid limit 1`;
  return row?.role ?? null;
}

async function subjectOf(sql: postgres.Sql, machineId: string): Promise<(AlwaysOnSubject & { workspaceId: string }) | null> {
  const [row] = await sql<{ workspace_id: string; kind: string; owner_user_id: string | null }[]>`
    select workspace_id, kind, owner_user_id from machines
     where id = ${machineId}::uuid and (lifecycle is null or lifecycle <> 'destroyed') limit 1`;
  return row ? { workspaceId: row.workspace_id, kind: row.kind, ownerUserId: row.owner_user_id } : null;
}

export function alwaysOnRoutes<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store): void {
  app.post('/v1/machines/always-on', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { workspace?: unknown; machineId?: unknown; on?: unknown };
    const { workspace, machineId, on } = body;
    if (typeof workspace !== 'string' || !UUID_RE.test(workspace)) return c.json({ error: 'workspace required', code: 'INVALID_INPUT' }, 400);
    if (typeof machineId !== 'string' || !UUID_RE.test(machineId)) return c.json({ error: 'machineId required', code: 'INVALID_INPUT' }, 400);
    if (typeof on !== 'boolean') return c.json({ error: 'on must be true or false', code: 'INVALID_INPUT' }, 400);
    const actor = c.get('actor');
    if (actor.kind !== 'human') return c.json({ error: 'only a person can switch Always on', code: 'NOT_PERMITTED' }, 403);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'fleet not served by this store' }, 501);
    const role = await roleOf(sql, workspace, actor.id);
    if (role === null) return c.json({ error: 'not a member of this workspace', code: 'NOT_PERMITTED' }, 403);
    const m = await subjectOf(sql, machineId);
    if (!m || m.workspaceId !== workspace) return c.json({ error: 'no such machine here', code: 'NOT_FOUND' }, 404);
    if (m.kind === 'local') {
      return c.json({ error: 'a local machine runs on your own computer and has no idle stop', code: 'LOCAL_MACHINE' }, 409);
    }
    if (!mayChangeAlwaysOn(m, actor.id, role)) {
      const why = m.kind === 'runner' ? 'only a workspace owner or admin can change the runner' : 'only the owner of this machine can change it';
      return c.json({ error: why, code: 'NOT_PERMITTED' }, 403);
    }
    const out = await setAlwaysOn(sql, machineId, on, actor);
    if (out.changed) console.log(`machine_always_on machine=${machineId} on=${on} by=${actor.id}`);
    // the same EFFECTIVE window machineIntent reports, so the caller can paint without a second read
    return c.json({ ok: true, machineId, alwaysOn: on, changed: out.changed, idleStopMin: on ? null : idleStopMin() });
  });
}
