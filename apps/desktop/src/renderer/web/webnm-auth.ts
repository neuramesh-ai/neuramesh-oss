// the clerk web auth arms (W2 milestone B): the SAME Login screen the desktop renders,
// with its three bridge calls served by clerk-js in the page instead of the main
// process's loopback OAuth. identity establishment is the server's existing
// POST /auth/clerk (clerk token in → internal nm user out, created on first arrival);
// every later /v1 call rides the clerk session token as a bearer — the middleware's
// clerk lane resolves the actor server-side, no x-nm-actor anywhere.

import { Clerk } from '@clerk/clerk-js';

const USER_KEY = 'nm:web:user';
const ACTOR_KEY = 'nm:web:actorId';
const SESSION_KEY = 'nm:web:clerkSession';

let clerkP: Promise<Clerk> | null = null;

export function loadClerk(publishableKey: string): Promise<Clerk> {
  clerkP ??= (async () => {
    const c = new Clerk(publishableKey);
    await c.load();
    return c;
  })();
  return clerkP;
}

/** the live session token for /v1 bearers — null when signed out */
export async function clerkBearer(): Promise<string | null> {
  if (!clerkP) return null;
  const c = await clerkP;
  return (await c.session?.getToken()) ?? null;
}

/** THE LIVE SESSION ID — the one the sync mint must use.
 *
 *  `clerkBearer` above has always read the live client; the mint read a `localStorage` snapshot
 *  instead, and a snapshot outlives the session it names (expiry, revoke, or the same person
 *  signing in elsewhere). That tab then looked signed in, because the bearer lane was fine, while
 *  sync retried a dead id ~every 6s forever (George, 2026-09-05). Null here means Clerk itself
 *  says signed out — or that this build has no Clerk at all, which is the harness lane and the
 *  only reason the stored id is still a fallback. */
export async function liveClerkSessionId(): Promise<string | null> {
  if (!clerkP) return null;
  return (await clerkP).session?.id ?? null;
}

/** remember an id we had to re-derive, so the next boot starts from the right one */
export function rememberClerkSessionId(sessionId: string): void {
  localStorage.setItem(SESSION_KEY, sessionId);
}

/** The session is verifiably gone. The web analogue of the desktop's sign-out-and-relaunch: drop
 *  the identity and reload into the Login screen, ONCE — a second reload on the way out would be
 *  a loop, and this can be reached from the sync connector's own retry. */
let landing = false;
export function clerkSessionDead(): void {
  if (landing) return;
  landing = true;
  console.warn('[webnm] clerk session expired or revoked — signing out to the login screen');
  clearIdentity();
  location.reload();
}

/** clerk session → nm identity via POST /auth/clerk; persisted for the boot arms */
export async function establishNmIdentity(c: Clerk, apiUrl: string): Promise<{ user: { id: string; email: string } }> {
  const token = await c.session?.getToken();
  if (!token) throw new Error('no clerk session');
  const res = await fetch(`${apiUrl}/auth/clerk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(`identity exchange failed: ${res.status}`);
  const body = (await res.json()) as { userId: string; email: string | null; sessionId: string | null };
  const user = { id: body.userId, email: body.email ?? '' };
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem(ACTOR_KEY, user.id);
  if (body.sessionId) localStorage.setItem(SESSION_KEY, body.sessionId);
  return { user };
}

function clearIdentity(): void {
  for (const k of [USER_KEY, ACTOR_KEY, SESSION_KEY]) localStorage.removeItem(k);
}

/** boot-time restore: an existing clerk session (or a just-completed oauth redirect)
 *  re-establishes the nm identity before App evaluates. never throws — boot must not
 *  wedge on an auth hiccup; signed-out is a fine answer. */
export async function restoreSession(publishableKey: string, apiUrl: string): Promise<void> {
  try {
    const c = await loadClerk(publishableKey);
    if (c.session) await establishNmIdentity(c, apiUrl);
    else clearIdentity();
  } catch (e) {
    console.warn(`[webnm] session restore skipped: ${e instanceof Error ? e.message : e}`);
  }
}

/** the Login screen's three calls + sign-out (parity ledger red flag 7's answer) */
export function authOverrides(publishableKey: string, apiUrl: string): Record<string, unknown> {
  return {
    authClerkPassword: async (email: string, password: string) => {
      const c = await loadClerk(publishableKey);
      const r = await c.client!.signIn.create({ identifier: email, password });
      if (r.status !== 'complete') throw new Error(`sign-in needs ${r.status} — use the OAuth buttons for now`);
      await c.setActive({ session: r.createdSessionId });
      return establishNmIdentity(c, apiUrl);
    },
    authClerkSignup: async (email: string, password: string) => {
      const c = await loadClerk(publishableKey);
      const r = await c.client!.signUp.create({ emailAddress: email, password });
      if (r.status !== 'complete') throw new Error('signup needs email verification — the W5 flow adds it; use OAuth today');
      await c.setActive({ session: r.createdSessionId });
      return establishNmIdentity(c, apiUrl);
    },
    authClerkOAuth: async (provider: 'github' | 'google') => {
      const c = await loadClerk(publishableKey);
      await c.client!.signIn.authenticateWithRedirect({
        strategy: provider === 'github' ? 'oauth_github' : 'oauth_google',
        redirectUrl: `${location.origin}/`,
        redirectUrlComplete: `${location.origin}/`,
      });
      // the page navigates away; this promise never settles
      return new Promise(() => {}) as never;
    },
    logout: async () => {
      const c = await loadClerk(publishableKey);
      await c.signOut();
      clearIdentity();
      // the web analogue of the desktop's relaunch-and-wipe (red flag 7): the replica db
      // is deleted with the next boot's identity check; a clean reload is the reset
      location.reload();
    },
  };
}
