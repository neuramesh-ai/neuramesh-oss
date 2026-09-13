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
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { TurnKind } from '@neuramesh/shared';
import type { LogFn } from '../agentlog';

export interface HostQueueOpts {
  caps?: Caps;
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
}

export interface TurnRecorder {
  open(work: QueuedWork): void;
  settle(work: QueuedWork, state: 'done' | 'failed', err?: unknown): void;
}

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
  private d: Dispatcher;
  private pending = new Map<string, () => Promise<unknown>>();
  private draining = false;
  private log?: (line: string) => void;
  private turns?: TurnRecorder;
  private meta = new Map<string, QueuedWork>();

  constructor(opts: HostQueueOpts = {}) {
    const caps = opts.caps ?? defaultCaps(cpuCount());
    this.log = opts.log;
    this.turns = opts.turns;
    this.d = new Dispatcher(opts.seen ?? new MemorySeenStore(), caps, {
      onShed: (shed) => opts.onShed?.(shed.map((t) => t.id)),
    });
    this.log?.(`host queue: ${caps.slots} slots, ${caps.perAgent} per agent`);
  }

  /**
   * Offer work. Returns false when the queue refuses it — already queued, already running, or already
   * settled durably. A false is NOT an error: it is the guard doing its job, and the caller should
   * simply not run the flow.
   */
  run(work: QueuedWork, fn: () => Promise<unknown>): boolean {
    const offered = this.d.offer({ id: work.key, kind: work.kind, cause: work.cause, agentId: work.agentId, subject: {} });
    if (!offered) return false;
    this.pending.set(work.key, fn);
    this.meta.set(work.key, work);
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
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const t = this.d.admit();
        if (!t) return;
        const fn = this.pending.get(t.id);
        const work = this.meta.get(t.id);
        this.pending.delete(t.id);
        if (!fn || !work) { this.d.settle(t.id, 'stopped'); this.meta.delete(t.id); continue; }
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
            await fn();
          } catch (err) {
            outcome = 'failed';
            thrown = err;
            this.log?.(`flow ${t.id} threw: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}`);
          } finally {
            // EVERY exit path settles — the accounting mirror of the turn lifecycle's rule. An
            // unsettled key leaks a slot forever, which is a wedged host rather than a lost turn.
            this.d.settle(t.id, outcome);
            try { this.turns?.settle(work, outcome, thrown); } catch { /* see above */ }
            this.meta.delete(t.id);
            void this.drain();
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

function cpuCount(): number {
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
