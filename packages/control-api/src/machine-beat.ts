// THE MACHINE HEARTBEAT AND ITS METER (credits round, and decision D2 "billed as active", 2026-11-06).
//
// Every beat moves last_seen_at, and for a cloud machine it charges the workspace:
//   * a normal machine: the active seconds the beat reports (machined samples work every 5 s). Its
//     standby is free, because the idle stop (NM_IDLE_STOP_MIN) bounds it.
//   * an Always on machine (idle_stop_min IS NULL) that the fleet keeps up (desired_replicas = 1): every
//     awake second, at the same price as an active second (priceActiveSeconds). It has no idle stop,
//     so its idle time is what the person chose to pay for.
//
// WHY THE BEAT AND NOT THE SWEEP. A beat proves that the instance is up, so a machine that is down
// (no instance, no beats) is never charged. And the beat already charges the active seconds, so one
// per-machine window covers both, and nothing is charged twice.
//
// THE WINDOW. machines.billed_through is the last beat the meter read (0176). An Always on beat charges
// the wall time since then, but never from before the run started (started_at) and never more than
// ALWAYS_ON_MAX_WINDOW_S: a beat after a gap (a lost network, a reboot) charges at most that, so a
// machine that was down is not charged for the gap. The beat's active seconds lie inside the window,
// so the charge is max(active, window), never their sum. The Always on switch sets billed_through when
// it turns on (machine-always-on.ts), so the first window starts at the switch.
//
// The charge never refuses (chargeMachineIn clamps the pools at zero), and the cap sweep still parks
// an Always on machine at a zero balance (machineSweep, cloudRunSweep). One transaction: the row lock
// that reads the window is held until the charge and the new billed_through commit.
import { priceActiveSeconds } from '@neuramesh/shared';
import type postgres from 'postgres';
import { chargeMachineIn } from './credit-ledger';

/** the longest stretch one beat may bill as Always on time: two 30 s beats (machined.ts) */
export const ALWAYS_ON_MAX_WINDOW_S = 60;

export interface BeatActivity { activeSeconds: number; busy: boolean; runtimes?: string[]; daemonVersion?: string; permissionVersion?: number }

/** what one beat bills: max(active, the Always on window). Pure, so the rule has a unit test */
export function beatCharge(activeSeconds: number, alwaysOn: boolean, windowSeconds: number): { billedSeconds: number; alwaysOnSeconds: number } {
  const active = Number.isFinite(activeSeconds) ? Math.max(0, Math.round(activeSeconds)) : 0;
  const window = alwaysOn && Number.isFinite(windowSeconds) ? Math.max(0, Math.min(ALWAYS_ON_MAX_WINDOW_S, Math.round(windowSeconds))) : 0;
  const billed = Math.max(active, window);
  return { billedSeconds: billed, alwaysOnSeconds: billed - active };
}

/** the beat itself (pgstore.heartbeatMachine delegates here). False when no machine the actor may beat has this id */
export async function beatMachine(sql: postgres.Sql, machineId: string, actorId: string, activity?: BeatActivity): Promise<boolean> {
  const seconds = Math.max(0, Math.round(activity?.activeSeconds ?? 0));
  const active = seconds > 0 || activity?.busy === true;
  return sql.begin(async (_tx) => {
    const tx = _tx as unknown as postgres.Sql;
    // the window since the last metered beat, read under the row lock. NULL billed_through or a
    // stopped run (no started_at) is no window
    const [prev] = await tx<{ window_s: number | null }[]>`
      select extract(epoch from now() - greatest(coalesce(billed_through, now()), coalesce(started_at, now()),
                                                 now() - make_interval(secs => ${ALWAYS_ON_MAX_WINDOW_S}::int)))::float8 as window_s
        from machines where id = ${machineId} for update`;
    // runtimes and the build ride the beat for cloud machines (they never register): written only
    // when sent, so an older machine's beat leaves the recorded build standing.
    // WHO MAY BEAT is in the WHERE, so a beat that fails it moves and charges nothing: a cloud
    // machine's owner only, and for a local one any human member of its workspace (two members'
    // laptops can share a default name, and so one row, and a local beat is never billed).
    const [row] = await tx<{ workspace_id: string; kind: string; idle_stop_min: number | null; desired_replicas: number }[]>`
      update machines m set last_seen_at = now(), last_active_at = case when ${active} then now() else m.last_active_at end, runtimes = case when ${!!activity?.runtimes} then ${tx.json((activity?.runtimes ?? []) as never)}::jsonb else m.runtimes end,
             permission_version = ${activity?.permissionVersion ?? 0}, daemon_version = coalesce(${activity?.daemonVersion ?? null}::text, m.daemon_version),
             billed_through = case when m.kind <> 'local' then now() else m.billed_through end
       where m.id = ${machineId}
         and (m.owner_user_id::text = ${actorId}
              or (m.kind = 'local' and exists (select 1 from workspace_members wm where wm.workspace_id = m.workspace_id and wm.user_id::text = ${actorId})))
       returning m.workspace_id, m.kind, m.idle_stop_min, m.desired_replicas`;
    if (!row) return false;
    // LOCAL machines beat too, and their time is the user's own hardware: never billed.
    if (row.kind === 'local') return true;
    const alwaysOn = row.idle_stop_min === null && Number(row.desired_replicas) === 1;
    const bill = beatCharge(seconds, alwaysOn, Number(prev?.window_s ?? 0));
    if (bill.billedSeconds > 0) await chargeMachineIn(tx, row.workspace_id, priceActiveSeconds(bill.billedSeconds), seconds, bill.alwaysOnSeconds);
    return true;
  }) as Promise<boolean>;
}
