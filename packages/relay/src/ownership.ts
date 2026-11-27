import { randomUUID } from 'node:crypto';

export interface RelayLease { held: boolean; holder: string; ttlMs: number; generation: number }
export interface RelayLeaseApi {
  take(holder: string): Promise<RelayLease>;
  release(holder: string): Promise<unknown>;
}
export function relayLeaseApi(apiUrl: string, secret: string, shard: number): RelayLeaseApi {
  const post = async (path: string, holder: string) => {
    const response = await fetch(new URL(path, apiUrl), {
      method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ shard, holder }), signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`Relay lease unavailable (${response.status})`);
    return response.json();
  };
  return { take: async holder => await post('/internal/relay/lease', holder) as RelayLease, release: holder => post('/internal/relay/lease/release', holder) };
}

/** One process owns each shard. No RPC runs while the service has no sockets.
 * A monotonic deadline fences every admission/frame even after an event-loop pause.
 * Network actions serialize; a late renewal cannot revive a released or stopped owner. */
export class RelayOwnership {
  private readonly holder = randomUUID();
  private deadline = 0;
  private epoch = 0;
  private stopped = false;
  private tail: Promise<unknown> = Promise.resolve();
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  constructor(private readonly api: RelayLeaseApi, private readonly active: () => boolean,
    private readonly lost: () => void, private readonly now: () => number = () => performance.now(),
    heartbeatMs = 10_000) {
    this.heartbeat = setInterval(() => { if (this.active() && !this.stopped) void this.take(true); }, heartbeatMs);
    this.heartbeat.unref?.();
  }
  canServe(): boolean { return !this.stopped && this.deadline > this.now(); }
  ensure(): Promise<boolean> { return this.take(false); }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action, action); this.tail = next.catch(() => {}); return next;
  }
  private invalidate(notify: boolean): void {
    const wasHeld = this.deadline > 0;
    this.deadline = 0; this.epoch++;
    clearTimeout(this.expiry); this.expiry = undefined;
    if (notify && wasHeld) this.lost();
  }
  private take(renew: boolean): Promise<boolean> {
    const epoch = this.epoch;
    return this.serialize(async () => {
      if (this.stopped || epoch !== this.epoch) return false;
      if (!renew && this.canServe()) return true;
      const started = this.now();
      try {
        const answer = await this.api.take(this.holder);
        if (this.stopped || epoch !== this.epoch) return false;
        // The server returns a duration, never a timestamp to compare across clocks.
        // Count it from before the RPC and reserve one second for delayed delivery.
        const deadline = started + Math.min(answer.ttlMs, 30_000) - 1000;
        if (answer.held !== true || answer.holder !== this.holder || !Number.isFinite(answer.ttlMs) || !Number.isFinite(deadline) || deadline <= this.now()) {
          this.invalidate(true); return false;
        }
        this.deadline = deadline;
        clearTimeout(this.expiry);
        this.expiry = setTimeout(() => this.invalidate(true), Math.max(0, deadline - this.now()));
        this.expiry.unref?.();
        return true;
      } catch { if (epoch === this.epoch) this.invalidate(true); return false; }
    });
  }
  release(): Promise<void> {
    this.invalidate(false);
    return this.serialize(async () => { await this.api.release(this.holder).catch(() => {}); });
  }
  async stop(): Promise<void> {
    this.stopped = true; clearInterval(this.heartbeat); this.invalidate(true);
    await this.release();
  }
}
