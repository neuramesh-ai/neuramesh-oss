// WAKING A WAITING LONG-POLL (design §10.2, gate A1). GET /v1/sync/changes?wait=N holds a request
// that has nothing newer until a write lands in one of its workspaces. Postgres says so: every commit
// that records a change NOTIFYs channel nm_sync with the workspace id (migration 0159). This is the
// in-process half: ONE listener per nm-api instance, fanned out to the waiting requests.
//
// Why LISTEN/NOTIFY, and not the Firestore hint document the design also names: every waiter is a
// request to nm-api, and nm-api already holds a Postgres connection. One more connection per
// instance carries every workspace's wake, with no second store, no Firebase token, and no security
// rules to keep in step with membership. A hint document earns its place when clients wake WITHOUT a
// request open (a phone in the background, a browser tab that a proxy would cut). Until then it is
// cost and moving parts for the same signal.
//
// BOUNDED. The waiters are counted and capped (NM_SYNC_MAX_WAITERS): over the cap a request answers at
// once with a retry hint, so long-polls can never take every request slot of the instance. Each wait
// has a deadline. The listener's health is checked with a ping through Postgres. While it is not
// known to be live (starting, reconnecting), a wait is cut short, so a lost NOTIFY costs at most a
// short-poll's delay, never a 25 s stall. On every (re)listen all waiters wake, and re-read.

/** how a hub hears Postgres: listen once, and send a ping through the same channel */
export interface SyncWakeSource {
  listen(onNotify: (payload: string) => void, onListen: () => void): Promise<void>;
  ping(payload: string): Promise<void>;
}

export type WakeOutcome = 'woken' | 'timeout' | 'aborted';

export interface WakeTicket {
  /** resolves at the first wake after subscribe (even one that came before this call), the deadline, or the abort */
  wait(ms: number, signal?: AbortSignal): Promise<WakeOutcome>;
  /** always call it: it gives the slot back */
  cancel(): void;
}

interface Waiter { woken: boolean; done?: (outcome: WakeOutcome) => void }

export interface SyncWakeOptions {
  maxWaiters: number;
  source?: SyncWakeSource;
  /** how often the listener proves itself, 30 s by default */
  pingMs?: number;
  /** how long a ping may take before the listener counts as down, 5 s by default */
  pongMs?: number;
  timers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
  log?: (line: string) => void;
  now?: () => number;
}

const realTimers = {
  set: (fn: () => void, ms: number): unknown => {
    const handle = setTimeout(fn, ms);
    (handle as unknown as { unref?: () => void }).unref?.();
    return handle;
  },
  clear: (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class SyncWake {
  private readonly byWorkspace = new Map<string, Set<Waiter>>();
  private readonly all = new Set<Waiter>();
  private readonly timers: NonNullable<SyncWakeOptions['timers']>;
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private started = false;
  private live = false;
  private pending?: { nonce: string; at: number };
  private nonce = 0;
  private readonly id = Math.random().toString(36).slice(2, 10);

  constructor(private readonly options: SyncWakeOptions) {
    this.timers = options.timers ?? realTimers;
    this.log = options.log ?? ((line) => console.log(line));
    this.now = options.now ?? Date.now;
  }

  /** the listener is known to be live: a ping went round, or it has just (re)listened */
  get healthy(): boolean { return this.live; }
  get waiting(): number { return this.all.size; }
  get capacity(): number { return this.options.maxWaiters; }

  /** idempotent. Starts the listener and its health ping; until both work, `healthy` is false */
  start(): void {
    if (this.started || !this.options.source) return;
    this.started = true;
    const source = this.options.source;
    source.listen((payload) => this.notify(payload), () => {
      // a fresh LISTEN: anything committed while it was down was not heard, so every waiter re-reads
      this.live = true;
      this.wakeAll();
    }).catch((e: unknown) => {
      this.started = false;
      this.live = false;
      this.log(`sync_wake listen failed: ${e instanceof Error ? e.message : String(e)}`);
    });
    const tick = (): void => {
      this.check();
      this.ping();
      this.timers.set(tick, this.options.pingMs ?? 30_000);
    };
    this.timers.set(tick, this.options.pingMs ?? 30_000);
  }

  /** a slot for these workspaces, or null when the cap is reached */
  subscribe(workspaces: readonly string[]): WakeTicket | null {
    if (this.all.size >= this.options.maxWaiters) return null;
    const waiter: Waiter = { woken: false };
    this.all.add(waiter);
    for (const ws of workspaces) {
      let set = this.byWorkspace.get(ws);
      if (!set) this.byWorkspace.set(ws, (set = new Set()));
      set.add(waiter);
    }
    const cancel = (): void => {
      if (!this.all.delete(waiter)) return;
      for (const ws of workspaces) {
        const set = this.byWorkspace.get(ws);
        set?.delete(waiter);
        if (set && !set.size) this.byWorkspace.delete(ws);
      }
      waiter.done?.('aborted');
    };
    return {
      cancel,
      wait: (ms, signal) => new Promise<WakeOutcome>((resolve) => {
        if (waiter.woken) return resolve('woken');
        if (signal?.aborted) return resolve('aborted');
        let timer: unknown;
        const finish = (outcome: WakeOutcome): void => {
          if (!waiter.done) return;
          waiter.done = undefined;
          this.timers.clear(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve(outcome);
        };
        const onAbort = (): void => finish('aborted');
        waiter.done = finish;
        timer = this.timers.set(() => finish('timeout'), ms);
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
    };
  }

  /** a NOTIFY payload: a workspace id, or this hub's own ping */
  notify(payload: string): void {
    if (payload.startsWith('ping:')) {
      if (this.pending && payload === `ping:${this.id}:${this.pending.nonce}`) {
        this.pending = undefined;
        if (!this.live) this.log('sync_wake listener live again');
        this.live = true;
      }
      return;
    }
    const set = this.byWorkspace.get(payload);
    if (!set) return;
    for (const waiter of set) this.wake(waiter);
  }

  wakeAll(): void {
    for (const waiter of this.all) this.wake(waiter);
  }

  private wake(waiter: Waiter): void {
    waiter.woken = true;
    waiter.done?.('woken');
  }

  /** a ping that has not come back in pongMs means the listener is not hearing Postgres */
  private check(): void {
    if (this.pending && this.now() - this.pending.at > (this.options.pongMs ?? 5_000)) {
      if (this.live) this.log('sync_wake listener missed its ping: waits are cut short until it answers');
      this.live = false;
      this.pending = undefined;
      this.wakeAll();
    }
  }

  private ping(): void {
    if (this.pending) return;
    const nonce = String(++this.nonce);
    this.pending = { nonce, at: this.now() };
    this.options.source?.ping(`ping:${this.id}:${nonce}`).catch(() => {});
    // the answer is checked at the next tick, or sooner by the short check below
    this.timers.set(() => this.check(), (this.options.pongMs ?? 5_000) + 100);
  }
}
