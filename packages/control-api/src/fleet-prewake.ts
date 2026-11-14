// THE SPECULATIVE WAKE (decision D13, option W1). A Cloud Run machine needs 15 to 22 s to wake from
// cold. hq calls POST /v1/machines/prewake when a person starts to type in a composer that sends to an
// agent, so the boot overlaps with the typing and the reply starts sooner.
//
// The route wakes the SAME machines a message from this person would wake (bumpMachineWake in
// fleet-lifecycle.ts): the workspace's runner and the caller's own member machine. It differs from a
// message in four ways, and each one is deliberate:
//   1. It never clears a crash-loop breaker. Only a real message from a person does that
//      (fleet-cloudrun-breaker.ts). A machine with boot_loop_at stays asleep and is reported as held.
//   2. It only STARTS a stopped machine. An awake or waking machine is left alone. It does not move
//      last_wake_at, so it cannot defend a machine against the idle stop the way a message does.
//   3. It marks the start as speculative (machines.wake_speculative_at, migration 0175). When no message
//      and no work follows, the sweep stops the machine after NM_PREWAKE_IDLE_MIN minutes (default 5)
//      instead of the full idle window. See speculativeExpired below.
//   4. It is rate-limited per person and workspace (NM_PREWAKE_MIN_INTERVAL_SEC, default 30 s).
// The credit gate is the same as a message wake: a workspace with no credits does not wake.
import type { Actor } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import { sqlOf } from './credits';
import type { SqlFragment } from './fleet-cloudrun-breaker';
import type { Store } from './store';

const minutesEnv = (name: string, fallback: number): number => {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
/** NM_PREWAKE=off turns the route into a no-op that says so. On by default */
export const prewakeOn = (): boolean => process.env['NM_PREWAKE'] !== 'off';
/** minutes a speculative start may stay up with no message and no work */
export const prewakeIdleMin = (): number => Math.floor(minutesEnv('NM_PREWAKE_IDLE_MIN', 5));
/** the shortest gap between two prewakes from one person in one workspace */
export const prewakeMinIntervalSec = (): number => minutesEnv('NM_PREWAKE_MIN_INTERVAL_SEC', 30);

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

export type PrewakeOutcome = 'woken' | 'awake' | 'capped' | 'held' | 'none';
export interface PrewakeResult {
  /** woken: at least one machine started. awake: nothing to start. capped: no credits. held: a breaker
   *  is open. none: no cloud machine to wake */
  outcome: PrewakeOutcome;
  woken: string[];
  awake: string[];
  held: string[];
}

/** pure: the outcome from what each target was before the wake */
export function prewakeOutcome(rows: Array<{ id: string; was: number; looped: boolean; funded: boolean; woken: boolean }>): PrewakeResult {
  const woken = rows.filter((r) => r.woken).map((r) => r.id);
  const awake = rows.filter((r) => Number(r.was) > 0).map((r) => r.id);
  const held = rows.filter((r) => !r.woken && Number(r.was) === 0 && r.looped).map((r) => r.id);
  const asleep = rows.filter((r) => Number(r.was) === 0);
  const outcome: PrewakeOutcome = woken.length ? 'woken'
    : rows.length === 0 ? 'none'
      : asleep.length === 0 ? 'awake'
        : asleep.some((r) => !r.funded) ? 'capped'
          : held.length ? 'held' : 'awake';
  return { outcome, woken, awake, held };
}

/**
 * ONE statement: read the targets as they were, start the stopped ones that may start, and stamp the
 * start as speculative. The UPDATE re-checks desired_replicas and boot_loop_at on the live row, so two
 * prewakes that race start a machine once, and a breaker that trips in between still holds.
 */
export async function prewakeMachines(sql: postgres.Sql, workspaceId: string, userId: string): Promise<PrewakeResult> {
  const rows = await sql<Array<{ id: string; was: number; looped: boolean; funded: boolean; woken: boolean }>>`
    with t as (
      select m.id, m.desired_replicas as was, (m.boot_loop_at is not null) as looped,
             (greatest(coalesce(c.granted_micros, 0) - coalesce(c.spent_micros, 0), 0)
              + greatest(coalesce(c.purchased_micros, 0) - coalesce(c.purchased_spent_micros, 0), 0) > 0) as funded
        from machines m
        join workspaces w on w.id = m.workspace_id
        left join workspace_credits c on c.workspace_id = w.id
       where m.workspace_id = ${workspaceId}::uuid
         and m.kind <> 'local'
         and (m.lifecycle is null or m.lifecycle <> 'destroyed')
         and (m.kind = 'runner' or m.owner_user_id = ${userId}::uuid)
    ), up as (
      update machines m
         set desired_replicas = 1, started_at = now(), wake_speculative_at = now()
        from t
       where m.id = t.id and t.funded and m.desired_replicas = 0 and m.boot_loop_at is null
       returning m.id
    )
    select t.id, t.was, t.looped, t.funded, exists (select 1 from up where up.id = t.id) as woken from t`;
  return prewakeOutcome(rows);
}

/** Per person and workspace, in this process. Each nm-api instance keeps its own map, so N instances
 *  allow at most N calls in one interval. That is acceptable: the statement is idempotent, and a call
 *  on an awake machine changes nothing. The map is pruned so it cannot grow without a bound. */
export class PrewakeLimiter {
  private readonly last = new Map<string, number>();
  constructor(private readonly intervalMs: number, private readonly maxKeys = 10_000) {}
  /** true: go ahead (and the slot is taken). false: too soon */
  take(key: string, now: number = Date.now()): boolean {
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < this.intervalMs) return false;
    if (this.last.size >= this.maxKeys) {
      for (const [k, t] of this.last) if (now - t >= this.intervalMs) this.last.delete(k);
      if (this.last.size >= this.maxKeys) this.last.delete(this.last.keys().next().value!);
    }
    this.last.set(key, now);
    return true;
  }
}

const SURFACES = new Set(['thread', 'home', 'desk', 'code', 'task', 'room']);

export interface PrewakeDeps {
  prewake: (sql: postgres.Sql, workspaceId: string, userId: string) => Promise<PrewakeResult>;
  limiter: PrewakeLimiter;
}

/**
 * POST /v1/machines/prewake  { workspace, thread?, surface? }
 * Human-only and member-only, like Wake now. Always 200 for a member, with the outcome in the body:
 * the caller fires and forgets, and a refusal here is not an error the person must see.
 */
export function prewakeRoutes<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store, deps?: Partial<PrewakeDeps>): void {
  const prewake = deps?.prewake ?? prewakeMachines;
  const limiter = deps?.limiter ?? new PrewakeLimiter(prewakeMinIntervalSec() * 1000);
  app.post('/v1/machines/prewake', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { workspace?: unknown; surface?: unknown };
    const workspace = typeof body.workspace === 'string' ? body.workspace : '';
    if (!workspace) return c.json({ error: 'workspace required', code: 'INVALID_INPUT' }, 400);
    const actor = c.get('actor');
    if (actor.kind !== 'human') return c.json({ error: 'a prewake is human-only', code: 'NOT_PERMITTED' }, 403);
    const surface = typeof body.surface === 'string' && SURFACES.has(body.surface) ? body.surface : 'other';
    const none = { woken: [], awake: [], held: [], speculativeMin: prewakeIdleMin() };
    if (!prewakeOn()) return c.json({ ok: true, outcome: 'disabled', ...none });
    if (!limiter.take(`${actor.id}:${workspace}`)) return c.json({ ok: true, outcome: 'rate_limited', ...none });
    if (!(await store.humanMemberIds(workspace)).includes(actor.id)) {
      return c.json({ error: 'not a member of this workspace', code: 'NOT_PERMITTED' }, 403);
    }
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'fleet not served by this store', code: 'NOT_CONFIGURED' }, 501);
    const out = await prewake(sql, workspace, actor.id);
    // one line per call, so the hit rate can be read from the logs: prewakes that started a machine,
    // against the speculative stops the sweep logs as machine_prewake_expired
    console.log(`machine_prewake workspace=${workspace} user=${actor.id} surface=${surface} outcome=${out.outcome} woken=[${out.woken.join(',')}] held=[${out.held.join(',')}]`);
    return c.json({ ok: true, ...out, speculativeMin: prewakeIdleMin() });
  });
}
