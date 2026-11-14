// The Cloud Run boot contract (architecture decision D12). The image or pool carries a long-lived
// per-machine boot credential, NM_BOOT_CREDENTIAL, that nm-api accepts on one route only:
// `POST /v1/machines/boot`. Each boot starts a new incarnation and answers with its epoch, an
// epoch-bound short-lived machine token, the snapshot keys to restore, and the machine's size.
// Every other /v1 call uses that token, renewed while the epoch is current. A crash-restart is a
// new process, so it simply boots again and the old epoch is fenced server-side.
import type { SnapshotKeys } from './lifecycle';

export interface BootGrant {
  epoch: number;
  /** a machine token (`nmm_…`) bound to this epoch, so every existing /v1 path accepts it */
  token: string;
  expiresAt: Date | null;
  snapshot: SnapshotKeys | null;
  sizeClass: SizeClass | null;
  /** the controller's OOM guard threshold for this size, overriding NM_OOM_GUARD_PCT */
  guardPct: number | null;
  /** identity the env template would otherwise stamp; absent fields must come from the env */
  identity: { machineId?: string; workspaceId?: string; ownerUserId?: string; kind?: string };
  /** the sandbox's boot-loop probe (control-api e2e-machine-doors.ts): throw after this grant. Honoured
   *  only with NM_E2E_MARKER=1 on the machine (machined.ts e2eBootThrow) */
  e2eBootThrow?: boolean;
}

export class BootRefused extends Error {}

/** nm-api's two refusals that are not about the credential (control-api fleet-cloudrun-breaker.ts).
 *  PARKED: a ghost instance of a machine that is asleep. BOOT_LOOP: the crash-loop breaker is open.
 *  Neither is fixed by exiting: Cloud Run restarts an exited PID 1 at once, which IS the loop. So the
 *  boot holds (starts nothing: no agent host, no box, no relay edge) and asks again every
 *  NM_BOOT_HOLD_POLL_MS, because a wake that lands meanwhile finds the pool at 1 already and only this
 *  instance can serve it. SIGTERM, when nm-fleet scales the pool to 0, ends the process cleanly */
export type BootHold = 'PARKED' | 'BOOT_LOOP' | 'SNAPSHOT_READER_REQUIRED';
const HOLDS: ReadonlySet<string> = new Set<BootHold>(['PARKED', 'BOOT_LOOP', 'SNAPSHOT_READER_REQUIRED']);
export const BOOT_HOLD_POLL_MS = 30_000;
export function bootHoldPollMs(env: Record<string, string | undefined>): number {
  const n = Number(env['NM_BOOT_HOLD_POLL_MS'] ?? BOOT_HOLD_POLL_MS);
  return Number.isFinite(n) && n >= 1_000 && n <= 600_000 ? n : BOOT_HOLD_POLL_MS;
}

/** the code of a 409 body, or null */
async function refusalCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { code?: unknown };
    return typeof body.code === 'string' ? body.code : null;
  } catch {
    return null;
  }
}

/** PID 1 gets no default signal action, so a held boot must exit on SIGTERM itself. Installed while
 *  the boot holds, removed once a grant arrives (machined.ts installs its own drain-aware handler) */
export function holdUntilSigterm(proc: Pick<NodeJS.Process, 'on' | 'off' | 'exit'>, log: (line: string) => void): (hold: BootHold | null) => void {
  let handler: (() => void) | null = null;
  return (hold) => {
    if (hold && !handler) {
      handler = () => { log('boot: SIGTERM while held; exiting'); proc.exit(0); };
      proc.on('SIGTERM', handler);
    } else if (!hold && handler) {
      proc.off('SIGTERM', handler);
      handler = null;
    }
  };
}
/** nm-api answered 409 to a renewal: a newer boot owns this machine */
export class TokenFenced extends Error {}

export const SIZE_CLASSES = ['S', 'M', 'L', 'XL'] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number];
/** the boot credential's shape, checked before it is sent anywhere */
export const BOOT_CREDENTIAL = /^nmb_[0-9a-f]{64}$/;

export interface BootDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
  maxAttempts?: number;
  /** how often a held boot asks again (NM_BOOT_HOLD_POLL_MS) */
  holdPollMs?: number;
  /** the boot started holding (PARKED, BOOT_LOOP) or, with null, stopped: install or drop SIGTERM */
  onHold?: (hold: BootHold | null) => void;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const dateOf = (v: unknown): Date | null => {
  const d = typeof v === 'string' ? new Date(v) : null;
  return d && Number.isFinite(d.getTime()) ? d : null;
};

/** strict: a grant without an epoch or a machine token must stop the boot */
export function parseBootGrant(body: unknown): BootGrant {
  const b = (body ?? {}) as Record<string, unknown>;
  const epoch = b['epoch'];
  const token = b['token'];
  if (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 1) throw new Error('boot: nm-api answered without an epoch');
  if (typeof token !== 'string' || !token.startsWith('nmm_')) throw new Error('boot: nm-api answered without a machine token');
  const snap = b['snapshot'] as Record<string, unknown> | null | undefined;
  const work = str(snap?.['work']);
  const box = str(snap?.['box']);
  const guard = b['guardPct'];
  return {
    epoch, token,
    expiresAt: dateOf(b['expiresAt']),
    snapshot: work ? { work, ...(box ? { box } : {}) } : null,
    sizeClass: SIZE_CLASSES.find((s) => s === b['sizeClass']) ?? null,
    guardPct: typeof guard === 'number' && guard >= 50 && guard <= 99 ? guard : null,
    identity: {
      ...(str(b['machineId']) ? { machineId: str(b['machineId']) } : {}),
      ...(str(b['workspaceId']) ? { workspaceId: str(b['workspaceId']) } : {}),
      ...(str(b['ownerUserId']) ? { ownerUserId: str(b['ownerUserId']) } : {}),
      ...(str(b['kind']) ? { kind: str(b['kind']) } : {}),
    },
    ...((b['e2e'] as { bootThrow?: unknown } | undefined)?.bootThrow === true ? { e2eBootThrow: true } : {}),
  };
}

/** the env the grant fills, so readConfig and apiauth see a stamped machine */
export function grantEnv(grant: BootGrant): Record<string, string> {
  const { machineId, workspaceId, ownerUserId, kind } = grant.identity;
  return {
    NM_MACHINE_TOKEN: grant.token,
    ...(machineId ? { NM_MACHINE_ID: machineId } : {}),
    ...(workspaceId ? { NM_WORKSPACE_ID: workspaceId } : {}),
    ...(ownerUserId ? { NM_OWNER_USER_ID: ownerUserId } : {}),
    ...(kind ? { NM_MACHINE_KIND: kind } : {}),
  };
}

export async function bootMachine(apiUrl: string, credential: string, deps: BootDeps): Promise<BootGrant> {
  const maxAttempts = deps.maxAttempts ?? Number.POSITIVE_INFINITY;
  let held: BootHold | null = null;
  for (let attempt = 1; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await deps.fetch(`${apiUrl}/v1/machines/boot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
        body: JSON.stringify({ readinessProtocol: 1, snapshotFormats: ['nm-lazy-work-v1'] }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      deps.log(`boot: ${apiUrl} unreachable (${err instanceof Error ? err.message : err}); retrying`);
    }
    if (res) {
      if (res.ok) {
        const grant = parseBootGrant(await res.json());
        if (held) { deps.log(`boot: no longer held (${held}); epoch ${grant.epoch}`); deps.onHold?.(null); }
        return grant;
      }
      // a wrong or revoked credential: no amount of waiting fixes a refusal
      if (res.status === 401 || res.status === 403) throw new BootRefused(`boot: refused (${res.status}). The boot credential does not match this machine.`);
      const code = res.status === 409 ? await refusalCode(res) : null;
      if (code && HOLDS.has(code)) {
        const hold = code as BootHold;
        if (hold !== held) {
          deps.log(hold === 'SNAPSHOT_READER_REQUIRED'
            ? 'boot: held (409 SNAPSHOT_READER_REQUIRED): deploy an image that can read this saved workspace. Saved work is unchanged'
            : hold === 'PARKED'
            ? 'boot: held (409 PARKED): this machine is asleep. Nothing starts. Waiting for SIGTERM, or for a wake'
            : 'boot: held (409 BOOT_LOOP): this machine failed to start too many times in a row. Nothing starts. Waiting for SIGTERM, or for a person to wake it');
          held = hold;
          deps.onHold?.(hold);
        }
        if (attempt >= maxAttempts) throw new Error(`boot: still held (${hold}) after ${attempt} attempts`);
        await deps.sleep(deps.holdPollMs ?? BOOT_HOLD_POLL_MS);
        continue;
      }
      deps.log(`boot: nm-api answered ${res.status}; retrying`);
    }
    if (attempt >= maxAttempts) throw new Error(`boot: no grant after ${attempt} attempts`);
    await deps.sleep(Math.min(30_000, 1_000 * 2 ** Math.min(attempt - 1, 5)));
  }
}

/** Boot a Cloud Run machine into `env`: the credential leaves the environment (no child or terminal
 *  inherits it), and the grant's token and identity take its place. */
export async function bootCloudRunMachine(env: Record<string, string | undefined>, deps: BootDeps): Promise<BootGrant> {
  const credential = env['NM_BOOT_CREDENTIAL'];
  if (!credential) throw new Error('machined: NM_BOOT_CREDENTIAL is required on a Cloud Run machine');
  delete env['NM_BOOT_CREDENTIAL'];
  if (!BOOT_CREDENTIAL.test(credential)) throw new Error('machined: NM_BOOT_CREDENTIAL is not a boot credential (nmb_ and 64 hex digits)');
  const grant = await bootMachine(env['NM_API_URL'] ?? 'https://api.neuramesh.app', credential, deps);
  Object.assign(env, grantEnv(grant));
  return grant;
}

/** renew at half the remaining life, never sooner than 30 s; an unknown expiry renews every 10 min */
export function renewDelayMs(expiresAt: Date | null, nowMs: number): number {
  if (!expiresAt) return 10 * 60_000;
  return Math.max(30_000, Math.floor((expiresAt.getTime() - nowMs) / 2));
}

export interface TokenRenewalOptions {
  apiUrl: string;
  epoch: () => number;
  token: () => string;
  expiresAt: Date | null;
  apply: (token: string, expiresAt: Date | null) => void;
  onFenced: (why: string) => void;
  /** a 401: the token expired, is unknown, or was replaced. Renewal stops; the caller decides
   *  between a fence and a restart (CloudRunLifecycle.tokenRejected). */
  onRejected: (why: string) => void;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  now?: () => number;
}

/** `POST /v1/machines/token {epoch}` with the current token, while the epoch is current */
export class TokenRenewal {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private expiresAt: Date | null;

  constructor(private readonly o: TokenRenewalOptions) { this.expiresAt = o.expiresAt; }

  start(): void { this.schedule(renewDelayMs(this.expiresAt, (this.o.now ?? Date.now)())); }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** one renewal; true when nm-api extended the token (it answers the same token, later expiry) */
  async renew(): Promise<boolean> {
    const call = this.o.fetch ?? fetch;
    try {
      const res = await call(`${this.o.apiUrl}/v1/machines/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.o.token()}` },
        body: JSON.stringify({ epoch: this.o.epoch() }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401) { this.stop(); this.o.onRejected('token renewal: the machine token was refused'); return false; }
      if (res.status === 409) throw new TokenFenced(`token renewal: epoch ${this.o.epoch()} is no longer current`);
      if (!res.ok) throw new Error(`token renewal: HTTP ${res.status}`);
      const body = (await res.json()) as Record<string, unknown>;
      const token = body['token'];
      if (typeof token !== 'string' || !token.startsWith('nmm_')) throw new Error('token renewal: nm-api answered without a machine token');
      this.expiresAt = dateOf(body['expiresAt']);
      this.o.apply(token, this.expiresAt);
      return true;
    } catch (err) {
      if (err instanceof TokenFenced) { this.stop(); this.o.onFenced(err.message); return false; }
      this.o.log?.(`${err instanceof Error ? err.message : err}; retrying in 15 s`);
      return false;
    }
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.renew().then((ok) => this.schedule(ok ? renewDelayMs(this.expiresAt, (this.o.now ?? Date.now)()) : 15_000));
    }, ms);
  }
}
