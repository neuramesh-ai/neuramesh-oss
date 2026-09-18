import type { HumanCommandInput } from '@neuramesh/shared';

// The typed control-api client shared by every non-desktop surface. Commands and
// messages go here (POST /v1/*), authenticated by a Clerk Bearer token (the same
// token the mobile app mints for PowerSync). Reads come from the local replica,
// not this client. Errors surface the server's JSON envelope so the UI can show a
// real reason rather than a status code.

/** THE FAILURE KEEPS THE SERVER'S OWN WORDS.
 *
 *  This used to trust a string `error` and otherwise print `<path> failed (<status>)` — which threw
 *  away the only evidence there was whenever the body was not our JSON envelope. A phone then
 *  reported "/v1/messages failed (403)" for a 403 nothing in our API can produce, and the cause was
 *  unreachable from the report (George, 2026-09-06). It is the CORS lesson again: a catch that
 *  invents a reason is worse than one that repeats what it was told.
 *
 *  So: our envelope's message when there is one, else the body itself, trimmed to a line. */
export function failure(path: string, status: number, raw: string): ControlApiError {
  const json = parseJson(raw) as { error?: unknown; code?: string } | null;
  const code = json && typeof json.code === 'string' ? json.code : undefined;
  if (json && typeof json.error === 'string' && json.error) return new ControlApiError(json.error, status, code);
  // a tag ends at the next '<' or '>': a run of '<' is not scanned once per '<' (CodeQL, 2026-09-18)
  const said = raw.replace(/<[^<>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  return new ControlApiError(said ? `${path} failed (${status}): ${said}` : `${path} failed (${status})`, status, code);
}

export class ControlApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ControlApiError';
  }
}

// Upload-queue poison guard: PowerSync retries a failed uploadData forever, in order —
// so ONE permanently-rejected op (a message to a since-deleted channel, a malformed row)
// wedges the queue and every later write never publishes. A definitive 4xx will never
// succeed on retry: drop the op. Everything else (network, 5xx) is worth retrying, and
// so are the 4xx codes that are really transient: 401 (token mid-rotation), 408/425
// (timing), 429 (rate limit).
const RETRYABLE_4XX = new Set([401, 408, 425, 429]);
export function isUnrecoverableUploadError(err: unknown): boolean {
  return err instanceof ControlApiError && err.status >= 400 && err.status < 500 && !RETRYABLE_4XX.has(err.status);
}

export interface ControlApiOptions {
  baseUrl: string;
  // Resolves the current Bearer token (the Clerk-signed PowerSync JWT), or null
  // when signed out. Called per request so token rotation is transparent.
  //
  // `force` asks for a FRESH one. It is passed on exactly one occasion: the server answered 401,
  // which is the only proof a client has that the token it holds is no longer good. A host that
  // caches (the phone does) mints again; one that already reads a live source can ignore it.
  getToken?: (force?: boolean) => Promise<string | null> | string | null;
  // Dev-only: when set, send the local dev-stack `x-nm-actor` header instead of a
  // Clerk Bearer (the desktop dev path). Prod never sets this.
  devActor?: string;
}

/** GET /v1/machines/usage — the shape every compute surface derives machineState() from */
export interface MachinesUsage {
  day: string;
  minutes: number;
  capMinutes: number | null;
  plan: string;
  machines: Array<{
    id: string; name: string; desiredReplicas: number; lastSeenAt: string | null; lastWakeAt: string | null; lifecycle: string | null;
    kind?: string; ownerUserId?: string | null; startedAt?: string | null; lastActiveAt?: string | null; idleStopMin?: number | null;
  }>;
  outOfCredits?: boolean;
}

/** GET /v1/usage — the credit ring's read (the desktop's WorkspaceUsage) */
export interface WorkspaceUsage {
  /** monthlyGrant is 0 on Free since 2026-09-12: nothing refills there */
  credits: { remaining: number; granted: number; periodStart: string; monthlyGrant: number; grantRemaining: number; purchasedRemaining: number; outOfCredits: boolean };
  machine: { minutesToday: number; activeSecondsToday: number; capMinutes: number | null; plan: string };
  brain: { callsToday: number; model: string };
  storage: { gb: number; metered: boolean };
  rateVersion: string;
}

/** GET /v1/invites/mine — one invitation waiting on the signed-in person */
export interface PendingInvite {
  inviteId: string; workspaceId: string; workspaceName: string; role: string;
  inviterName: string | null; inviterEmail: string | null; createdAt: string; expiresAt: string;
}

export interface CommandOutcome {
  task: unknown;
  events: unknown[];
}

export interface DesktopAuthStart {
  nonce: string;
  pollSecret: string;
  expiresIn: number;
}

export type DesktopAuthPoll =
  | { status: 'pending' | 'gone' }
  | { status: 'done'; userId: string; email: string | null; sessionId: string | null };

/** A workspace this identity belongs to (0113). Membership is a SET, not a single value. */
export interface WorkspaceMembership {
  id: string;
  name: string;
  slug: string;
  role?: string;
  memberCount?: number;
  plan?: string;
}


function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

export class ControlApiClient {
  constructor(private readonly opts: ControlApiOptions) {}

  /** the /v1 auth headers — PUBLIC so a host can compose a second edge on the same identity (the
   *  phone's relay lane reads them for its machine and wake calls; the mobile-cloud round, S5) */
  async authHeaders(force = false): Promise<Record<string, string>> {
    if (this.opts.devActor) return { 'x-nm-actor': JSON.stringify({ kind: 'human', id: this.opts.devActor }) };
    const token = this.opts.getToken ? await this.opts.getToken(force) : null;
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  /** ONE RETRY ON 401, WITH A FRESH TOKEN.
   *
   *  A cached bearer goes stale on its own schedule, and the first thing that tells a client so is
   *  a 401. Retrying blind would be a loop; retrying ONCE, only after asking the host to mint
   *  again, is the difference between a token that rotates and a screen that fails (the phone's
   *  API lane held whatever sync last minted and never re-minted, so a call made while sync was
   *  down carried an expired token — George, 2026-09-06). A host with no mint returns the same
   *  token, the retry fails the same way, and the caller sees the server's own words. */
  private async send(path: string, init: RequestInit, authed = true): Promise<unknown> {
    for (const force of [false, true]) {
      const auth = authed ? await this.authHeaders(force) : {};
      const res = await fetch(`${this.opts.baseUrl}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), ...auth } });
      const raw = await res.text();
      if (res.ok) return parseJson(raw);
      // only a 401 is worth a second attempt, and only while a fresh token is still unasked for
      if (res.status !== 401 || force || !authed || !this.opts.getToken) throw failure(path, res.status, raw);
    }
    /* c8 ignore next */ throw failure(path, 401, '');
  }

  private post(path: string, body: unknown, authed = true): Promise<unknown> {
    return this.send(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, authed);
  }

  private get(path: string): Promise<unknown> {
    return this.send(path, {});
  }

  // --- authenticated reads (Bearer) ---

  // Every workspace this identity belongs to (0113). NOT PowerSync-replicated: `workspaces`
  // is deliberately outside the publication, so the replica knows the ids (via
  // workspace_members) but never the NAMES — which is exactly what a switcher has to show.
  workspaces(): Promise<{ workspaces: WorkspaceMembership[] }> {
    return this.get('/v1/workspaces') as Promise<{ workspaces: WorkspaceMembership[] }>;
  }

  // Invitations waiting on the caller's verified address. The server resolves the address from
  // the identity — never from the request — so this cannot enumerate anyone else's. The Invited
  // first run (mobile S6) reads it before any wizard.
  myInvites(): Promise<{ invites: PendingInvite[] }> {
    return this.get('/v1/invites/mine') as Promise<{ invites: PendingInvite[] }>;
  }

  // --- authenticated writes (Bearer) ---

  // Run a human board command (task.accept, approve_design, task.promote, task.create,
  // …). Typed against @neuramesh/shared's HumanCommandInput — the exact set + shape the
  // server validates, so a malformed payload fails at compile time, not at runtime.
  command(cmd: HumanCommandInput): Promise<CommandOutcome> {
    return this.post('/v1/commands', cmd) as Promise<CommandOutcome>;
  }

  // Post a chat / thread message. `id` lets an optimistic local row match the server row.
  // The birth fields (docs/34 threadMode · docs/31 rootMessageId · 0119 scheduleId · 0134
  // threadMachineId/threadOrigin) apply ONLY when this send births the thread — the same
  // birth-time contract the desktop's uploader honours (apps/desktop/src/main/sync/upload.ts).
  postMessage(input: {
    workspace: string; channel: string; body: string; taskId?: string; id?: string;
    threadId?: string; threadMode?: 'tasks' | 'chat'; rootMessageId?: string; scheduleId?: string;
    threadMachineId?: string | null; threadOrigin?: 'desktop' | 'web' | 'routine';
    // role -> model for the conversation this send births (docs/10 §15). A birth field like the
    // rest: the server ignores it on a thread that already exists.
    brainOverride?: Record<string, string> | null;
  }): Promise<{ message: unknown; event: unknown }> {
    return this.post('/v1/messages', input) as Promise<{ message: unknown; event: unknown }>;
  }

  /** POST /v1/artifacts — a message's attachment. The same body the desktop's uploader sends, and
   *  `messageId` is what makes it an attachment rather than a library file: the ps_crud branch is
   *  gated on it, and the thread's own query joins artifacts to messages by it. */
  postArtifact(input: {
    id: string; workspace: string; channel: string; messageId: string; taskId?: string | null;
    kind: string; name: string; mime?: string; inlineContent?: string;
    sizeBytes?: number; width?: number; height?: number;
  }): Promise<unknown> {
    return this.post('/v1/artifacts', input);
  }

  // Register this device for push (slice 7 endpoint). Safe to call before the
  // backend ships — a 404 just means push isn't live yet (the UI feature-detects).
  registerDevice(input: { platform: 'ios' | 'android'; token: string; deviceName?: string; appVersion?: string }): Promise<unknown> {
    return this.post('/v1/devices', input);
  }

  unregisterDevice(token: string): Promise<unknown> {
    return this.post('/v1/devices/remove', { token });
  }

  // --- sign-in handoff (no Bearer — these establish the identity) ---

  startDesktopAuth(): Promise<DesktopAuthStart> {
    return this.post('/auth/desktop/start', {}, false) as Promise<DesktopAuthStart>;
  }

  pollDesktopAuth(nonce: string, pollSecret: string): Promise<DesktopAuthPoll> {
    return this.post('/auth/desktop/poll', { nonce, pollSecret }, false) as Promise<DesktopAuthPoll>;
  }

  // Mint a fresh PowerSync/API token from the Clerk session id (~10 min TTL).
  // ── the cloud plane's polled reads (the mobile-cloud round, S1.4) — the same routes the
  // desktop's useCompute / CreditRing / setup tracker read; deliberately outside the replica
  // (desired_replicas is the fleet's own bookkeeping; credits are a ledger). ──
  /** the fleet's word on every cloud machine + today's meter: what machineState() needs */
  machinesUsage(workspace: string): Promise<MachinesUsage> {
    return this.get(`/v1/machines/usage?workspace=${encodeURIComponent(workspace)}`) as Promise<MachinesUsage>;
  }
  /** "Wake now" — a capped or credit-less refusal is a verdict in the body, never a thrown error */
  wakeMachine(workspace: string, machineId?: string): Promise<{ ok?: boolean; capped?: boolean; code?: string; error?: string }> {
    return this.post('/v1/machines/wake', { workspace, ...(machineId ? { machineId } : {}) }).catch((e: unknown) => {
      if (e instanceof ControlApiError && e.status === 409) return { ok: false, capped: true, code: e.code, error: e.message };
      throw e;
    }) as Promise<{ ok?: boolean; capped?: boolean; code?: string; error?: string }>;
  }
  /** the credit ring's read: the balance and the three named lines */
  usage(workspace: string): Promise<WorkspaceUsage> {
    return this.get(`/v1/usage?workspace=${encodeURIComponent(workspace)}`) as Promise<WorkspaceUsage>;
  }
  /** the workspace's provider credentials (mode only — never a token) — the setup card's subscription lane */
  credentials(workspace: string): Promise<{ credentials: Array<{ provider: string; authMode: string; scope: string }> }> {
    return this.get(`/v1/credentials?workspace=${encodeURIComponent(workspace)}`) as Promise<{ credentials: Array<{ provider: string; authMode: string; scope: string }> }>;
  }
  /** the signed-in person's registered push devices (platform only) */
  devices(): Promise<{ devices: Array<{ platform: string }> }> {
    return this.get('/v1/devices') as Promise<{ devices: Array<{ platform: string }> }>;
  }

  mintPowerSyncToken(sessionId: string): Promise<{ token: string }> {
    return this.post('/auth/clerk/token', { sessionId }, false) as Promise<{ token: string }>;
  }
}
