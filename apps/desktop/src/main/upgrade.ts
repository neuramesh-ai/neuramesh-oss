// THE UPGRADE HANDOFF — Get Pro from the desktop (docs/design/oss-release-2026-09, artboards C1, C2).
//
// The desktop takes no card and cannot run Clerk on a loopback, so the browser does both:
// `POST /auth/desktop/start` mints a one-time nonce, the app opens neuramesh.app/pro?nonce=… and
// polls `/auth/desktop/poll` until the page has signed the person up AND Stripe has returned —
// pro.tsx completes the rendezvous only once Pro is paid. The window is FIFTEEN MINUTES, because
// a sign-up plus a checkout is not the 60-second errand the sign-in poll (auth-clerk.ts) budgets
// for. On `done` the Clerk session is persisted exactly as a sign-in persists it, the cloud
// connection is added and booted, and the foreground swaps to it — but only once the workspace
// row reads `cloud`: the webhook flips the plan a few seconds after Stripe, and landing before it
// would put the hosted gate card in front of someone who just paid.
//
// Pure around injected fetch/sleep/now so the clock, the four outcomes and the completion order
// are unit tests, not a browser session. The electron half (upgradeipc.ts) supplies the real ones.
import { DESKTOP_AUTH_TTL_MS } from '@neuramesh/shared';
import type { ConnectionSpec } from './connections';

/** the server's rendezvous TTL (packages/shared desktop-auth.ts) — the sheet waits exactly as long as the nonce lives */
export const UPGRADE_WAIT_MS = DESKTOP_AUTH_TTL_MS;
export const UPGRADE_POLL_MS = 1500;
/** how long the landing waits for Stripe's webhook to flip the row before it lands anyway */
export const PLAN_WAIT_MS = 60_000;
const PLAN_POLL_MS = 2000;

export interface DesktopAuthStart { nonce: string; pollSecret: string }
export interface HandoffSession { userId: string; email: string; sessionId: string }

/** the page the browser opens: the sign-up face of /pro, carrying the nonce the poll waits on */
export function proPageUrl(webUrl: string, nonce: string): string {
  const u = new URL('/pro', webUrl);
  u.searchParams.set('nonce', nonce);
  u.searchParams.set('mode', 'signup');
  return u.toString();
}

export async function startDesktopAuth(fetchImpl: typeof fetch, apiUrl: string): Promise<DesktopAuthStart> {
  const res = await fetchImpl(`${apiUrl}/auth/desktop/start`, { method: 'POST' });
  const body = (await res.json().catch(() => ({}))) as Partial<DesktopAuthStart>;
  if (!res.ok || !body.nonce || !body.pollSecret) throw new Error(`The upgrade did not start (${res.status}).`);
  return { nonce: body.nonce, pollSecret: body.pollSecret };
}

export type PollOutcome =
  | { status: 'done'; session: HandoffSession }
  | { status: 'expired' }
  | { status: 'cancelled' }
  | { status: 'timeout' };

export interface PollDeps {
  fetchImpl: typeof fetch;
  apiUrl: string;
  start: DesktopAuthStart;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** the sheet's Cancel, or a newer attempt that replaced this one */
  cancelled: () => boolean;
  timeoutMs?: number;
  everyMs?: number;
}

/**
 * Poll until the page completes the rendezvous. Stops on `done` (the session), `gone` (the server
 * expired the nonce), a cancel, or the fifteen-minute deadline. A network blip is not an answer:
 * the loop keeps going, because the person is mid-checkout in another window.
 */
export async function pollDesktopAuth(d: PollDeps): Promise<PollOutcome> {
  const deadline = d.now() + (d.timeoutMs ?? UPGRADE_WAIT_MS);
  while (d.now() < deadline) {
    if (d.cancelled()) return { status: 'cancelled' };
    await d.sleep(d.everyMs ?? UPGRADE_POLL_MS);
    if (d.cancelled()) return { status: 'cancelled' };
    const res = await d.fetchImpl(`${d.apiUrl}/auth/desktop/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce: d.start.nonce, pollSecret: d.start.pollSecret }),
    }).catch(() => null);
    const out = res ? ((await res.json().catch(() => ({}))) as { status?: string; userId?: string; email?: string; sessionId?: string }) : {};
    if (out.status === 'done' && out.userId) return { status: 'done', session: { userId: out.userId, email: out.email ?? '', sessionId: out.sessionId ?? '' } };
    if (out.status === 'gone') return { status: 'expired' };
  }
  return { status: 'timeout' };
}

/** true once the row reads `cloud`; false when the wait ran out (the shell then lands anyway) */
export async function waitForPlan(d: { plan: () => Promise<string | null>; sleep: (ms: number) => Promise<void>; now: () => number; timeoutMs?: number; everyMs?: number }): Promise<boolean> {
  const deadline = d.now() + (d.timeoutMs ?? PLAN_WAIT_MS);
  for (;;) {
    if ((await d.plan().catch(() => null)) === 'cloud') return true;
    if (d.now() >= deadline) return false;
    await d.sleep(d.everyMs ?? PLAN_POLL_MS);
  }
}

export interface FinishDeps<C extends { id: string }> {
  saveSession: (s: HandoffSession) => void;
  /** the cloud connection when one is already registered (a Free hosted workspace upgrading) */
  existing: () => C | undefined;
  addConnection: (spec: ConnectionSpec) => Promise<C>;
  /** re-resolve an existing connection under the session just saved */
  resync: (c: C) => Promise<void>;
  planOf: (c: C) => Promise<string | null>;
  setForeground: (id: string) => void;
  cloudSpec: ConnectionSpec;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  planWaitMs?: number;
}

/**
 * The completion, in the only order that is safe: the session first (the connection's boot mints
 * its tokens from it), then the connection, then the plan wait, then the swap. Returns whether the
 * row read `cloud` before the swap so the log can say when the webhook was slow.
 */
export async function finishUpgrade<C extends { id: string }>(session: HandoffSession, d: FinishDeps<C>): Promise<{ connection: C; planReady: boolean; added: boolean }> {
  d.saveSession(session);
  const had = d.existing();
  const connection = had ?? await d.addConnection(d.cloudSpec);
  if (had) await d.resync(had);
  const planReady = await waitForPlan({ plan: () => d.planOf(connection), sleep: d.sleep, now: d.now, timeoutMs: d.planWaitMs });
  d.setForeground(connection.id);
  return { connection, planReady, added: !had };
}
