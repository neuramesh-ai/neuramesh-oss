import { ControlApiClient } from '@neuramesh/client-core';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { API_URL, DEV_EMAIL, DEV_USER, IS_DEV, WEB_URL } from './config';
import { HANDOFF_SECONDS, HANDOFF_TIMEOUT } from './handoff';

const SESSION_KEY = 'nm.session';

// The handoff window and its soft timeout live in ./handoff, which nothing heavy sits under, and
// are re-exported here because every existing caller reads them from auth.
export { HANDOFF_SECONDS, HANDOFF_TIMEOUT } from './handoff';

// WHY THE HANDOFF NEVER STARTED. `openBrowserAsync` is fired and forgotten, so when it refuses —
// most often because a browser sheet is already presented — the poll loop still ran its full 90
// seconds against a page nobody could see, and the caller got a bare timeout. That is a reconnect
// that "does nothing" (George, 2026-09-06). The reason is kept here so the timeout can say it.
let handoffTrouble: string | null = null;
export function lastHandoffTrouble(): string | null {
  return handoffTrouble;
}

export interface Session {
  userId: string;
  email: string | null;
  sessionId: string | null;
}

// The current API/PowerSync Bearer token (a Clerk-signed JWT), refreshed on demand.
let currentToken: string | null = null;
// when it lapses, so the API lane can mint BEFORE a call rather than after a 401
let currentExpiry: number | null = null;
// one mint at a time: a screen that fires four reads on mount must not fire four mints
let minting: Promise<string | null> | null = null;
// a token this close to its end is treated as gone — a request in flight must not outlive it
const TOKEN_FLOOR_MS = 60_000;

// Consecutive mint failures — we only surface the reconnect banner after a few in a row, so
// a single transient blip (network, Clerk hiccup) doesn't flash "Session expired".
let mintFailures = 0;

// Decode a JWT's `exp` claim (seconds) → ms epoch, or null if unreadable. The connector hands
// this to the PowerSync SDK as `expiresAt` so it refreshes the ~10-min token AHEAD of expiry —
// without it the token dies mid-stream and the SDK 401-loops on a 5s timer (flapping banner +
// device heat). Payload is base64url; atob is available on Hermes (RN 0.79).
function jwtExpiryMs(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + (b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4)));
    const claims = JSON.parse(atob(padded)) as { exp?: number };
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

export interface TokenResult {
  token: string;
  // ms epoch when the token expires, or null if undecodable.
  expiresAt: number | null;
}

/** THE API LANE MINTS ITS OWN TOKEN.
 *
 *  It used to return whatever `currentToken` held, and only ONE thing ever set that: PowerSync's
 *  `fetchCredentials`. So the API borrowed sync's token and worked by side effect. Two states broke
 *  it and neither was rare: before the first sync connects `currentToken` is null, so the request
 *  went out with NO authorization header at all; and while sync is down nothing re-mints, so after
 *  about ten minutes every call carried an expired one (George, 2026-09-06 — the offline banner is
 *  in his own screenshot). Now the lane mints when the token is missing or nearly out, and again
 *  when the server says 401, which is the only proof that what we hold is no longer good. */
async function apiToken(force = false): Promise<string | null> {
  const live = currentToken && !force && (currentExpiry === null || currentExpiry - Date.now() > TOKEN_FLOOR_MS);
  if (live) return currentToken;
  const session = cachedSession ?? (await loadSession());
  if (!session) return currentToken;
  minting ??= refreshToken(session)
    .then((r) => r.token)
    .catch(() => currentToken)      // a mint that fails leaves the old token: the call still tries
    .finally(() => { minting = null; });
  return minting;
}

// One shared client — getToken attaches the Bearer to every /v1 write (prod), or in
// dev the client sends the local x-nm-actor header instead.
export const api = new ControlApiClient({ baseUrl: API_URL, getToken: apiToken, devActor: IS_DEV ? DEV_USER : undefined });

// The signed-in user id, cached from the last loadSession so screens can stamp
// optimistic local writes (message author) synchronously.
let cachedSession: Session | null = null;
/** the live API bearer (a Clerk-signed JWT) — the relay attach credential in production */
export function currentBearer(): string | null {
  return currentToken;
}
export function currentUserId(): string | null {
  return cachedSession?.userId ?? null;
}
/** the signed-in address, for the head's letter tile — the person, not the roster's display name */
export function currentEmail(): string | null {
  return cachedSession?.email ?? null;
}

// Re-auth signal: when the sync token can't be minted (the Clerk session lapsed on
// a long-offline phone), the connector flags this so the UI shows a reconnect
// banner. Local reads keep working meanwhile — nothing is lost.
let needsReauth = false;
const reauthListeners = new Set<(v: boolean) => void>();
export function getNeedsReauth(): boolean {
  return needsReauth;
}
export function onReauthChange(listener: (v: boolean) => void): () => void {
  reauthListeners.add(listener);
  return () => reauthListeners.delete(listener);
}
function setNeedsReauth(v: boolean): void {
  if (needsReauth === v) return;
  needsReauth = v;
  for (const l of reauthListeners) l(v);
}

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  cachedSession = raw ? (JSON.parse(raw) as Session) : null;
  return cachedSession;
}

async function saveSession(session: Session): Promise<void> {
  cachedSession = session;
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function signOut(): Promise<void> {
  cachedSession = null;
  currentToken = null;
  currentExpiry = null;
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

// Device-handoff sign-in (reuses the desktop flow, zero new auth surface): open a
// rendezvous, send the user to the trusted neuramesh.app page in the system browser,
// poll until it completes, then persist the verified session. `mode: 'signup'` opens the same
// page in sign-up mode (S0, D15) — Google · GitHub · email with verification, on the web — and
// returns a verified session exactly as sign-in does; the app never sees a password.
export async function signIn(opts: { mode?: 'signup' } = {}): Promise<Session> {
  if (IS_DEV) {
    // Local dev: no Clerk — sign in instantly as the dev user (the seeded one, or the override).
    const session: Session = { userId: DEV_USER, email: DEV_EMAIL, sessionId: 'dev' };
    await saveSession(session);
    return session;
  }
  const { nonce, pollSecret } = await api.startDesktopAuth();
  const url = `${WEB_URL}/desktop-signin?nonce=${encodeURIComponent(nonce)}&client=mobile${opts.mode === 'signup' ? '&mode=signup' : ''}`;
  // fire the in-app browser; we poll concurrently underneath (openBrowserAsync resolves
  // only when the sheet closes, so the loop drives completion + dismissal).
  handoffTrouble = null;
  void WebBrowser.openBrowserAsync(url).catch((e) => { handoffTrouble = e instanceof Error ? e.message.slice(0, 120) : 'The browser did not open.'; });
  const deadline = Date.now() + HANDOFF_SECONDS * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const out = await api.pollDesktopAuth(nonce, pollSecret);
    if (out.status === 'done') {
      const session: Session = { userId: out.userId, email: out.email, sessionId: out.sessionId };
      await saveSession(session);
      void WebBrowser.dismissBrowser();
      return session;
    }
    if (out.status === 'gone') break;
  }
  // Window elapsed (or the nonce was consumed elsewhere) — soft timeout; the UI resets.
  throw new Error(HANDOFF_TIMEOUT);
}

// Mint a fresh API/PowerSync token from the stored session (~10 min TTL) and report its
// expiry so the connector can hand the SDK an `expiresAt` (proactive refresh, no 401 loop).
export async function refreshToken(session: Session): Promise<TokenResult> {
  if (IS_DEV) {
    // Local dev: mint the HS256 dev PowerSync token from the local control-api (6h TTL).
    const res = await fetch(`${API_URL}/auth/dev/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: DEV_USER }) });
    const { token } = (await res.json()) as { token: string };
    currentToken = token;
    currentExpiry = jwtExpiryMs(token);
    mintFailures = 0;
    setNeedsReauth(false);
    return { token, expiresAt: jwtExpiryMs(token) };
  }
  if (!session.sessionId) {
    setNeedsReauth(true);
    throw new Error('This session cannot refresh. Sign in again.');
  }
  try {
    const { token } = await api.mintPowerSyncToken(session.sessionId);
    currentToken = token;
    currentExpiry = jwtExpiryMs(token);
    mintFailures = 0;
    setNeedsReauth(false);
    return { token, expiresAt: jwtExpiryMs(token) };
  } catch (e) {
    // Debounce: only show the reconnect banner after a few consecutive misses. The SDK keeps
    // retrying meanwhile, so a transient failure self-heals without ever flashing the banner.
    mintFailures += 1;
    if (mintFailures >= 3) setNeedsReauth(true);
    throw e;
  }
}
