// THE IDLE RULE of a cloud machine, shared by the kube sweep (fleet-lifecycle.ts machineSweep) and the
// Cloud Run sweep (fleet-cloudrun-sweep.ts). Public: the server runs the kube sweep everywhere, and the
// speculative start it reads (fleet-prewake.ts, migration 0175) is only a column when no prewake runs.
import type postgres from 'postgres';

/** the type a `sql` tagged template returns, so a condition can be handed over as a fragment */
const _fragment = (sql: postgres.Sql) => sql`true`;
export type SqlFragment = ReturnType<typeof _fragment>;

export const minutesEnv = (name: string, fallback: number): number => {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
/** minutes a speculative start may stay up with no message and no work */
export const prewakeIdleMin = (): number => Math.floor(minutesEnv('NM_PREWAKE_IDLE_MIN', 5));

/**
 * The speculative part of the idle rule, as a fragment over `machines m`. A run is speculative while
 * the prewake started it (wake_speculative_at at or after started_at) and nothing happened since: no
 * message (every delivered message moves last_wake_at) and no work (an active heartbeat moves
 * last_active_at). Any of those ends the speculative state at once, so no other wake path has to clear
 * the column, and an old stamp on a machine that a later wake started can never match.
 */
export const speculativeExpired = (sql: postgres.Sql, specMin: number): SqlFragment => sql`(
  m.wake_speculative_at is not null
  and m.started_at is not null and m.wake_speculative_at >= m.started_at
  and coalesce(m.last_wake_at, to_timestamp(0)) < m.wake_speculative_at
  and coalesce(m.last_active_at, to_timestamp(0)) < m.wake_speculative_at
  and m.wake_speculative_at < now() - make_interval(mins => ${specMin}::int))`;

/**
 * THE IDLE RULE both sweeps share (machineSweep for kube, cloudRunSweep for Cloud Run): the full window
 * since the last message, work or speculative start, OR a speculative start that expired. The
 * speculative start counts in the full window too, because a prewake does not move last_wake_at and a
 * machine woken after a long sleep would otherwise look idle for days on its first pass.
 */
export const idleRule = (sql: postgres.Sql, idleMin: number, specMin: number = prewakeIdleMin()): SqlFragment => sql`(
  greatest(coalesce(m.last_wake_at, to_timestamp(0)), coalesce(m.last_active_at, to_timestamp(0)),
           coalesce(m.wake_speculative_at, to_timestamp(0)))
    < now() - make_interval(mins => ${idleMin}::int)
  or ${speculativeExpired(sql, specMin)})`;
