// Clerk sign-in for NM_AUTH=clerk. The packaged desktop CAN'T complete a PRODUCTION Clerk
// OAuth flow on a 127.0.0.1 loopback — the callback needs a first-party cookie on
// clerk.neuramesh.app that a cross-site loopback can't hold (dev dodges it via the URL
// __clerk_db_jwt token; production can't). So social sign-in now runs on the TRUSTED
// neuramesh.app/desktop-signin page (clerk-js on the Clerk domain works there); that page
// posts the verified Clerk token to control-api's device-code rendezvous and the desktop
// polls for the resolved nm session here. Email/password stays a browser-free control-api
// call. We mint our OWN PowerSync token for the uuid (sync.ts), so PowerSync/RLS don't
// change. Identity persists locally — re-signing in only on logout.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { BAKED } from './baked';
import { connections } from './connections';

export interface ClerkSession {
  userId: string; // our internal uuid (nm_users.id)
  email: string;
  sessionId: string; // the Clerk session id — re-mints PowerSync tokens server-side
  savedAt: number;
}

const sessionPath = () => join(app.getPath('userData'), 'clerk-session.json');
let session: ClerkSession | null = null;

export function loadClerkSession(): ClerkSession | null {
  try {
    session = JSON.parse(readFileSync(sessionPath(), 'utf8')) as ClerkSession;
  } catch {
    session = null;
  }
  return session;
}

function save(s: ClerkSession | null) {
  session = s;
  if (s) {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(sessionPath(), JSON.stringify(s));
  } else {
    rmSync(sessionPath(), { force: true });
  }
}

/** the upgrade handoff (upgradeipc.ts) persists the session the /pro page landed exactly as a
 *  sign-in does — one writer, one file, one shape */
export function saveClerkSession(s: ClerkSession): void { save(s); }

export function currentClerkUser(): { id: string; email: string } | null {
  if (!session) loadClerkSession();
  return session ? { id: session.userId, email: session.email } : null;
}

export function clerkLogout() {
  save(null);
}

// Hosted-web sign-in (device-code). Opens neuramesh.app/desktop-signin in the system browser
// — clerk-js there runs on the Clerk domain, so Google / GitHub / email all complete (unlike
// the old 127.0.0.1 loopback). The page posts the signed-in Clerk token to control-api keyed
// by a one-time nonce; we poll (with the secret only we hold) until it lands, then persist.
// The web URL is the connection's (connections.ts: env in dev, then baked — baked.ts holds the
// dot-access read the dist build replaces). `provider` is reserved for a future auto-start — the
// page already offers all methods.
export async function loginViaHostedWeb(apiUrl: string, _provider?: 'google' | 'github'): Promise<ClerkSession> {
  const { shell } = await import('electron');
  const webUrl = connections.byApiUrl(apiUrl)?.webUrl || BAKED.webUrl;

  const startRes = await fetch(`${apiUrl}/auth/desktop/start`, { method: 'POST' });
  const start = (await startRes.json().catch(() => ({}))) as { nonce?: string; pollSecret?: string; expiresIn?: number };
  if (!startRes.ok || !start.nonce || !start.pollSecret) throw new Error(`could not start sign-in (${startRes.status})`);

  const url = new URL('/desktop-signin', webUrl);
  url.searchParams.set('nonce', start.nonce);
  await shell.openExternal(url.toString());

  // Give the browser hand-off a short window to land the session, then give up so the UI can
  // offer a retry with a FRESH nonce — instead of wedging "Waiting for your browser…" for the
  // server's full TTL. The server nonce outlives this, so once the browser is signed in the next
  // attempt completes near-instantly.
  const SIGN_IN_TIMEOUT_MS = 60_000;
  const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const pollRes = await fetch(`${apiUrl}/auth/desktop/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce: start.nonce, pollSecret: start.pollSecret }),
    });
    const out = (await pollRes.json().catch(() => ({}))) as { status?: string; userId?: string; email?: string; sessionId?: string };
    if (out.status === 'done' && out.userId) {
      const s: ClerkSession = { userId: out.userId, email: out.email ?? '', sessionId: out.sessionId ?? '', savedAt: Date.now() };
      save(s);
      console.log(`clerk_login ok (hosted) user=${s.userId.slice(0, 8)} email=${s.email}`);
      return s;
    }
    if (out.status === 'gone') throw new Error('sign-in expired — please try again');
    // 'pending' → keep polling
  }
  throw new Error('sign-in timed out — close the browser tab and try again');
}

// Social sign-in (Google / GitHub) → the hosted web page (it offers both, plus email).
export async function loginWithClerkOAuth(apiUrl: string, provider: 'google' | 'github'): Promise<ClerkSession> {
  return loginViaHostedWeb(apiUrl, provider);
}

// Email/password sign-in entirely in-app — control-api verifies it against Clerk (no browser).
export async function loginWithClerkPassword(apiUrl: string, email: string, password: string): Promise<ClerkSession> {
  const res = await fetch(`${apiUrl}/auth/clerk/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json().catch(() => ({}))) as { userId?: string; email?: string; sessionId?: string; error?: string };
  if (!res.ok || !data.userId) throw new Error(data.error ?? `sign-in failed (${res.status})`);
  const s: ClerkSession = { userId: data.userId, email: data.email ?? email, sessionId: data.sessionId ?? '', savedAt: Date.now() };
  save(s);
  console.log(`clerk_login ok (password) user=${s.userId.slice(0, 8)} email=${s.email}`);
  return s;
}

// Email/password sign-up entirely in-app — control-api creates the Clerk user and
// signs it straight in (same session shape as the password login).
export async function signupWithClerkPassword(apiUrl: string, email: string, password: string): Promise<ClerkSession> {
  const res = await fetch(`${apiUrl}/auth/clerk/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json().catch(() => ({}))) as { userId?: string; email?: string; sessionId?: string; error?: string };
  if (!res.ok || !data.userId) throw new Error(data.error ?? `account creation failed (${res.status})`);
  const s: ClerkSession = { userId: data.userId, email: data.email ?? email, sessionId: data.sessionId ?? '', savedAt: Date.now() };
  save(s);
  console.log(`clerk_signup ok user=${s.userId.slice(0, 8)} email=${s.email}`);
  return s;
}

// Generic "open the sign-in page" entry (no provider preselected) — same hosted flow.
export async function loginWithClerk(apiUrl: string): Promise<ClerkSession> {
  return loginViaHostedWeb(apiUrl);
}

// A fresh PowerSync token for the current Clerk session (the control-api re-mints
// it from the session via Clerk's Backend API). PowerSync validates it against
// Clerk's JWKS; its sub is the Clerk id, which the sync rule maps to our uuid.
export async function clerkPowerSyncToken(apiUrl: string): Promise<string> {
  if (!session) loadClerkSession();
  if (!session?.sessionId) throw new Error('not signed in (no Clerk session)');
  const res = await fetch(`${apiUrl}/auth/clerk/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.sessionId }),
  });
  const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string; code?: string };
  if (!res.ok || !data.token) {
    // 401 = the control-api verified the session is dead (SESSION_EXPIRED) — drop it
    // so the app lands on sign-in. Anything else (503 AUTH_UNAVAILABLE, network, 5xx)
    // is transient: throw and let the PowerSync SDK retry fetchCredentials — a Clerk
    // or control-api blip must never sign the user out.
    if (res.status === 401) { save(null); app.relaunch(); app.exit(0); }
    throw new Error(data.error ?? `could not refresh sync token (${res.status}${data.code ? ` ${data.code}` : ''})`);
  }
  return data.token;
}

/**
 * THE /v1 CREDENTIAL. A Clerk-signed JWT, cached and re-minted before it lapses.
 *
 * Why this exists: every /v1 call used to authenticate with a bare `x-nm-actor` header — a
 * SELF-ASSERTED identity the server accepted without verifying anything. Anyone could claim to
 * be anyone. The control-api's middleware has always had a bearer branch that verifies a real
 * Clerk token against Clerk's JWKS; the desktop simply never used it, even though it already
 * mints exactly such a token every few minutes for PowerSync. This closes that gap by sending
 * the credential we already have.
 *
 * Cached because the mint is a network round-trip to control-api (which calls Clerk's Backend
 * API), and a per-request mint would put two calls on the wire for every one we make. Re-minted
 * 60s before expiry so a request never carries a token that lapses in flight — the middleware
 * rejects a bad bearer outright rather than falling back to the header, so a stale token is a
 * failed call, not a degraded one.
 */
let apiToken: { token: string; expMs: number } | null = null;

function jwtExpMs(token: string): number {
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number };
    return typeof p.exp === 'number' ? p.exp * 1000 : 0;
  } catch { return 0; }
}

export async function clerkApiToken(apiUrl: string): Promise<string> {
  const REFRESH_MARGIN_MS = 60_000;
  if (apiToken && Date.now() < apiToken.expMs - REFRESH_MARGIN_MS) return apiToken.token;
  const token = await clerkPowerSyncToken(apiUrl);
  apiToken = { token, expMs: jwtExpMs(token) };
  return token;
}

/** drop the cached token — used when the server rejects it, so the retry mints a fresh one */
export function clearClerkApiToken(): void {
  apiToken = null;
}
