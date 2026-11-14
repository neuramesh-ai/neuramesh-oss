// THE CLOUD RUN MACHINE LANE (packages/fleet/CLOUDRUN.md): the server half of a machine that lives in
// RAM on a Cloud Run Worker Pool and grows by drain → snapshot → resize. SQL-first, the fleet-claims
// idiom: every function takes the postgres handle, the Store contract grows no delegates, and a store
// without postgres refuses the routes out loud. Three files: this one (the fence, the drain walk, the
// status report), fleet-cloudrun-boot.ts (credential, boot, token), fleet-cloudrun-sweep.ts (the stops
// that drain first, rule M12).
//
// Rows stay the only truth. This module moves size_class / epoch / drain_*; the nm-fleet operator reads
// them through /internal/fleet-desired and re-stamps the pool. The walk:
//   running, memPct ≥ FLEET_CLOUDRUN_DRAIN_PCT, a bigger class allowed  → requested (grow)
//   a stop or a roll (fleet-cloudrun-sweep.ts)                           → draining (idle | cap | roll)
//   drained, after a stop                                                → parked (desired_replicas 0)
//   drained, otherwise: restarts + 1, keys stored, size → next or same   → resizing
//   the new instance boots (epoch + 1) and reports running               → NULL
// The decision runs on each status report (every ~2 s): a machine at 75 % memory cannot wait for the
// 5-minute sweep.
//
// THE FENCE (D12). The epoch moves in the database at every boot (fleet-cloudrun-boot.ts), never in
// the revision env. Every machine write names its epoch, and an older one gets 409 STALE_EPOCH, which
// machined reads as "fenced".
import type { Context, Env } from 'hono';
import type postgres from 'postgres';
import { z } from 'zod';
import { DomainError } from './errors';
import { STOP_DRAIN_SECONDS } from './fleet-cloudrun-sweep';

/** the class ids, smallest first. the sizes live in packages/fleet (cloudrun-spec.ts) and 0155's
 *  check constraint holds these ids, so a fourth copy cannot drift silently */
export const SIZE_ORDER = ['S', 'M', 'L', 'XL'] as const;
export type SizeClass = (typeof SIZE_ORDER)[number];
/** the largest class a plan may grow to; unknown plans take the free row */
const PLAN_MAX: Record<string, SizeClass> = { free: 'M', cloud: 'XL' };

export const cloudRunOn = (): boolean => process.env['FLEET_CLOUDRUN'] === '1';
const pctEnv = (name: string, fallback: number): number => {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : fallback;
};
/** control-api asks for a grow drain at this memory percent */
export const drainThresholdPct = (): number => pctEnv('FLEET_CLOUDRUN_DRAIN_PCT', 75);
/** machined's own OOM guard drains at this one (handed over at boot) */
export const guardPct = (): number => pctEnv('FLEET_CLOUDRUN_GUARD_PCT', 90);
export const planMaxSize = (plan: string): SizeClass => PLAN_MAX[plan] ?? 'M';
export function nextSize(current: SizeClass, max: SizeClass): SizeClass | null {
  const i = SIZE_ORDER.indexOf(current);
  return i < SIZE_ORDER.indexOf(max) ? (SIZE_ORDER[i + 1] ?? null) : null;
}
export const asSize = (v: string | null | undefined): SizeClass => (SIZE_ORDER as readonly string[]).includes(v ?? '') ? (v as SizeClass) : 'S';

/** the fence, pure: only the row's own epoch may write */
export function epochVerdict(rowEpoch: number, presented: number): 'ok' | 'stale' | 'ahead' {
  if (presented < rowEpoch) return 'stale';
  return presented > rowEpoch ? 'ahead' : 'ok';
}

export function fence(current: number, presented: number): void {
  const verdict = epochVerdict(current, presented);
  if (verdict === 'stale') throw new DomainError('STALE_EPOCH', `epoch ${presented} is behind ${current}: a newer instance owns this machine`);
  if (verdict === 'ahead') throw new DomainError('INVALID_INPUT', `epoch ${presented} is ahead of ${current}`);
}

/** refuses a machine write whose epoch is not the row's; returns the row's epoch */
export async function assertEpoch(sql: postgres.Sql, machineId: string, epoch: number): Promise<number> {
  const [row] = await sql<{ epoch: string }[]>`select epoch from machines where id = ${machineId}::uuid`;
  if (!row) throw new DomainError('NOT_FOUND', 'no such machine');
  fence(Number(row.epoch), epoch);
  return Number(row.epoch);
}

export const SnapshotKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const num = z.number().finite();
/** exactly what machined sends (apps/desktop/src/main/cloudrun/lifecycle.ts MachineStatus) */
export const StatusSchema = z.object({
  state: z.enum(['booting', 'running', 'draining', 'drained', 'completed']),
  interactiveReady: z.boolean().optional(),
  epoch: z.number().int().min(0),
  memPct: num.min(0).max(1000).optional(),
  usedMiB: num.min(0).optional(),
  limitMiB: num.min(0).max(1_048_576).optional(),
  cpuPct: num.min(0).nullable().optional(),
  throttleRatio: num.min(0).max(1).nullable().optional(),
  step: z.union([z.number(), z.string().max(200)]).nullable().optional(),
  restoreMs: num.min(0).nullable().optional(),
  bootToReadyMs: num.min(0).nullable().optional(),
  drainMs: num.min(0).nullable().optional(),
  /** machined's DrainReason ('controller' | 'oom-guard' | 'box-crashed'); a reason this server does
   *  not know yet reads as a memory drain rather than refusing the report */
  reason: z.string().max(64).optional(),
  /** the box key is absent when the box died: its overlay is gone, the work dir is the state */
  snapshot: z.object({ work: SnapshotKey, box: SnapshotKey.optional() }).optional(),
  /** a boot that could not restore the named work snapshot names what it restored instead: an
   *  older epoch's key, or null for a fresh work dir. The `error` says why (lifecycle.ts boot) */
  restoredFrom: SnapshotKey.nullable().optional(),
  error: z.string().max(2000).optional(),
});
export type StatusReport = z.infer<typeof StatusSchema>;

export type DrainReason = 'grow' | 'oom' | 'crash' | 'idle' | 'cap' | 'roll';
export interface DrainRow { substrate: string; epoch: number; desiredReplicas: number; drainState: string | null; drainReason: string | null; sizeClass: SizeClass; plan: string }
export type DrainMove =
  | { kind: 'none' }
  | { kind: 'request' }
  | { kind: 'self-drain'; reason: DrainReason }
  | { kind: 'park'; work: string; box: string | null }
  | { kind: 'resize'; next: SizeClass; reason: DrainReason; work: string; box: string | null }
  | { kind: 'settled' };

const STOPS = new Set(['idle', 'cap']);
const selfReason = (r: StatusReport): DrainReason => (r.reason === 'box-crashed' ? 'crash' : 'oom');

/** the drain walk, pure. A drain that ends in a new instance always counts a restart, even at the
 *  same class: with no template change the operator bounces the instance (a scale, no revision) */
export function drainMove(row: DrainRow, r: StatusReport, cfg: { on: boolean; thresholdPct: number }): DrainMove {
  if (!cfg.on || row.substrate !== 'cloudrun' || r.epoch !== row.epoch) return { kind: 'none' };
  if (r.state === 'running' && row.drainState === 'resizing') return { kind: 'settled' };
  const next = nextSize(row.sizeClass, planMaxSize(row.plan));
  if (r.state === 'running' && row.drainState === null && (r.memPct ?? 0) >= cfg.thresholdPct && next) return { kind: 'request' };
  if (r.state === 'draining' && row.drainState === null) return { kind: 'self-drain', reason: selfReason(r) };
  if (r.state !== 'drained' || !r.snapshot || row.drainState === 'resizing') return { kind: 'none' };
  // a parked machine (desired 0) that reports late has nothing to restart into
  if (row.desiredReplicas !== 1) return { kind: 'none' };
  const box = r.snapshot.box ?? null;
  if (STOPS.has(row.drainReason ?? '')) return { kind: 'park', work: r.snapshot.work, box };
  const reason = (row.drainReason ?? selfReason(r)) as DrainReason;
  // only memory grows a machine: a roll or a crashed box restarts it at the class it had
  const grow = reason === 'grow' || reason === 'oom' ? next : null;
  return { kind: 'resize', next: grow ?? row.sizeClass, reason, work: r.snapshot.work, box };
}

/** what machined reads: GET /v1/machines/control answers exactly this, flat */
/** `wake`: desired 1 with no drain or resize under way. A drained instance that reads it was woken
 *  after its park, before nm-fleet scaled the pool to 0, and restarts (machined controlVerdict) */
export interface Control { epoch: number; action: 'run' | 'drain'; snapshot: { work: string; box?: string } | null; wake?: boolean }
export function controlFor(row: { epoch: number; drainState: string | null; work: string | null; box: string | null; desired?: number }): Control {
  const draining = row.drainState === 'requested' || row.drainState === 'draining';
  return { epoch: row.epoch, action: draining ? 'drain' : 'run', snapshot: row.work ? { work: row.work, ...(row.box ? { box: row.box } : {}) } : null,
    ...(row.desired === undefined ? {} : { wake: Number(row.desired) === 1 && row.drainState === null }) };
}

export interface MachineRow {
  substrate: string; epoch: string; desired_replicas: number; drain_state: string | null; drain_reason: string | null;
  size_class: string | null; plan: string; snapshot_work: string | null; snapshot_box: string | null;
}
const COLS = (sql: postgres.Sql) => sql`m.substrate, m.epoch, m.desired_replicas, m.drain_state, m.drain_reason, m.size_class, w.plan, m.snapshot_work, m.snapshot_box`;
export const readRow = async (sql: postgres.Sql, id: string): Promise<MachineRow | null> => (await sql<MachineRow[]>`
  select ${COLS(sql)} from machines m join workspaces w on w.id = m.workspace_id
   where m.id = ${id}::uuid and m.kind <> 'local' and (m.lifecycle is null or m.lifecycle <> 'destroyed')`)[0] ?? null;
export const toControl = (r: MachineRow): Control => controlFor({ epoch: Number(r.epoch), drainState: r.drain_state, work: r.snapshot_work, box: r.snapshot_box, desired: r.desired_replicas });

/** the row update one move makes, as plain values (null = leave the column) */
function effect(move: DrainMove, row: MachineRow) {
  switch (move.kind) {
    case 'request': return { drain: 'requested', reason: 'grow', bump: 0, size: null, keys: null, park: false };
    case 'self-drain': return { drain: 'draining', reason: move.reason, bump: 0, size: null, keys: null, park: false };
    case 'park': return { drain: null, reason: null, bump: 0, size: null, keys: move, park: true };
    case 'resize': return { drain: 'resizing', reason: move.reason, bump: 1, size: move.next, keys: move, park: false };
    case 'settled': return { drain: null, reason: null, bump: 0, size: null, keys: null, park: false };
    default: return { drain: row.drain_state, reason: row.drain_reason, bump: 0, size: null, keys: null, park: false };
  }
}

/** persist one status report and take the drain step it implies. optimistic: the update holds the
 *  epoch and drain_state it decided on, so a racing report changes nothing and reads the winner */
export async function applyMachineStatus(sql: postgres.Sql, machineId: string, r: StatusReport): Promise<{ control: Control; move: DrainMove['kind'] }> {
  const row = await readRow(sql, machineId);
  if (!row) throw new DomainError('NOT_FOUND', 'no such machine');
  const epoch = Number(row.epoch);
  fence(epoch, r.epoch);
  const move = drainMove({ substrate: row.substrate, epoch, desiredReplicas: row.desired_replicas, drainState: row.drain_state, drainReason: row.drain_reason, sizeClass: asSize(row.size_class), plan: row.plan }, r, { on: cloudRunOn(), thresholdPct: drainThresholdPct() });
  const e = effect(move, row);
  const keyed = e.keys !== null;
  const [updated] = await sql<MachineRow[]>`
    update machines m
       set last_seen_at = case when ${r.state === 'running' && r.interactiveReady !== false} then now() else m.last_seen_at end,
           interactive_ready = case when ${r.interactiveReady === false} then false
                                    when ${r.state === 'running' && r.interactiveReady === true} then true
                                    else m.interactive_ready end,
           mem_pct = coalesce(${r.memPct ?? null}::real, m.mem_pct),
           used_mib = coalesce(${r.usedMiB === undefined ? null : Math.round(r.usedMiB)}::int, m.used_mib),
           limit_mib = coalesce(${r.limitMiB === undefined ? null : Math.round(r.limitMiB)}::int, m.limit_mib),
           cpu_pct = coalesce(${r.cpuPct ?? null}::real, m.cpu_pct),
           throttle_ratio = coalesce(${r.throttleRatio ?? null}::real, m.throttle_ratio),
           drain_state = ${e.drain}::text,
           drain_reason = ${e.reason}::text,
           drain_deadline = case when ${e.drain === null || e.drain === 'resizing'} then null else m.drain_deadline end,
           restarts = m.restarts + ${e.bump},
           size_class = coalesce(${e.size}::text, m.size_class),
           snapshot_work = case when ${keyed} then ${e.keys?.work ?? null}::text else m.snapshot_work end,
           snapshot_box = case when ${keyed} then ${e.keys?.box ?? null}::text else m.snapshot_box end,
           desired_replicas = case when ${e.park} then 0 else m.desired_replicas end,
           started_at = case when ${e.park} then null else m.started_at end,
           -- a running report ends a boot streak: the crash-loop breaker counts boots since the last one
           boot_streak = case when ${r.state === 'running' && r.interactiveReady !== false} then 0 else m.boot_streak end,
           boot_streak_since = case when ${r.state === 'running' && r.interactiveReady !== false} then null else m.boot_streak_since end,
           -- parked_at = when the stop's drain began, so a message during it wakes the machine again
           parked_at = case when ${e.park} then coalesce(m.drain_deadline - make_interval(secs => ${STOP_DRAIN_SECONDS}::int), now()) else m.parked_at end
      from workspaces w
     where w.id = m.workspace_id and m.id = ${machineId}::uuid and m.epoch = ${epoch}
       and m.drain_state is not distinct from ${row.drain_state}::text
     returning ${COLS(sql)}`;
  if (!updated) return { control: toControl((await readRow(sql, machineId)) ?? row), move: 'none' };
  if (move.kind !== 'none' || r.state !== 'running') {
    console.log(`machine_status machine=${machineId} state=${r.state} move=${move.kind} epoch=${updated.epoch} size=${updated.size_class ?? 'S'}`
      + ` reason=${r.reason ?? ''} drainMs=${r.drainMs ?? ''} restoreMs=${r.restoreMs ?? ''} bootToReadyMs=${r.bootToReadyMs ?? ''}`
      + `${r.restoredFrom !== undefined ? ` restoredFrom=${r.restoredFrom ?? 'fresh'}` : ''}${r.error ? ` error=${JSON.stringify(r.error.slice(0, 200))}` : ''}`);
  }
  return { control: toControl(updated), move: move.kind };
}

export async function machineControl(sql: postgres.Sql, machineId: string): Promise<Control | null> {
  const row = await readRow(sql, machineId);
  return row ? toControl(row) : null;
}

export const refuse = <E extends Env>(c: Context<E>, e: unknown) => {
  if (e instanceof DomainError) return c.json({ error: e.message, code: e.code }, e.status as 409);
  throw e;
};
