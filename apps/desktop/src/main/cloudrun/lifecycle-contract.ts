// Machine lifecycle states, hooks and pure transition rules.
import { CLOUDRUN_DRAIN_SECONDS } from '@neuramesh/shared';
import type { BoxManager } from './box';
import type { ContainerResources } from './resources';
import type { Snapshots, ListedSnapshot } from './snapshot';
import type { CloudRunConfig } from '../machined-config';

export type MachineState = 'booting' | 'running' | 'draining' | 'drained' | 'completed';
export type DrainReason = 'controller' | 'oom-guard' | 'box-crashed';

export interface SnapshotKeys { work: string; box?: string }

/** what the controller wants: the epoch this incarnation runs under, and where its state is */
export interface Control {
  epoch: number;
  action?: 'run' | 'drain' | null;
  snapshot?: SnapshotKeys | null;
  /** the row wants this machine up (desired 1) with no drain or resize under way. A DRAINED instance
   *  that reads it was woken after its park, before nm-fleet scaled the pool to 0: it must restart */
  wake?: boolean;
}

export interface MachineStatus {
  interactiveReady?: boolean;
  state: MachineState;
  epoch: number;
  memPct: number;
  usedMiB: number;
  limitMiB: number;
  cpuPct: number | null;
  throttleRatio: number | null;
  reason?: DrainReason;
  snapshot?: SnapshotKeys;
  drainMs?: number;
  /** the work key the boot restored when it was not the named one; null = a fresh work dir */
  restoredFrom?: string | null;
  restoreMs?: number;
  error?: string;
}

export interface ControlChannel {
  read(): Promise<Control>;
  /** throws EpochFencedError when a newer epoch owns the machine */
  report(status: MachineStatus): Promise<void>;
}

/** The daemon's own stop points. Each is a real hook in machined (README.md lists them). */
export interface DrainHooks {
  /** admit no new turns: the agent host queue and new Code sessions */
  holdTurns(): void;
  /** turns still running: queued flows in flight plus busy Code sessions */
  turnsInFlight(): number;
  /** stop what still runs at its next stop check, and close Code sessions (each checkpoints its brain) */
  parkTurns(): Promise<void>;
  /** every conversation brain's cloud outbox */
  flushBrains(): Promise<void>;
  /** the replica's queued writes (PowerSync ps_crud) */
  drainWrites(timeoutMs: number): Promise<void>;
}

/** The durable parks' two seams in the loop (parks.ts, architecture.md §5 and §6.3): an open park
 *  that expires within 5 minutes counts as busy, and a resolved park is claimed and resumed. */
export interface ParkHooks {
  busySoon(): boolean;
  /** claim every resolved park for this epoch and resume its turn; throws only a fence */
  resumeResolved(): Promise<number>;
}

/** a resolved park is looked for every this many loops while awake (30 s) */
export const PARK_POLL_EVERY = 15;
export const GUARD_MS = 250;
export const LOOP_MS = 2_000;
/** a stop drain, grace and snapshot included, finishes inside this */
export const DRAIN_BUDGET_MS = CLOUDRUN_DRAIN_SECONDS * 1_000;
/** a box liveness exec every this many loops (each exec is a Cloud Logging line) */
export const ALIVE_EVERY = 8;

/** what the boot grant (boot.ts) hands the lifecycle */
export interface BootStart {
  epoch: number;
  snapshot?: SnapshotKeys | null;
  guardPct?: number | null;
}

export function bootEpoch(start: Pick<BootStart, 'epoch'>): number {
  if (!Number.isInteger(start.epoch) || start.epoch < 1) throw new Error('The boot grant has no epoch. A Cloud Run machine does not run unfenced.');
  return start.epoch;
}

/** A newer epoch means another incarnation owns this machine: stop acting. An older one is stale. */
export function controlVerdict(control: Control, epoch: number, state: MachineState): 'drain' | 'fenced' | 'restart' | 'none' {
  if (Number.isInteger(control.epoch) && control.epoch > epoch) return 'fenced';
  if (control.action === 'drain' && control.epoch === epoch && state === 'running') return 'drain';
  // A wake that lands after the park and before nm-fleet scaled the pool to 0 finds this instance
  // still alive. nm-fleet sees one instance for desired 1 and does nothing, and a drained instance
  // starts no work: the machine would stay up and deaf. So it exits, and Cloud Run restarts the
  // container into a fresh boot that restores the snapshot this drain just saved
  if (control.wake === true && control.action !== 'drain' && control.epoch === epoch && state === 'drained') return 'restart';
  return 'none';
}

export function snapshotKeysFor(epoch: number, boxAlive: boolean): SnapshotKeys {
  return boxAlive ? { work: `work-e${epoch}`, box: `box-e${epoch}` } : { work: `work-e${epoch}` };
}

/** older stored epochs a boot tries after the named work snapshot fails, newest first */
export const RESTORE_FALLBACKS = 3;
/** a zstd frame of nothing is 9 bytes: a stored snapshot that small holds no archive */
export const EMPTY_ZSTD_BYTES = 9;

/** the epoch a snapshot key names (`work-e12` is 12), or null */
export function keyEpoch(key: string, kind: 'work' | 'box' = 'work'): number | null {
  const m = (kind === 'work' ? /^(?:work|manifest)-e(\d+)$/ : /^box-e(\d+)$/).exec(key);
  return m ? Number(m[1]) : null;
}

/** Where a boot goes after the named work snapshot fails: older stored work snapshots, newest
 *  first, at most `max`. Only epochs below the named one count (a newer key is a drain that never
 *  reported), and never an empty object. */
export function fallbackKeys(named: string, listed: ReadonlyArray<ListedSnapshot>, max = RESTORE_FALLBACKS): string[] {
  const top = keyEpoch(named);
  return listed
    .flatMap((o) => {
      const e = keyEpoch(o.key);
      return e !== null && o.key !== named && o.size > EMPTY_ZSTD_BYTES && (top === null || e < top) ? [{ key: o.key, e }] : [];
    })
    .sort((a, b) => b.e - a.e)
    .slice(0, max)
    .map((o) => o.key);
}

/** the box overlay that belongs with a work key: the same epoch's, when it is stored */
export function boxKeyFor(work: string, named: SnapshotKeys, listed: ReadonlyArray<ListedSnapshot>): string | null {
  if (work === named.work) return named.box ?? null;
  const e = keyEpoch(work);
  const box = e === null ? null : listed.find((o) => o.key === `box-e${e}` && o.size > EMPTY_ZSTD_BYTES);
  return box ? box.key : null;
}

/** what a boot restored. `work` null = a fresh work dir; `failed` lists each key that did not restore */
export interface RestoreOutcome {
  work: string | null;
  box: string | null;
  failed: Array<{ key: string; error: string }>;
}

/** a controller drain gives running turns the grace window; a guard or a crash has no time to give */
export function graceFor(reason: DrainReason, graceMs: number): number {
  return reason === 'controller' ? graceMs : 0;
}

export interface LifecycleOptions {
  cfg: CloudRunConfig;
  control: ControlChannel;
  snapshots: Snapshots;
  box: BoxManager | null;
  resources: Pick<ContainerResources, 'memory' | 'cpu'>;
  log?: (event: string, fields?: Record<string, unknown>) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** a rejected token ends the process so Cloud Run restarts it into a fresh boot (tests inject it) */
  exit?: (why: string) => void;
  /** the login vault (vault.ts, NM_VAULT=1): restored before the box, flushed before the snapshot */
  vault?: LoginVaultPort | null;
}

/** what the lifecycle needs of the login vault (VaultAgent) */
export interface LoginVaultPort {
  restore(): Promise<unknown>;
  start(): void;
  stop(): void;
  flush(): Promise<void>;
}
