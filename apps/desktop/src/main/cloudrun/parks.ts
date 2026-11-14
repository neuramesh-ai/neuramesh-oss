// DURABLE PARKS on the machine side (docs/design/cloud-run-2026-10/architecture.md §6.3, control-api
// machine-parks.ts). Cloud Run only: machined installs a registry with `useParks` when
// NM_SUBSTRATE=cloudrun, and every wait below falls back to today's in-memory behaviour when none is
// installed, so the desktop and GKE daemons are unchanged.
//
// WHAT CHANGES. A turn that needs a human's approval used to hold the machine in memory for up to
// 10 minutes and then deny; a Code session's approval died with its tab. Here the wait becomes a park
// row in Postgres: the card is posted exactly as before, the turn waits a SHORT hot window in memory
// (a person who is looking answers within it, and nothing else changes), and then the turn ENDS as
// parked — the machine goes idle and may drain and sleep. When the person answers, control-api
// resolves the park and wakes the machine through the message path's wake.
//
// THE CHECKPOINT the turn resumes from is the one each lane already keeps: a board task stays
// `in_progress` with its worktree in the work dir (snapshotted at every drain) and the resume watch
// re-admits it at boot or on the park's answer (host/park.ts); a chat thread resumes on the person's
// next message (the reply-line answer is one); a Code session reloads its runtime checkpoint when the
// tab reopens (engineering-channel.ts). The RESOLUTION is applied when the resumed turn re-issues the
// same call: the gate finds the park under the same key and allows or denies it without asking again.
//
// THE FENCE. A booted epoch claims resolved parks (`resumeResolved`, at boot and on the lifecycle's
// loop); a claim names the epoch, and one whose epoch died before `done` is claimable again, so a
// crash never strands a resolution and a replaced instance never consumes one.
import { createHash } from 'node:crypto';
import { EpochFencedError, MachineTokenRejected } from './snapshot';

/** a park that expires within this counts as work: the machine stays up to apply the expiry (§5) */
export const PARK_BUSY_WINDOW_MS = 5 * 60_000;
/** how long a park waits for its human before it resolves as a timeout denial */
export const DEFAULT_PARK_TTL_MS = 24 * 3_600_000;
/** how long a turn holds the machine for an answer before it parks (a person looking answers in it) */
export const DEFAULT_HOT_WAIT_MS = 2 * 60_000;

/** the reason a parked gate hands the agent: stop, and the resumed turn applies the answer */
export const PARKED_REASON = 'parked: a human has not answered the approval card yet, so nothing ran. End your turn now, without retrying or working around this. '
  + 'Your work resumes when they answer, and re-issuing this exact call then applies their answer without asking again.';

export type ParkStatus = 'open' | 'resolved' | 'expired' | 'claimed' | 'done';
export interface ParkResolution { answer: string | null; approved: boolean; reason?: string; source?: string }
export interface Park {
  id: string;
  key: string;
  kind: 'approval' | 'question' | 'timer';
  status: ParkStatus;
  resolution: ParkResolution | null;
  expiresAt: string;
  messageId: string | null;
  question: string | null;
  taskId: string | null;
  threadId: string | null;
  request: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  claimedEpoch: number | null;
}
export interface ParkCreate {
  key: string;
  kind: Park['kind'];
  threadId?: string | null;
  taskId?: string | null;
  turnId?: string | null;
  messageId?: string | null;
  question?: string | null;
  request: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  wakeCondition: Record<string, unknown>;
  ttlMs?: number;
}

/** control-api's machine park routes */
export interface ParkApi {
  create(p: ParkCreate): Promise<{ created: boolean; park: Park }>;
  byKey(key: string): Promise<Park | null>;
  claimable(): Promise<Park[]>;
  open(): Promise<Park[]>;
  claim(id: string): Promise<Park>;
  done(id: string, resolution?: ParkResolution): Promise<Park>;
  resolve(id: string, resolution: ParkResolution): Promise<Park>;
}

export function apiParks(o: { apiUrl: string; headers: () => Promise<Record<string, string>>; epoch: () => number; fetchImpl?: typeof fetch }): ParkApi {
  const call = async <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
    const res = await (o.fetchImpl ?? fetch)(`${o.apiUrl}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(await o.headers()) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) throw new MachineTokenRejected(`${method} ${path}: the machine token was refused`);
    const out = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
    if (res.status === 409 && out.code === 'STALE_EPOCH') throw new EpochFencedError(`${method} ${path}: ${out.error ?? 'a newer epoch owns this machine'}`);
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}${out.code ? ` ${out.code}` : ''}`);
    return out;
  };
  const epoch = () => o.epoch();
  return {
    create: (p) => call<{ created: boolean; park: Park }>('POST', '/v1/machines/parks', { ...p, epoch: epoch() }),
    byKey: async (key) => (await call<{ park: Park | null }>('GET', `/v1/machines/parks?key=${encodeURIComponent(key)}`)).park,
    claimable: async () => (await call<{ parks: Park[] }>('GET', '/v1/machines/parks?status=resolved')).parks,
    open: async () => (await call<{ parks: Park[] }>('GET', '/v1/machines/parks?status=open')).parks,
    claim: async (id) => (await call<{ park: Park }>('POST', `/v1/machines/parks/${id}/claim`, { epoch: epoch() })).park,
    done: async (id, resolution) => (await call<{ park: Park }>('POST', `/v1/machines/parks/${id}/done`, { epoch: epoch(), ...(resolution ? { resolution } : {}) })).park,
    resolve: async (id, resolution) => (await call<{ park: Park }>('POST', `/v1/machines/parks/${id}/resolve`, { epoch: epoch(), resolution })).park,
  };
}

/** the key of a room-agent approval: where it is asked plus the exact question (which carries the
 *  inline command), so the same ask re-issued after a resume finds its park */
export function approvalKey(where: { taskId: string } | { threadId: string }, question: string): string {
  const scope = 'taskId' in where ? `task:${where.taskId}` : `thread:${where.threadId}`;
  return `approval:${scope}:${digest(question)}`;
}
/** the key of a Code-session approval: the thread, the tool, and its exact input */
export function codeApprovalKey(threadId: string, toolName: string, input: unknown): string {
  return `code:${threadId}:${toolName}:${digest(stableJson(input))}`;
}
const digest = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 32);
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

export type PriorPark = { park: Park; resolution: ParkResolution } | { park: Park; open: true };
export type ResumeHandler = (park: Park) => void | Promise<void>;

export interface ParkRegistryOptions {
  api: ParkApi;
  ttlMs?: number;
  hotWaitMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}

export class ParkRegistry {
  readonly ttlMs: number;
  readonly hotWaitMs: number;
  private readonly claimed = new Map<string, Park>();
  private readonly openParks = new Map<string, Park>();
  private readonly handlers = new Set<ResumeHandler>();
  private drainingValue = false;
  private polling: Promise<number> | null = null;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly o: ParkRegistryOptions) {
    this.ttlMs = o.ttlMs ?? DEFAULT_PARK_TTL_MS;
    this.hotWaitMs = o.hotWaitMs ?? DEFAULT_HOT_WAIT_MS;
    this.now = o.now ?? Date.now;
    this.log = o.log ?? ((line) => console.log(`[parks] ${line}`));
  }

  /** the drain began: every hot wait ends now and parks (lifecycle parkTurns → machined) */
  beginDrain(): void { this.drainingValue = true; }
  get draining(): boolean { return this.drainingValue; }

  /** called with every park this epoch claims, after it is cached (a lane may re-admit its turn) */
  onResume(h: ResumeHandler): () => void { this.handlers.add(h); return () => this.handlers.delete(h); }

  /** THE BUSY RULE (§5): an open park that expires within 5 minutes holds the machine awake, so its
   *  timeout is applied by this instance rather than by a wake a few minutes after a sleep */
  busySoon(now = this.now()): boolean {
    for (const p of this.openParks.values()) if (Date.parse(p.expiresAt) - now <= PARK_BUSY_WINDOW_MS) return true;
    return false;
  }
  get openCount(): number { return this.openParks.size; }

  /** re-read the open parks (boot: the ones a previous epoch left, which the busy rule must count) */
  async refreshOpen(): Promise<void> {
    const parks = await this.o.api.open();
    this.openParks.clear();
    for (const p of parks) this.openParks.set(p.key, p);
  }

  /** claim every resolved park for this epoch and hand each to the resume handlers. Boot calls it
   *  before the agent host starts; the lifecycle loop calls it while awake. One pass at a time */
  resumeResolved(): Promise<number> {
    if (this.polling) return this.polling;
    this.polling = this.claimAll().finally(() => { this.polling = null; });
    return this.polling;
  }

  private async claimAll(): Promise<number> {
    let n = 0;
    for (const p of await this.o.api.claimable()) {
      try {
        const park = await this.o.api.claim(p.id);
        this.take(park);
        n += 1;
      } catch (e) {
        if (e instanceof EpochFencedError || e instanceof MachineTokenRejected) throw e;
        this.log(`claim ${p.id} failed: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`);
      }
    }
    if (n) this.log(`claimed ${n} resolved park(s)`);
    return n;
  }

  private take(park: Park): void {
    this.claimed.set(park.key, park);
    this.openParks.delete(park.key);
    for (const h of this.handlers) {
      void Promise.resolve().then(() => h(park)).catch((e: unknown) => this.log(`resume ${park.id} failed: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`));
    }
  }

  /** The gate's lookup. A resolution this epoch holds, or one the server has under the key (claimed
   *  here, so no other epoch applies it too); an open park to keep waiting on; or nothing. */
  async prior(key: string): Promise<PriorPark | null> {
    const held = this.claimed.get(key);
    if (held?.resolution) return { park: held, resolution: held.resolution };
    const park = await this.o.api.byKey(key);
    if (!park) { this.openParks.delete(key); return null; }
    if (park.status === 'open') { this.openParks.set(key, park); return { park, open: true }; }
    // resolved, expired, or claimed: the claim is idempotent for this epoch and takes over a dead one's
    const mine = await this.o.api.claim(park.id);
    this.claimed.set(key, mine);
    this.openParks.delete(key);
    return mine.resolution ? { park: mine, resolution: mine.resolution } : null;
  }

  async park(p: Omit<ParkCreate, 'ttlMs'> & { ttlMs?: number }): Promise<Park> {
    const out = await this.o.api.create({ ...p, ttlMs: p.ttlMs ?? this.ttlMs });
    this.openParks.set(out.park.key, out.park);
    if (out.created) this.log(`parked ${out.park.kind} ${out.park.id} until ${out.park.expiresAt}`);
    return out.park;
  }

  /** the resumed turn applied it (or the machine saw the answer itself): the park is done */
  async consume(park: Park, resolution?: ParkResolution): Promise<void> {
    this.claimed.delete(park.key);
    this.openParks.delete(park.key);
    await this.o.api.done(park.id, resolution);
  }

  /** the park this epoch claimed under the key and has not consumed yet, or null */
  held(key: string): Park | null { return this.claimed.get(key) ?? null; }

  /** the open parks this registry knows (boot's read, plus the ones parked since), newest first */
  openList(): Park[] { return [...this.openParks.values()].sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt)); }

  /** has this epoch claimed a resolution for the card with this message id? (host/park.ts re-admits
   *  a parked task on it, for answers that flip no decision row: the human route, an expiry) */
  answered(messageId: string): boolean {
    for (const p of this.claimed.values()) if (p.messageId === messageId && p.resolution) return true;
    return false;
  }

  /** the machine relays an answer the person gave in its own session; the re-issued call applies it */
  async relay(park: Park, resolution: ParkResolution): Promise<void> {
    const out = await this.o.api.resolve(park.id, resolution);
    this.openParks.delete(park.key);
    this.log(`relayed ${out.id} (${resolution.approved ? 'approved' : 'denied'})`);
  }
}

/** NM_PARK_TTL_MS (default 24 h) and NM_PARK_HOT_MS (default 2 min), each bounded */
export function parkConfigOf(env: Record<string, string | undefined>): { ttlMs: number; hotWaitMs: number } {
  const ms = (name: string, fallback: number, min: number, max: number): number => {
    const n = Number(env[name] ?? fallback);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
  };
  return { ttlMs: ms('NM_PARK_TTL_MS', DEFAULT_PARK_TTL_MS, 60_000, 7 * 86_400_000), hotWaitMs: ms('NM_PARK_HOT_MS', DEFAULT_HOT_WAIT_MS, 0, 10 * 60_000) };
}

let installed: ParkRegistry | null = null;
/** machined installs the registry on Cloud Run; null everywhere else (every caller falls back) */
export function useParks(r: ParkRegistry | null): void { installed = r; }
export function parks(): ParkRegistry | null { return installed; }

/** an approval's outcome, in the PermissionGate's shape (runtime/adapter.ts) */
export type ApprovalOutcome = { decision: 'allow' } | { decision: 'deny'; reason: string };
export function outcomeOf(res: ParkResolution): ApprovalOutcome {
  if (res.approved) return { decision: 'allow' };
  return { decision: 'deny', reason: res.reason === 'timeout' ? 'approval timed out — denied' : 'a human denied this action' };
}

export interface DurableApprovalAsk {
  key: string;
  question: string;
  taskId?: string | null;
  threadId?: string | null;
  turnId?: string | null;
  request: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  /** post the card (exactly as today); its message id, or null when it could not be posted */
  postCard: () => Promise<string | null>;
  /** wait for the card's answer (agents.ts awaitDecision); null = not answered within `ms` */
  awaitAnswer: (messageId: string, ms: number, stop: () => boolean) => Promise<string | null>;
  /** the turn is parking: the lane records it (a board task's run settles `parked`, no submit) */
  onParked?: (park: Park, messageId: string) => void;
}

/**
 * A room-agent approval through a durable park. The order matters:
 *   1. a resolution already exists under the key (the resumed turn re-issued the call) → apply it
 *   2. an open park exists → wait on ITS card (no second card)
 *   3. otherwise post the card and park
 * then wait the hot window; an answer in it finishes the park, and no answer ends the turn as parked.
 */
export async function durableApproval(reg: ParkRegistry, ask: DurableApprovalAsk): Promise<ApprovalOutcome> {
  let prior: PriorPark | null = null;
  try {
    prior = await reg.prior(ask.key);
  } catch (e) {
    // a newer instance owns this machine: it acts on the card, this one must not
    if (e instanceof EpochFencedError || e instanceof MachineTokenRejected) return { decision: 'deny', reason: 'this machine was replaced by a newer instance' };
    prior = null;
  }
  if (prior && 'resolution' in prior) {
    await reg.consume(prior.park).catch(() => {});
    return outcomeOf(prior.resolution);
  }
  const messageId = prior?.park.messageId ?? await ask.postCard();
  if (!messageId) return { decision: 'deny', reason: 'could not raise the approval request' };
  let park: Park | null = prior?.park ?? null;
  if (!park) {
    park = await reg.park({
      key: ask.key, kind: 'approval', messageId, question: ask.question,
      taskId: ask.taskId ?? null, threadId: ask.threadId ?? null, turnId: ask.turnId ?? null,
      request: ask.request, checkpoint: ask.checkpoint, wakeCondition: { on: 'answer', messageId },
    }).catch(() => null);
  }
  // no park could be written: the old in-memory wait, unchanged, rather than a wait nobody resumes
  const hot = park ? (reg.draining ? 0 : reg.hotWaitMs) : reg.ttlMs;
  const answer = await ask.awaitAnswer(messageId, hot, () => reg.draining);
  if (answer !== null) {
    const res: ParkResolution = { answer, approved: answer === 'Approve', source: 'machine' };
    if (park) await reg.consume(park, res).catch(() => {});
    return outcomeOf(res);
  }
  if (!park) return { decision: 'deny', reason: 'approval timed out — denied' };
  ask.onParked?.(park, messageId);
  return { decision: 'deny', reason: PARKED_REASON };
}
