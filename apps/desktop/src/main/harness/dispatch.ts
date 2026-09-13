// The dispatcher (docs/harness/05) — one admission point for every agent turn.
//
// What it replaces: 25 `db.watch` registrations and 4 `setInterval` timers, each its own reactive
// path, coordinated by five process-local `Set`s (`claimed`, `reviewed`, `merged`, `reclaimed`,
// `markedOnline`). That arrangement has three structural failures — dedupe dies with the process, no
// concurrency ceiling exists (five offers in one sync tick start five runtime CLIs), and a human's
// chat message competes with a watchdog sweep by arrival order.
//
// The design keeps the watches: they stop being FLOWS and become trigger PRODUCERS. Everything that
// decides is pure (`nextTurn`) or durable (`SeenStore`), which is what makes the untestable testable.
//
// Run: pnpm exec tsx --test src/main/harness/dispatch.test.ts
import type { TurnKind } from '@neuramesh/shared';

// ── Triggers ──────────────────────────────────────────────────────────────────────────────────
export type TriggerCause = 'board' | 'message' | 'timer' | 'park' | 'spawn';

export interface Trigger {
  /** the DEDUPE KEY — derived from the cause so the same event cannot be handled twice */
  id: string;
  kind: TurnKind;
  cause: TriggerCause;
  agentId: string;
  /** monotonic arrival order within a process; ties broken by it so admission is deterministic */
  seq: number;
  subject: { workspaceId?: string; channelId?: string; threadId?: string | null; taskId?: string | null };
  payload?: unknown;
}

/**
 * Priority, highest first. This encodes a product judgment that is currently accidental: today a
 * human's message and a stall-watchdog re-offer compete by whichever `db.watch` fired first.
 *
 * 1 human-blocking — a person is waiting on this specific turn
 * 2 board progress — the loop is the product
 * 3 spawned      — a subagent leg; urgent to its parent, but must not starve the board
 * 4 background   — digests, sweeps, watchdog triage, schedules; nothing is waiting
 */
export type Priority = 1 | 2 | 3 | 4;

export function priorityOf(t: Pick<Trigger, 'cause' | 'kind'>): Priority {
  if (t.cause === 'message') return 1; // a human typed it
  if (t.cause === 'park') return 2; // the wait it was parked on has resolved — resume promptly
  if (t.cause === 'spawn') return 3;
  if (t.cause === 'timer' || t.kind === 'sweep') return 4;
  return 2; // board
}

export interface RunningTurn { triggerId: string; agentId: string; kind: TurnKind }

export interface Caps {
  /** total concurrent turns on this machine — a machine resource, not a per-feature constant */
  slots: number;
  /** per-agent ceiling, so one busy agent cannot hold every slot */
  perAgent: number;
}

/**
 * The machine's default slot count.
 *
 * Each CLI runtime is a heavy child process (the Claude native binary alone is ~220 MB), so slots
 * derive from the box rather than from a literal. Two cores are left for the app itself — the
 * renderer must stay at 60fps while agents work, which is the whole point of a ceiling.
 */
export function defaultCaps(cpuCount: number): Caps {
  return { slots: Math.max(1, Math.min(4, cpuCount - 2)), perAgent: 2 };
}

// ── The pure admission decision ───────────────────────────────────────────────────────────────
/**
 * Which trigger to admit next, or null.
 *
 * Pure: no database, no clock, no model. Given a queue, what is running, the caps, and the durable
 * seen-set, the answer is fixed — which is why priority, fairness and dedupe finally have tests.
 *
 * `seen` is the DURABLE set (see SeenStore): a key in it has already been handled by this machine,
 * possibly in a previous process. That is the guard the in-memory `Set`s could never provide.
 */
export function nextTurn(
  queue: readonly Trigger[],
  running: readonly RunningTurn[],
  caps: Caps,
  seen: ReadonlySet<string>,
): Trigger | null {
  if (running.length >= caps.slots) return null;
  const perAgent = new Map<string, number>();
  for (const r of running) perAgent.set(r.agentId, (perAgent.get(r.agentId) ?? 0) + 1);
  const live = new Set(running.map((r) => r.triggerId));

  const eligible = queue.filter(
    (t) => !seen.has(t.id) && !live.has(t.id) && (perAgent.get(t.agentId) ?? 0) < caps.perAgent,
  );
  if (!eligible.length) return null;

  return eligible.reduce((best, t) => {
    const a = priorityOf(t);
    const b = priorityOf(best);
    if (a !== b) return a < b ? t : best;
    return t.seq < best.seq ? t : best; // FIFO within a priority — deterministic, never arrival-racy
  });
}

/**
 * Triggers that must be SHED when the queue outgrows what the machine can drain.
 *
 * Background work is shed; human-blocking and board work never are. Returning the shed list rather
 * than dropping silently is the #1015 lesson — a silent truncation reads as "we handled everything".
 */
export function shedBacklog(queue: readonly Trigger[], maxQueue: number): { keep: Trigger[]; shed: Trigger[] } {
  if (queue.length <= maxQueue) return { keep: [...queue], shed: [] };
  const ordered = [...queue].sort((a, b) => priorityOf(a) - priorityOf(b) || a.seq - b.seq);
  const keep: Trigger[] = [];
  const shed: Trigger[] = [];
  for (const t of ordered) {
    if (keep.length < maxQueue || priorityOf(t) < 4) keep.push(t);
    else shed.push(t);
  }
  return { keep, shed };
}

// ── Dedupe keys: derived from the cause, never invented at the call site ───────────────────────
/**
 * The key set. Each is chosen so the same real-world event produces the same key and a genuinely new
 * one does not — which is what lets the store be durable without wedging legitimate re-work.
 *
 * `review` keys on the submitted SHA rather than the task, so a RE-submission earns a fresh review
 * (the dogfooding bug the in-memory `reviewed` set was added to fix, now durable).
 */
export const triggerKey = {
  offer: (taskId: string, state: string, offeredAgentId: string) => `offer:${taskId}:${state}:${offeredAgentId}`,
  wake: (messageId: string, agentId: string) => `wake:${messageId}:${agentId}`,
  review: (taskId: string, submittedSha: string) => `review:${taskId}:${submittedSha}`,
  ship: (taskId: string, prNumber: number) => `ship:${taskId}:${prNumber}`,
  merge: (taskId: string) => `merge:${taskId}`,
  reclaim: (taskNumber: number) => `reclaim:${taskNumber}`,
  /** floored so a 15-minute sweep cannot fire twice inside its own window on clock jitter */
  sweep: (kind: string, nowMs: number, everyMs: number) => `sweep:${kind}:${Math.floor(nowMs / everyMs)}`,
  park: (parkId: string) => `park:${parkId}`,
  spawn: (parentTurnId: string, index: number) => `spawn:${parentTurnId}:${index}`,
};

// ── The durable seen-set ──────────────────────────────────────────────────────────────────────
export type SeenOutcome = 'done' | 'failed' | 'stopped';

/**
 * A minimal key/value store interface so the dispatcher can be tested against memory and run against
 * SQLite. The daemon backs this with `harness.db` in the brain (docs/harness/01 §3.2).
 */
export interface SeenStore {
  has(key: string): boolean;
  mark(key: string, outcome: SeenOutcome): void;
  /** release a key so its trigger may fire again — the request_changes bounce, re-armed deliberately */
  clear(key: string): void;
  /** drop keys older than the retention window; a board row that old cannot legitimately re-fire */
  prune(olderThanMs: number): number;
  snapshot(): Set<string>;
}

/** In-memory implementation — the test double, and the fail-open fallback if SQLite is unwritable. */
export class MemorySeenStore implements SeenStore {
  private rows = new Map<string, { at: number; outcome: SeenOutcome }>();
  constructor(private now: () => number = () => Date.now()) {}
  has(key: string): boolean { return this.rows.has(key); }
  mark(key: string, outcome: SeenOutcome): void { this.rows.set(key, { at: this.now(), outcome }); }
  clear(key: string): void { this.rows.delete(key); }
  prune(olderThanMs: number): number {
    const cutoff = this.now() - olderThanMs;
    let n = 0;
    for (const [k, v] of this.rows) if (v.at < cutoff) { this.rows.delete(k); n += 1; }
    return n;
  }
  snapshot(): Set<string> { return new Set(this.rows.keys()); }
}

/**
 * SQLite-backed store — survives a restart, which is the entire point.
 *
 * The two failures this fixes are both paid-for history: the wake-vs-sweep double-triage race
 * (v0.32.1) and the cross-process duplicate wake reply (v0.20.2). Both were "fixed" once with an
 * in-memory guard, and both came back, because a `Set` is blind across processes and machines.
 *
 * It COMPLEMENTS, never replaces, the server's guarantees: the atomic claim and the 0060 partial
 * unique reply index remain cross-machine truth. This stops ONE machine doing the same work twice.
 */
export class SqliteSeenStore implements SeenStore {
  private db: import('better-sqlite3').Database;
  constructor(dbPath: string, private now: () => number = () => Date.now()) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`create table if not exists seen (
      key text primary key, at integer not null, outcome text not null
    ); create index if not exists seen_at on seen (at);`);
  }
  has(key: string): boolean {
    return !!this.db.prepare('select 1 from seen where key = ?').get(key);
  }
  mark(key: string, outcome: SeenOutcome): void {
    this.db.prepare('insert into seen (key, at, outcome) values (?,?,?) on conflict(key) do update set at = excluded.at, outcome = excluded.outcome')
      .run(key, this.now(), outcome);
  }
  clear(key: string): void { this.db.prepare('delete from seen where key = ?').run(key); }
  prune(olderThanMs: number): number {
    return this.db.prepare('delete from seen where at < ?').run(this.now() - olderThanMs).changes;
  }
  snapshot(): Set<string> {
    return new Set((this.db.prepare('select key from seen').all() as Array<{ key: string }>).map((r) => r.key));
  }
  close(): void { try { this.db.close(); } catch { /* already closed */ } }
}

// ── The queue ─────────────────────────────────────────────────────────────────────────────────
/**
 * The admission loop's state. Deliberately NOT the executor: `Dispatcher` decides and accounts, the
 * caller runs the turn. That split is what keeps admission pure enough to test and means a turn's
 * failure can never corrupt the queue.
 */
export class Dispatcher {
  private queue = new Map<string, Trigger>();
  private running = new Map<string, RunningTurn>();
  private seq = 0;
  private shedCount = 0;

  constructor(
    private seen: SeenStore,
    private caps: Caps,
    private opts: { maxQueue?: number; onShed?: (shed: Trigger[]) => void } = {},
  ) {}

  /** Offer a trigger. Returns false when it was rejected as already-handled or already-queued. */
  offer(t: Omit<Trigger, 'seq'>): boolean {
    if (this.seen.has(t.id) || this.queue.has(t.id) || this.running.has(t.id)) return false;
    this.queue.set(t.id, { ...t, seq: this.seq++ });
    const max = this.opts.maxQueue ?? 512;
    if (this.queue.size > max) {
      const { keep, shed } = shedBacklog([...this.queue.values()], max);
      if (shed.length) {
        this.queue = new Map(keep.map((k) => [k.id, k]));
        this.shedCount += shed.length;
        this.opts.onShed?.(shed); // named, never silent
      }
    }
    return true;
  }

  /** Admit the next turn, or null when nothing is eligible. */
  admit(): Trigger | null {
    const t = nextTurn([...this.queue.values()], [...this.running.values()], this.caps, this.seen.snapshot());
    if (!t) return null;
    this.queue.delete(t.id);
    this.running.set(t.id, { triggerId: t.id, agentId: t.agentId, kind: t.kind });
    return t;
  }

  /** Every admitted turn must land here — the accounting mirror of the lifecycle's `finally`. */
  settle(triggerId: string, outcome: SeenOutcome): void {
    this.running.delete(triggerId);
    this.seen.mark(triggerId, outcome);
  }

  /** Re-arm a trigger deliberately (a review bounce, a park wake) so it may fire again. */
  rearm(triggerId: string): void {
    this.seen.clear(triggerId);
  }

  stats(): { queued: number; running: number; shed: number; slots: number } {
    return { queued: this.queue.size, running: this.running.size, shed: this.shedCount, slots: this.caps.slots };
  }

  /** Recover after a crash: nothing this process owns can still be running. */
  resetRunning(): RunningTurn[] {
    const orphans = [...this.running.values()];
    this.running.clear();
    return orphans;
  }
}
