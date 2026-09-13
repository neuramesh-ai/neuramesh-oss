// A ROUTINE WAKES THE MACHINE THAT RUNS IT (George, 2026-09-04).
//
// Routines fire from a daemon's minute tick (host/schedules.ts) — a machine has to be awake to
// notice a due slot. Nothing woke one: the four wakers were a message, the Wake-now button, a
// surface that needs a machine, and an awake daemon asking for a lent sleeper. So a workspace
// whose machines had been idle 48 h missed its slot until the next message, and a weekly routine
// missed it every week. A daily routine kept its runner up by accident (the firing counts as
// work), which is why this stayed invisible.
//
// This is the server's half: a cron pass that looks ten minutes ahead, finds workspaces with a
// slot coming and NO machine up — no cloud machine intended up, no laptop beating — and wakes the
// runner through the same targeted, credit-gated bump the message path uses. Ten minutes covers
// the cold start (146 s measured) with room; the daemon's own draft-ahead (30 min) then sees the
// slot on its first tick after boot. Never every machine: the runner alone, exactly as an
// unattributed message would. A slot already missed (next_run_at in the past) also qualifies —
// the row stays due until a daemon fires it late, so waking for it is right.
//
// The bump is INJECTED (fleet-lifecycle.ts hands its bumpMachineWake in) so this module and the
// lifecycle module do not import each other.
import type { Actor } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import { sqlOf } from './credits';
import type { Store } from './store';

/** how far ahead the pass looks. Must exceed the cron cadence (vercel.json: every 5 min) or a
 *  slot can fall between two passes; must exceed the cold start or the machine arrives late. */
export function routineWakeHorizonMin(): number {
  const n = Number(process.env['NM_ROUTINE_WAKE_HORIZON_MIN'] ?? 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/** workspaces with an active schedule due inside the horizon and nothing up to run it */
export async function dueRoutineWorkspaces(sql: postgres.Sql, horizonMin: number): Promise<string[]> {
  const rows = await sql<{ workspace_id: string }[]>`
    select distinct s.workspace_id
      from schedules s
     where s.status = 'active'
       and s.next_run_at is not null
       and s.next_run_at <= now() + make_interval(mins => ${horizonMin}::int)
       -- something is already up: a cloud machine the fleet intends up, or a laptop beating
       -- inside the online window (90 s — compute.ts MACHINE_ONLINE_MS)
       and not exists (
         select 1 from machines m
          where m.workspace_id = s.workspace_id
            and (m.lifecycle is null or m.lifecycle <> 'destroyed')
            and ((m.kind <> 'local' and m.desired_replicas = 1)
              or (m.kind = 'local' and m.last_seen_at > now() - interval '90 seconds')))
       -- and there is a runner to wake at all
       and exists (
         select 1 from machines m
          where m.workspace_id = s.workspace_id and m.kind = 'runner'
            and (m.lifecycle is null or m.lifecycle <> 'destroyed'))`;
  return rows.map((r) => r.workspace_id);
}

export interface RoutineWakeResult {
  /** workspaces with a due slot and nothing up */
  considered: string[];
  /** the runner was raised (or already intended up when the bump landed) */
  woken: string[];
  /** the bump found no balance: refused, and the slot will be missed until credits arrive */
  capped: string[];
}

/** the targeted, credit-gated wake — fleet-lifecycle's bumpMachineWake with no origin, which
 *  raises the runner only and refuses silently at zero balance */
export type RunnerBump = (sql: postgres.Sql, workspaceId: string) => Promise<void>;

/** the pass: one bump per workspace; the woken/capped verdict is read back from the row rather
 *  than assumed, because the bump reports nothing. */
export async function wakeForDueRoutines(sql: postgres.Sql, bump: RunnerBump, horizonMin = routineWakeHorizonMin()): Promise<RoutineWakeResult> {
  const considered = await dueRoutineWorkspaces(sql, horizonMin);
  const woken: string[] = [];
  const capped: string[] = [];
  for (const ws of considered) {
    await bump(sql, ws);
    const [r] = await sql<{ up: boolean }[]>`
      select exists(select 1 from machines where workspace_id = ${ws}::uuid and kind = 'runner'
                      and desired_replicas = 1 and (lifecycle is null or lifecycle <> 'destroyed')) as up`;
    (r?.up ? woken : capped).push(ws);
  }
  return { considered, woken, capped };
}

/** the cron lane: vercel GETs this with `authorization: Bearer $CRON_SECRET` every 5 minutes
 *  (vercel.json), the machine-sweep idiom. */
export function routineWakeRoutes<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store, bump: RunnerBump): void {
  app.get('/internal/routines-due', async (c) => {
    const secret = process.env['CRON_SECRET'];
    if (!secret || c.req.header('authorization') !== `Bearer ${secret}`) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'fleet not served by this store' }, 501);
    const out = await wakeForDueRoutines(sql, bump);
    // a wake that hands out compute leaves a trace, the way the sweep does
    console.log(`routines-due: horizon=${routineWakeHorizonMin()}m considered=${out.considered.length} woken=[${out.woken.join(',')}] capped=[${out.capped.join(',')}]`);
    return c.json(out);
  });
}
