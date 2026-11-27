// P1 adoption (docs/harness/05) — the concurrency ceiling and priority the AgentHost has never had.
//
// The 23 `db.watch` registrations stay: they become trigger PRODUCERS rather than flows, exactly as
// the spec describes. What changes is that a flow no longer starts the instant its row appears — it
// asks the queue, which admits it when a slot is free and admits the most urgent thing first.
//
// ── What this does NOT do, and why ────────────────────────────────────────────────────────────
// It does not make the in-flight guards durable. `claimed` LOOKS like a dedupe set that should
// survive a restart, and docs/harness/05 §2.1 said so, but that is wrong: the resume watch exists to
// pick up "in_progress tasks that THIS PROCESS isn't executing — host crashed/restarted mid-task", and
// it decides that by `claimed.has(...)`. A durable `claimed` would therefore strand every task whose
// host died mid-execution, permanently. Ephemerality is load-bearing there.
//
// Durability belongs to ALREADY-HANDLED FACTS, not in-flight state:
//   · merged   — `gh pr merge` on an already-merged PR errors into the thread; one attempt per task
//   · reclaimed — worktree deletion; idempotent but noisy to repeat every boot
//   · reviewed  — keyed by SUBMITTED SHA it becomes correct by construction, and then safe to persist
// Those are what `SeenStore` is for. Everything else stays a Set, on purpose.
//
// Run: pnpm exec tsx --test src/main/harness/hostqueue.test.ts
import { Dispatcher, defaultCaps, priorityOf, SqliteSeenStore, type Caps, type SeenStore, type TriggerCause } from './dispatch';
import { MemorySeenStore } from './dispatch';
import { FactSeenStore, type FactStore } from './facts';
import { join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import type { TurnKind } from '@neuramesh/shared';
import type { LogFn } from '../agentlog';

export interface HostQueueOpts {
  caps?: Caps;
  headless?: boolean;
  seen?: SeenStore;
  /** surfaced so a shed batch is named, never silent */
  onShed?: (ids: string[]) => void;
  log?: (line: string) => void;
  /**
   * The turn record (docs/harness/01 §3.3, docs/harness/05 §3.5).
   *
   * The queue is the ONE place that brackets every flow, so the settle discipline belongs here rather
   * than inside nine flow bodies. That matters because three of them — executeFlow, claimFlow and
   * resumeFlow — have no `finally` at all: an exception mid-flow left nothing recorded about how the
   * turn ended. Bracketing at the queue gives all fourteen dispatch sites a guaranteed open/settle
   * pair without touching a single flow, which is what keeps this diff reviewable.
   */
  turns?: TurnRecorder;
  /** The durable conversation context must surround the flow and all of its async runtime calls. */
  around?: (work: QueuedWork, run: () => Promise<unknown>) => Promise<unknown>;
}

export interface TurnRecorder {
  open(work: QueuedWork): void;
  settle(work: QueuedWork, state: 'done' | 'failed', err?: unknown): void;
}

/** Captured by the managed coding task before UI commands arrive on a different async chain. */
export const hostApprovalSlot = new AsyncLocalStorage<{ pause(): void; resume(): Promise<void> }>();

export interface QueuedWork {
  /** the dedupe/accounting key — a triggerKey.* value */
  key: string;
  kind: TurnKind;
  cause: TriggerCause;
  agentId: string;
  /**
   * The SUBJECT this turn belongs to — a thread id or a task number.
   *
   * Passed explicitly rather than parsed out of `key`, which was the first attempt and was wrong: a
   * wake key is `wake:<messageId>:<agentId>`, so deriving the subject from it filed every single
   * message under its own brain directory — the exact opposite of a brain shared across the turns of
   * one conversation. A key is for dedupe; only the caller knows the subject.
   */
  subject?: { kind: 'thread'; id: string } | { kind: 'task'; number: number };
}

/**
 * Admission control for the AgentHost's flows.
 *
 * `run` is the ONE call site change a flow needs: `void claimFlow(a, t)` becomes
 * `void queue.run({...}, () => claimFlow(a, t))`. The flow itself is untouched, which is what keeps
 * this a behaviour-preserving change with one new behaviour — waiting instead of stampeding.
 */
export class HostQueue {
  /** The Cloud Run drain's admission stop (cloudrun/lifecycle.ts). Process-wide because a drain
   *  stops the whole machine, and the agent host keeps its queue private. Queued work stays queued:
   *  the watches that produced it re-derive it on the next machine. */
  private static held = false;
  private static live = new Set<HostQueue>();
  static holdAdmission(held: boolean): void {
    HostQueue.held = held;
    if (!held) for (const q of HostQueue.live) void q.drain();
  }
  /** flows admitted and not yet settled, across every queue in this process */
  static inFlight(): number {
    let n = 0;
    for (const q of HostQueue.live) n += q.d.stats().running;
    return n;
  }
  /** The CPUs the default caps derive from, for queues built after this call. A Cloud Run machine
   *  passes its cgroup quota: os.cpus() reports 5 there whatever the vCPU limit is (measured). */
  static useCpuCount(n: number | null): void { cpuOverride = n; }

  private d: Dispatcher;
  private pending = new Map<string, () => Promise<unknown>>();
  /** what each caller says when its flow throws, keyed like `pending` */
  private failed = new Map<string, (err: unknown) => unknown>();
  private draining = false;
  private log?: (line: string) => void;
  private turns?: TurnRecorder;
  private around?: HostQueueOpts['around'];
  private meta = new Map<string, QueuedWork>();
  private resuming = new Map<string, () => void>();

  private approvalSlot(key: string) {
    let resume: Promise<void> | undefined;
    return {
      pause: () => {
        this.d.waitForApproval(key);
        void this.drain();
      },
      resume: () => {
        if (!resume) {
          resume = new Promise<void>(resolve => {
            this.resuming.set(key, resolve);
            void this.drain();
          }).finally(() => { resume = undefined; });
        }
        return resume;
      },
    };
  }

  constructor(opts: HostQueueOpts = {}) {
    const caps = opts.caps ?? defaultCaps(cpuCount(), opts.headless);
    this.log = opts.log;
    this.turns = opts.turns;
    this.around = opts.around;
    this.d = new Dispatcher(opts.seen ?? new MemorySeenStore(), caps, {
      onShed: (shed) => opts.onShed?.(shed.map((t) => t.id)),
    });
    this.log?.(`host queue: ${caps.slots} slots, ${caps.perAgent} per agent`);
    HostQueue.live.add(this);
  }

  /**
   * Offer work. Returns false when the queue refuses it — already queued, already running, or already
   * settled durably. A false is NOT an error: it is the guard doing its job, and the caller should
   * simply not run the flow.
   *
   * `onFail` hears the error when the flow throws, the `around` included, after its slot is free. A
   * wake's flow catches its own failures, so what reaches here is a turn that never started (its
   * thread's brain did not load), and only the caller knows the thread to say so in (host/wakefail.ts).
   */
  run(work: QueuedWork, fn: () => Promise<unknown>, onFail?: (err: unknown) => unknown): boolean {
    const offered = this.d.offer({ id: work.key, kind: work.kind, cause: work.cause, agentId: work.agentId, subject: work.subject?.kind === 'thread' ? { threadId: work.subject.id } : {} });
    if (!offered) return false;
    this.pending.set(work.key, fn);
    this.meta.set(work.key, work);
    if (onFail) this.failed.set(work.key, onFail);
    else this.failed.delete(work.key);
    void this.drain();
    return true;
  }

  /**
   * Admit as much as the slots allow, in priority order.
   *
   * Serialised by the `draining` latch: `drain` is re-entered from every settle, and two concurrent
   * drains would each see the same free slot and admit twice — the exact over-admission the ceiling
   * exists to prevent.
   */
  private async drain(): Promise<void> {
    if (this.draining || HostQueue.held) return;
    this.draining = true;
    try {
      for (;;) {
        // A human has already answered these approvals. Give those tasks their
        // slots back before admitting more work, subject to the same ceilings.
        for (const [key, resolve] of this.resuming) {
          if (this.d.resumeAfterApproval(key)) {
            this.resuming.delete(key);
            resolve();
          }
        }
        const t = this.d.admit();
        if (!t) return;
        const fn = this.pending.get(t.id);
        const work = this.meta.get(t.id);
        const onFail = this.failed.get(t.id);
        this.pending.delete(t.id); this.meta.delete(t.id); this.failed.delete(t.id);
        if (!fn || !work) { this.d.settle(t.id, 'stopped'); continue; }
        this.log?.(`admit ${t.kind} ${t.id} (p${priorityOf(t)}) · ${this.d.stats().running}/${this.d.stats().slots} slots`);
        // fire and forget: the flow owns its own errors, and the queue only owns accounting. Settling
        // in `finally` mirrors the turn lifecycle's rule — an unsettled key would leak a slot forever.
        void (async () => {
          // the recorder is best-effort in BOTH directions: a broken ledger must never fail a turn,
          // and a failing turn must still be recorded. Hence try/catch around each record call.
          try { this.turns?.open(work); } catch { /* recording is never load-bearing */ }
          let outcome: 'done' | 'failed' = 'done';
          let thrown: unknown;
          try {
            await hostApprovalSlot.run(this.approvalSlot(t.id), () => this.around ? this.around(work, fn) : fn());
          } catch (err) {
            outcome = 'failed';
            thrown = err;
            this.log?.(`flow ${t.id} threw: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}`);
          } finally {
            // EVERY exit path settles — the accounting mirror of the turn lifecycle's rule. An
            // unsettled key leaks a slot forever, which is a wedged host rather than a lost turn.
            this.d.settle(t.id, outcome);
            try { this.turns?.settle(work, outcome, thrown); } catch { /* see above */ }
            void this.drain();
            // the caller's word on the failure runs after the slot is free, so whatever it does (a
            // post into the thread) can neither hold nor wedge a slot, and its own throw is only logged
            if (outcome === 'failed' && onFail) {
              void Promise.resolve().then(() => onFail(thrown)).catch((e: unknown) => {
                this.log?.(`flow ${t.id} failure hook threw: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`);
              });
            }
          }
        })();
      }
    } finally {
      this.draining = false;
    }
  }

  /**
   * Release a key so its trigger may fire again — a review bounce, a re-offer, a park wake.
   *
   * This is what the existing `claimed.delete(...)` call sites mean, made explicit: deliberate
   * re-arming rather than a set mutation whose intent a reader has to infer.
   */
  rearm(key: string): void { this.d.rearm(key); }

  stats(): { queued: number; running: number; shed: number; slots: number } { return this.d.stats(); }

  /** Boot recovery: nothing this process owns can still be running. */
  resetRunning(): string[] { return this.d.resetRunning().map((r) => r.triggerId); }
}

let cpuOverride: number | null = null;

function cpuCount(): number {
  if (cpuOverride !== null) return cpuOverride;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require('node:os') as typeof import('node:os')).cpus().length;
  } catch {
    return 4;
  }
}

/**
 * A Set-shaped facade over a durable store.
 *
 * Exists so the ALREADY-HANDLED guards (`merged`, `reclaimed`) gain durability with **no call-site
 * change** — they keep reading as `has`/`add`, so the surrounding flow logic is untouched and the diff
 * stays reviewable. Deliberately NOT used for `claimed` (see the header).
 */
export class DurableSet<T extends string | number> {
  constructor(private store: SeenStore, private prefix: string) {}
  has(v: T): boolean { return this.store.has(`${this.prefix}:${v}`); }
  add(v: T): this { this.store.mark(`${this.prefix}:${v}`, 'done'); return this; }
  delete(v: T): boolean { this.store.clear(`${this.prefix}:${v}`); return true; }
}

/** Log a queue snapshot — used by the sweep so a wedged queue is visible in the activity log. */
export function queueLine(q: HostQueue): string {
  const s = q.stats();
  return `queue: ${s.running}/${s.slots} running, ${s.queued} waiting${s.shed ? `, ${s.shed} shed` : ''}`;
}

export type { LogFn };

/**
 * The durable store for already-handled facts, in the brain's `state/` (docs/harness/01 §3.2).
 *
 * Fail-open to memory, matching the egress proxy and the FS jail: an unwritable disk must degrade the
 * guard, never take the agent loop down — and the degradation is LOGGED rather than swallowed, because
 * silently-ephemeral dedupe is how the merge-twice bug would come back unnoticed.
 */
export function durableStore(brainRoot: string, log?: (line: string) => void): SeenStore {
  // Cloud Run (`NM_SUBSTRATE=cloudrun`): the same facts, with Postgres as the authority (facts.ts).
  // machined prepares and hydrates the store before the agent host starts; one built here instead
  // (prepare skipped or failed) hydrates in the background and says so.
  if (shared) {
    if (shared.store && shared.root === brainRoot) return shared.store;
    const store = new FactSeenStore(localStore(brainRoot, log), shared.remote, { machineScoped: MACHINE_SCOPED_FACTS, machineId: shared.machineId, ...(log ? { log } : {}) });
    log?.('durable guards: the shared fact store was not hydrated before the host started — hydrating now');
    void store.hydrate(DURABLE_FACT_KINDS).catch((err: unknown) => log?.(`durable guards: hydration failed (${err instanceof Error ? err.message.slice(0, 90) : 'error'})`));
    shared.store = store;
    shared.root = brainRoot;
    return store;
  }
  return localStore(brainRoot, log);
}

function localStore(brainRoot: string, log?: (line: string) => void): SeenStore {
  try {
    const dir = join(brainRoot, 'state');
    mkdirSync(dir, { recursive: true });
    const store = new SqliteSeenStore(join(dir, 'harness.db'));
    store.prune(7 * 86_400_000); // same retention as the activity log
    return store;
  } catch (err) {
    log?.(`durable guards unavailable — falling back to in-memory (${err instanceof Error ? err.message.slice(0, 90) : 'error'})`);
    return new MemorySeenStore();
  }
}

// ── Cloud Run: the shared fact store (docs/design/cloud-run-2026-10/architecture.md §4) ──────────
/** the host guards that are durable facts (host/guards.ts): the hydration reads exactly these */
export const DURABLE_FACT_KINDS = ['merged', 'reclaimed', 'hire-proposed', 'wake-gave-up'] as const;
/** a reclaimed worktree is THIS machine's disk: its fact is keyed by machine, never shared as done */
export const MACHINE_SCOPED_FACTS: ReadonlySet<string> = new Set(['reclaimed']);

let shared: { remote: FactStore; machineId: string; store?: FactSeenStore; root?: string } | null = null;

/** machined, on Cloud Run only: route every durable guard through the shared store. null = local only */
export function useSharedFacts(remote: FactStore | null, machineId = ''): void {
  shared = remote ? { remote, machineId } : null;
}

/** Build the host's guard store and hydrate it from Postgres BEFORE the agent host reads it, so a
 *  machine that crashed between drains (its local cache rolled back to the last snapshot) still
 *  knows every fact a previous epoch recorded. Returns null when no shared store is configured. */
export async function prepareDurableFacts(brainRoot: string, log?: (line: string) => void): Promise<FactSeenStore | null> {
  if (!shared) return null;
  const store = new FactSeenStore(localStore(brainRoot, log), shared.remote, { machineScoped: MACHINE_SCOPED_FACTS, machineId: shared.machineId, ...(log ? { log } : {}) });
  await store.hydrate(DURABLE_FACT_KINDS);
  shared.store = store;
  shared.root = brainRoot;
  return store;
}

/** is this guard store shared across epochs (Cloud Run)? host/guards.ts makes more guards durable then */
export function isSharedFacts(store: SeenStore): store is FactSeenStore {
  return store instanceof FactSeenStore;
}
