// ALREADY-HANDLED FACTS, behind one interface (docs/design/cloud-run-2026-10/architecture.md §4).
//
// The desktop and GKE daemons keep these facts in the brain's local harness.db (hostqueue.ts
// durableStore): the disk outlives the process, so a restart reads them back. A Cloud Run machine's
// disk does not outlive a crash, and between drains the work-dir snapshot is the only copy, so on
// Cloud Run (`NM_SUBSTRATE=cloudrun`) the authority moves to Postgres (control-api machine-facts.ts):
// insert-if-absent, one row per (workspace, kind, subject), every write fenced by the epoch.
//
//   FactStore         the async contract: record (insert-if-absent → created?), get, list, release
//   SqliteFactStore   desktop/GKE: harness.db through its SeenStore, keys `${kind}:${subject}`
//   ApiFactStore      Cloud Run: POST/GET /v1/machines/facts with the machine bearer and the epoch
//   FactSeenStore     the SYNC SeenStore the host's guards already read (`DurableSet`: has/add/delete),
//                     over a local cache and the shared store: reads are local, writes go through to
//                     Postgres in order per key, and boot hydrates the cache from Postgres BEFORE the
//                     agent host starts (machined.ts), so a crash between drains forgets nothing.
//
// The guards keep their synchronous shape on purpose: ~15 call sites in agents.ts read them inline,
// and an awaited read there would reorder every watch. The write-through window (a fact recorded
// locally, the process killed before the POST lands) is closed for the cases that matter by the
// drain, which flushes it (`flush`), and by the actions themselves being checked against their own
// truth before they repeat (a merge reads the PR's state first). `claim` is the strict form for a
// caller that can await: the shared insert decides, and only `created: true` may act.
import { EpochFencedError, MachineTokenRejected } from '../cloudrun/snapshot';
import type { SeenOutcome, SeenStore } from './dispatch';

export interface Fact {
  kind: string;
  subject: string;
  payload: Record<string, unknown>;
  createdAt: string;
  createdByMachine: string | null;
  epoch: number;
}

export interface FactStore {
  /** where the fact lives: this machine's disk, or shared by every machine and epoch of the workspace */
  readonly scope: 'local' | 'shared';
  /** insert-if-absent: `created: false` means already handled, so do not act */
  record(kind: string, subject: string, payload?: Record<string, unknown>): Promise<{ created: boolean; fact: Fact }>;
  get(kind: string, subject: string): Promise<Fact | null>;
  /** newest first; `since` bounds a hydration to the local retention window */
  list(kind: string, since?: Date): Promise<Fact[]>;
  /** give a fact back (the attempt failed and may be retried). Only the writer's own fact */
  release(kind: string, subject: string): Promise<boolean>;
}

const KIND = /^[a-z][a-z0-9_-]{0,63}$/;
/** `merged:abc` → {kind: merged, subject: abc}; a key with no valid kind prefix is kind `seen` */
export function splitKey(key: string): { kind: string; subject: string } {
  const i = key.indexOf(':');
  if (i > 0 && KIND.test(key.slice(0, i)) && i < key.length - 1) return { kind: key.slice(0, i), subject: key.slice(i + 1) };
  return { kind: 'seen', subject: key };
}
export const joinKey = (kind: string, subject: string): string => (kind === 'seen' ? subject : `${kind}:${subject}`);

/** The desktop and GKE store: harness.db through its SeenStore (DurableSet's key layout, so the facts
 *  a daemon already wrote read the same). Named for its production backing; any SeenStore works. */
export class SqliteFactStore implements FactStore {
  readonly scope = 'local' as const;
  constructor(private readonly seen: SeenStore, private readonly now: () => number = Date.now) {}
  private fact(kind: string, subject: string): Fact {
    return { kind, subject, payload: {}, createdAt: new Date(this.now()).toISOString(), createdByMachine: null, epoch: 0 };
  }
  async record(kind: string, subject: string): Promise<{ created: boolean; fact: Fact }> {
    const key = joinKey(kind, subject);
    if (this.seen.has(key)) return { created: false, fact: this.fact(kind, subject) };
    this.seen.mark(key, 'done');
    return { created: true, fact: this.fact(kind, subject) };
  }
  async get(kind: string, subject: string): Promise<Fact | null> {
    return this.seen.has(joinKey(kind, subject)) ? this.fact(kind, subject) : null;
  }
  async list(kind: string): Promise<Fact[]> {
    return [...this.seen.snapshot()].map(splitKey).filter((k) => k.kind === kind).map((k) => this.fact(k.kind, k.subject));
  }
  async release(kind: string, subject: string): Promise<boolean> {
    const key = joinKey(kind, subject);
    const had = this.seen.has(key);
    this.seen.clear(key);
    return had;
  }
}

export interface ApiFactStoreOptions {
  apiUrl: string;
  /** the machine bearer, built per call: a Cloud Run token renews (cloudrun/boot.ts) */
  headers: () => Promise<Record<string, string>>;
  /** the epoch this process runs under; every write names it */
  epoch: () => number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Cloud Run: control-api's /v1/machines/facts. 409 → EpochFencedError, 401 → MachineTokenRejected */
export class ApiFactStore implements FactStore {
  readonly scope = 'shared' as const;
  constructor(private readonly o: ApiFactStoreOptions) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const fetchImpl = this.o.fetchImpl ?? fetch;
    const res = await fetchImpl(`${this.o.apiUrl}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(await this.o.headers()) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000),
    });
    if (res.status === 401) throw new MachineTokenRejected(`${method} ${path}: the machine token was refused`);
    if (res.status === 409) {
      const why = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'a newer epoch owns this machine';
      throw new EpochFencedError(`${method} ${path}: ${why}`);
    }
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  record(kind: string, subject: string, payload?: Record<string, unknown>): Promise<{ created: boolean; fact: Fact }> {
    return this.call('POST', '/v1/machines/facts', { epoch: this.o.epoch(), kind, subject, ...(payload ? { payload } : {}) });
  }
  async get(kind: string, subject: string): Promise<Fact | null> {
    const q = new URLSearchParams({ kind, subject });
    return (await this.call<{ fact: Fact | null }>('GET', `/v1/machines/facts?${q}`)).fact;
  }
  async list(kind: string, since?: Date): Promise<Fact[]> {
    const q = new URLSearchParams({ kind, ...(since ? { since: since.toISOString() } : {}) });
    return (await this.call<{ facts: Fact[] }>('GET', `/v1/machines/facts?${q}`)).facts;
  }
  async release(kind: string, subject: string): Promise<boolean> {
    return (await this.call<{ released: boolean }>('POST', '/v1/machines/facts/release', { epoch: this.o.epoch(), kind, subject })).released;
  }
}

export interface FactSeenStoreOptions {
  /** kinds whose subject is about THIS machine (a worktree on its disk): shared under `${machineId}/` */
  machineScoped?: ReadonlySet<string>;
  machineId?: string;
  log?: (line: string) => void;
  /** retries per write before it is logged and left local (the drain flushes what is pending) */
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** The host guards' SeenStore on Cloud Run: local reads, ordered write-through to the shared store. */
export class FactSeenStore implements SeenStore {
  private chains = new Map<string, Promise<void>>();
  private fencedValue = false;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly local: SeenStore, private readonly remote: FactStore, private readonly o: FactSeenStoreOptions = {}) {
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** a newer epoch owns the machine: this process writes nothing more to the shared store */
  get fenced(): boolean { return this.fencedValue; }
  get pending(): number { return this.chains.size; }

  private remoteSubject(kind: string, subject: string): string {
    return this.o.machineScoped?.has(kind) && this.o.machineId ? `${this.o.machineId}/${subject}` : subject;
  }
  private localSubject(kind: string, subject: string): string | null {
    if (!(this.o.machineScoped?.has(kind) && this.o.machineId)) return subject;
    const prefix = `${this.o.machineId}/`;
    return subject.startsWith(prefix) ? subject.slice(prefix.length) : null; // another machine's fact
  }

  has(key: string): boolean { return this.local.has(key); }

  mark(key: string, outcome: SeenOutcome): void {
    this.local.mark(key, outcome);
    const { kind, subject } = splitKey(key);
    this.enqueue(key, () => this.remote.record(kind, this.remoteSubject(kind, subject)).then(() => undefined));
  }

  clear(key: string): void {
    this.local.clear(key);
    const { kind, subject } = splitKey(key);
    this.enqueue(key, () => this.remote.release(kind, this.remoteSubject(kind, subject)).then(() => undefined));
  }

  prune(olderThanMs: number): number { return this.local.prune(olderThanMs); }
  snapshot(): Set<string> { return this.local.snapshot(); }

  /** The strict form, for a caller that can await: the shared insert decides. `true` = act now;
   *  `false` = already handled somewhere (this machine before a crash, another epoch, another machine). */
  async claim(key: string): Promise<boolean> {
    await this.chains.get(key);
    const { kind, subject } = splitKey(key);
    const out = await this.remote.record(kind, this.remoteSubject(kind, subject));
    this.local.mark(key, 'done');
    return out.created;
  }

  /** Pull the shared facts of these kinds into the local cache. Run at boot, before the host reads. */
  async hydrate(kinds: readonly string[], sinceMs = 7 * 86_400_000): Promise<number> {
    let n = 0;
    const since = new Date(Date.now() - sinceMs);
    for (const kind of kinds) {
      for (const f of await this.remote.list(kind, since)) {
        const subject = this.localSubject(kind, f.subject);
        if (subject === null) continue;
        const key = joinKey(kind, subject);
        if (!this.local.has(key)) { this.local.mark(key, 'done'); n += 1; }
      }
    }
    this.o.log?.(`facts: hydrated ${n} shared fact(s) into the local cache (${kinds.join(', ')})`);
    return n;
  }

  /** every write still in flight, bounded: the drain calls this before the snapshot. The bound is a
   *  real timer, never the injected backoff `sleep` (a test's instant sleep would end the flush at once).
   *  Loops until no chain is pending, so a write enqueued while flushing is awaited too. */
  async flush(timeoutMs = 10_000): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const deadline = new Promise<void>((r) => { timer = setTimeout(() => { timedOut = true; r(); }, timeoutMs); timer.unref?.(); });
    try {
      while (this.chains.size > 0 && !timedOut) {
        await Promise.race([Promise.allSettled([...this.chains.values()]), deadline]);
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** writes for one key run in order (an add then a delete must land as a delete) */
  private enqueue(key: string, write: () => Promise<void>): void {
    if (this.fencedValue) return;
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(() => this.withRetry(key, write)).finally(() => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    });
    this.chains.set(key, next);
  }

  private async withRetry(key: string, write: () => Promise<void>): Promise<void> {
    const attempts = this.o.attempts ?? 5;
    for (let i = 1; i <= attempts; i++) {
      if (this.fencedValue) return;
      try {
        await write();
        return;
      } catch (e) {
        if (e instanceof EpochFencedError || e instanceof MachineTokenRejected) {
          this.fencedValue = true;
          this.o.log?.(`facts: shared writes stopped (${e.message.slice(0, 120)})`);
          return;
        }
        if (i === attempts) {
          // the local cache keeps it, and the work-dir snapshot carries the cache: logged, never silent
          this.o.log?.(`facts: ${key} did not reach the shared store after ${attempts} attempts (${e instanceof Error ? e.message.slice(0, 120) : 'error'})`);
          return;
        }
        await this.sleep(Math.min(8_000, 250 * 2 ** i));
      }
    }
  }
}

/**
 * A Set-shaped guard whose membership is ALSO a durable fact — for the guards typed `Set<string>`
 * (hireProposed), so making them durable on Cloud Run changes no call site and no type.
 */
export class DurableStringSet extends Set<string> {
  constructor(private readonly store: SeenStore, private readonly prefix: string) { super(); }
  override has(v: string): boolean { return super.has(v) || this.store.has(`${this.prefix}:${v}`); }
  override add(v: string): this {
    super.add(v);
    this.store.mark(`${this.prefix}:${v}`, 'done');
    return this;
  }
  override delete(v: string): boolean {
    const had = this.has(v);
    super.delete(v);
    this.store.clear(`${this.prefix}:${v}`);
    return had;
  }
}

/**
 * A counter map whose counts are durable — for `wakeGaveUp` (a reply's bounded retries). Each
 * increment is its own fact (`${prefix}:${key}:${n}`), so insert-if-absent is enough: the count is
 * the highest n recorded. `clear` only bounds memory; the durable counts age out with retention.
 */
export class DurableCountMap extends Map<string, number> {
  static readonly MAX = 16;
  constructor(private readonly store: SeenStore, private readonly prefix: string) { super(); }
  override get(k: string): number | undefined {
    const mem = super.get(k);
    if (mem !== undefined) return mem;
    let n = 0;
    while (n < DurableCountMap.MAX && this.store.has(`${this.prefix}:${k}:${n + 1}`)) n += 1;
    return n > 0 ? n : undefined;
  }
  override has(k: string): boolean { return this.get(k) !== undefined; }
  override set(k: string, n: number): this {
    super.set(k, n);
    if (Number.isInteger(n) && n > 0 && n <= DurableCountMap.MAX) this.store.mark(`${this.prefix}:${k}:${n}`, 'done');
    return this;
  }
}
