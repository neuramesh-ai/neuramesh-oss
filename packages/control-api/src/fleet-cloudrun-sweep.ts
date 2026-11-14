// The stops a Cloud Run machine meets, drained first (rule M12, packages/fleet/CLOUDRUN.md). Its work
// lives in RAM, so the sweep never scales one straight to 0: an idle or out-of-credit stop asks for a
// drain with a bounded deadline, the drained report parks it (fleet-cloudrun.ts), and a machine that
// misses the deadline scales to 0 anyway with the loss stamped (drain_lost_at). The desired feed
// already reads a missed deadline as replicas 0 (fleet.ts), so the operator stops it within one tick;
// this pass only does the bookkeeping. An image roll drains the same way (requestRoll).
import type postgres from 'postgres';
import { CLOUDRUN_DRAIN_SECONDS } from '@neuramesh/shared';
import { idleRule, prewakeIdleMin, speculativeExpired } from './fleet-prewake';

/** how long a stop or a roll waits for `drained` before the loss is accepted */
export const STOP_DRAIN_SECONDS = CLOUDRUN_DRAIN_SECONDS;

export interface CloudRunSweepResult {
  /** stops turned into drains this pass */
  capDrains: string[];
  idleDrains: string[];
  /** stops whose drain missed the deadline: scaled to 0, the loss stamped */
  lost: string[];
  /** rolls whose drain missed the deadline: rolled anyway, the loss stamped */
  rolled: string[];
  /** parked by an idle drain while a message arrived: woken again */
  rewoken: string[];
  /** the idle drains that ended a speculative start (fleet-prewake.ts): typing woke it, no message came */
  speculative?: string[];
}

const balance = (sql: postgres.Sql) => sql`greatest(coalesce(c.granted_micros, 0) - coalesce(c.spent_micros, 0), 0)
  + greatest(coalesce(c.purchased_micros, 0) - coalesce(c.purchased_spent_micros, 0), 0)`;

export async function cloudRunSweep(sql: postgres.Sql, idleMin: number): Promise<CloudRunSweepResult> {
  const deadline = () => sql`now() + make_interval(secs => ${STOP_DRAIN_SECONDS}::int)`;
  // the same two conditions as the kube stops in machineSweep, made drains
  const capDrains = await sql<{ id: string }[]>`
    update machines m set drain_state = 'draining', drain_reason = 'cap', drain_deadline = ${deadline()}
      from workspace_credits c
     where c.workspace_id = m.workspace_id and m.substrate = 'cloudrun' and m.desired_replicas = 1 and m.drain_state is null
       and ${balance(sql)} <= 0
       and (m.last_active_at is null or m.last_active_at < now() - interval '10 minutes')
     returning m.id`;
  // the full idle window, or a speculative start that no message followed (fleet-prewake.ts idleRule)
  const specMin = prewakeIdleMin();
  const idleDrains = await sql<{ id: string; speculative: boolean }[]>`
    update machines m set drain_state = 'draining', drain_reason = 'idle', drain_deadline = ${deadline()}
     where m.substrate = 'cloudrun' and m.desired_replicas = 1 and m.drain_state is null and m.idle_stop_min is not null
       and ${idleRule(sql, idleMin, specMin)}
     returning m.id, ${speculativeExpired(sql, specMin)} as speculative`;
  const lost = await sql<{ id: string }[]>`
    update machines
       set desired_replicas = 0, started_at = null, parked_at = drain_deadline - make_interval(secs => ${STOP_DRAIN_SECONDS}::int),
           drain_state = null, drain_reason = null, drain_deadline = null, drain_lost_at = now()
     where substrate = 'cloudrun' and drain_state = 'draining' and drain_reason in ('idle', 'cap') and drain_deadline < now()
     returning id`;
  // a roll that missed its deadline: the newest snapshot stays the restore point and the operator
  // writes the new image (the new instance's boot moves the epoch and fences the old one)
  const rolled = await sql<{ id: string }[]>`
    update machines set restarts = restarts + 1, drain_state = 'resizing', drain_deadline = null, drain_lost_at = now()
     where substrate = 'cloudrun' and drain_state = 'draining' and drain_reason = 'roll' and drain_deadline < now()
     returning id`;
  // a message that arrived DURING an idle drain could not wake a machine that was still awake. A
  // machine whose crash-loop breaker tripped stays asleep: only a person's wake retries it
  const rewoken = await sql<{ id: string }[]>`
    update machines m set desired_replicas = 1, last_wake_at = now(), started_at = now()
      from workspace_credits c
     where c.workspace_id = m.workspace_id and m.substrate = 'cloudrun' and m.desired_replicas = 0
       and m.parked_at is not null and m.last_wake_at > m.parked_at and ${balance(sql)} > 0
       and m.boot_loop_at is null
       and (m.lifecycle is null or m.lifecycle <> 'destroyed')
     returning m.id`;
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
  const speculative = idleDrains.filter((r) => r.speculative).map((r) => r.id);
  for (const id of speculative) console.log(`machine_prewake_expired machine=${id}: a speculative start had no message in ${specMin} min`);
  for (const id of ids(lost)) console.log(`machine_drain_lost machine=${id} reason=stop: the drain missed its ${STOP_DRAIN_SECONDS}s deadline`);
  for (const id of ids(rolled)) console.log(`machine_drain_lost machine=${id} reason=roll: the drain missed its ${STOP_DRAIN_SECONDS}s deadline`);
  return { capDrains: ids(capDrains), idleDrains: ids(idleDrains), lost: ids(lost), rolled: ids(rolled), rewoken: ids(rewoken), speculative };
}

/** nm-fleet asks for a roll when a running pool's image is behind: a drain that ends in a new
 *  revision at the same class. A no-op while another drain is under way */
export async function requestRoll(sql: postgres.Sql, machineId: string): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`
    update machines set drain_state = 'draining', drain_reason = 'roll',
           drain_deadline = now() + make_interval(secs => ${STOP_DRAIN_SECONDS}::int)
     where id = ${machineId}::uuid and substrate = 'cloudrun' and desired_replicas = 1 and drain_state is null
       and (lifecycle is null or lifecycle <> 'destroyed')
     returning id`;
  return Boolean(row);
}
