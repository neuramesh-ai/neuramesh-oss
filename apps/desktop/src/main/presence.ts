// Agent presence: the durable status pump + bounded reply-post retry.
//
// The typing/working chip every client renders is the synced `agents.status`
// column. Daemon flows set a busy status at run start and clear it in a
// `finally` — but a write used to be one fire-and-forget POST, so a single
// dropped clear (server blip, deploy, 500) wedged "typing" until the next app
// relaunch while the machine kept heartbeating. The pump makes a status write
// a promise the daemon keeps: per-agent, last-write-wins, retried with capped
// backoff until the server acks it or a newer status supersedes it. Pure
// logic — I/O and timers are injected so the policy is testable.

export type AgentStatus = 'online' | 'offline' | 'thinking' | 'working';

// exponential backoff with a ceiling; the exponent is clamped so 2**n can't overflow
export function backoffDelayMs(attempt: number, base = 1_000, cap = 60_000): number {
  return Math.min(base * 2 ** Math.min(attempt, 20), cap);
}

// retry only what retrying can fix: server errors, rate limits, and network
// failures. Other 4xx are real rejections — the request itself is wrong.
export function isRetryable(httpStatus: number | null): boolean {
  return httpStatus === null || httpStatus === 429 || httpStatus >= 500;
}

const unrefTimeout = (fn: () => void, ms: number): void => {
  const t = setTimeout(fn, ms);
  (t as { unref?: () => void }).unref?.(); // never keep the process alive for a retry
};

export interface StatusPumpOpts {
  post: (agentId: string, status: AgentStatus) => Promise<number>; // resolves the HTTP status; throws on network error
  baseDelayMs?: number;
  capDelayMs?: number;
  onRetry?: (agentId: string, status: AgentStatus, attempt: number, delayMs: number) => void;
  schedule?: (fn: () => void, ms: number) => void; // injectable timer for tests
}

export interface StatusPump {
  set(agentId: string, status: AgentStatus): void;
  pending(agentId: string): AgentStatus | undefined; // the not-yet-acked desired status, if any
}

export function createStatusPump(opts: StatusPumpOpts): StatusPump {
  const base = opts.baseDelayMs ?? 1_000;
  const cap = opts.capDelayMs ?? 60_000;
  const schedule = opts.schedule ?? unrefTimeout;
  // one desired row per agent; gen strictly increases so a stale in-flight
  // attempt can never ack — or drop — a newer desire
  const desired = new Map<string, { status: AgentStatus; gen: number }>();
  const pumping = new Set<string>(); // agents with a live post/backoff cycle (one in flight each)
  let gen = 0;

  const settle = (agentId: string, mine: number, httpStatus: number | null, attempt: number): void => {
    const now = desired.get(agentId);
    if (!now) { pumping.delete(agentId); return; }
    if (now.gen !== mine) { run(agentId, 0); return; } // superseded while in flight → push the newer status, fresh backoff
    if (httpStatus !== null && !isRetryable(httpStatus)) {
      // acked (2xx) or a real rejection (e.g. unknown agent) — either way, done
      desired.delete(agentId);
      pumping.delete(agentId);
      return;
    }
    const delay = backoffDelayMs(attempt, base, cap);
    opts.onRetry?.(agentId, now.status, attempt + 1, delay);
    schedule(() => run(agentId, attempt + 1), delay);
  };

  const run = (agentId: string, attempt: number): void => {
    const want = desired.get(agentId);
    if (!want) { pumping.delete(agentId); return; }
    const mine = want.gen;
    opts.post(agentId, want.status).then(
      (http) => settle(agentId, mine, http, attempt),
      () => settle(agentId, mine, null, attempt), // network error → retry
    );
  };

  return {
    set(agentId, status) {
      desired.set(agentId, { status, gen: ++gen });
      if (!pumping.has(agentId)) {
        pumping.add(agentId);
        run(agentId, 0);
      }
    },
    pending: (agentId) => desired.get(agentId)?.status,
  };
}

// ── Reply posts ───────────────────────────────────────────────────────────────
// A wake reply is minutes of generated work — one transient 5xx must not discard
// it. Bounded retry (the status pump above is the open-ended one): 409 is the
// exactly-once reply index (0060) saying an attempt already landed — stand down,
// never retry; other 4xx are real rejections; 5xx/429/network back off and retry.

export type ReplyOutcome = 'ok' | 'conflict' | 'rejected' | 'gave_up';

export interface ReplyRetryOpts {
  attempts?: number;
  baseDelayMs?: number;
  capDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, delayMs: number, why: string) => void;
}

export async function postWithRetry(
  send: () => Promise<number>,
  o: ReplyRetryOpts = {},
): Promise<{ outcome: ReplyOutcome; httpStatus: number | null; tries: number }> {
  const attempts = o.attempts ?? 6;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => unrefTimeout(r, ms)));
  let last: number | null = null;
  for (let i = 0; i < attempts; i++) {
    let why: string;
    try {
      const http = await send();
      last = http;
      if (http >= 200 && http < 300) return { outcome: 'ok', httpStatus: http, tries: i + 1 };
      if (http === 409) return { outcome: 'conflict', httpStatus: http, tries: i + 1 };
      if (!isRetryable(http)) return { outcome: 'rejected', httpStatus: http, tries: i + 1 };
      why = `http ${http}`;
    } catch {
      last = null;
      why = 'network error';
    }
    if (i < attempts - 1) {
      const delay = backoffDelayMs(i, o.baseDelayMs ?? 1_500, o.capDelayMs ?? 20_000);
      o.onRetry?.(i + 1, delay, why);
      await sleep(delay);
    }
  }
  return { outcome: 'gave_up', httpStatus: last, tries: attempts };
}
