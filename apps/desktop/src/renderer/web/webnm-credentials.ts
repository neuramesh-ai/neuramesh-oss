// WHICH CLERK SESSION THE BROWSER MINTS ITS SYNC CREDENTIAL FROM.
//
// The bug this module exists for (George, 2026-09-05, from the production API logs). The tab
// authenticates two different ways and only one of them was live: `/v1` calls carry a bearer read
// fresh from clerk-js on every call, while the PowerSync mint posted a session id read out of
// `localStorage` — a SNAPSHOT written at sign-in and refreshed only by a page load. Clerk's
// session does not live as long as a tab does: it expires, it is revoked, it is replaced when the
// same person signs in elsewhere. When that happened the snapshot went stale while the browser
// stayed properly signed in, so:
//
//   - `/auth/clerk/token` answered 401 (the server asks Clerk directly, and Clerk said dead),
//   - PowerSync's connector treats a throw as retryable and asked again ~every 6s, forever,
//   - the tab kept looking signed in, because the bearer lane was fine, and only sync was dead.
//
// Left alone it ran at ten failed mints a minute for hours, each one costing two Clerk API calls
// server-side, and the person saw a workspace that had quietly stopped updating.
//
// So: ask the LIVE client first, and fall back to the stored id only when there is no Clerk client
// to ask (the local harness, which has no Clerk at all). A stale snapshot then cannot outlive the
// session it names.
//
// The second half is honouring a distinction the server already makes and the browser ignored.
// `mintPowerSyncToken` (control-api/src/clerk.ts) returns 401 SESSION_EXPIRED only after probing
// the session and finding it genuinely dead; everything inconclusive — Clerk unreachable, a
// missing JWT template, a bad secret — comes back 503 AUTH_UNAVAILABLE precisely so the client
// keeps retrying. Retrying forever is right for 503 and wrong for 401, and the browser did it for
// both. Now a verified-dead session lands the person on sign-in, the way the desktop already does,
// and everything else still retries.

/** what the mint needs, all injectable so the policy is testable without Clerk or a network */
export interface MintDeps {
  apiUrl: string;
  /** the id the LIVE clerk-js client holds right now; null when Clerk says signed out, and null
   *  in a build with no Clerk at all (the harness), which is what the stored id is for */
  liveSessionId(): Promise<string | null>;
  /** the id this page booted with — the snapshot, and only a fallback */
  storedSessionId(): Promise<string | null>;
  /** persist an id we had to re-derive, so the next boot starts from the right one */
  remember(sessionId: string): void;
  /** the session is verifiably gone: land on sign-in rather than retry a corpse */
  onSessionDead(): void;
  fetch?: typeof fetch;
}

/**
 * Mint the PowerSync credential, or throw.
 *
 * Throwing is how PowerSync is told to retry, so the two failure kinds differ in what they do on
 * the way out, not in whether they throw: a verified-dead session calls `onSessionDead` first, and
 * everything else simply throws so the SDK's backoff can have another go.
 */
export async function mintSyncToken(d: MintDeps): Promise<string> {
  const doFetch = d.fetch ?? fetch;
  const post = (sessionId: string): Promise<Response> =>
    doFetch(`${d.apiUrl}/auth/clerk/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });

  // LIVE FIRST. This one line is the fix; everything below is what to do when even the live
  // session is gone.
  const live = await d.liveSessionId();
  const sessionId = live ?? (await d.storedSessionId());
  // SIGNED OUT IS NOT A DEAD SESSION. With no session anywhere there is nothing to declare dead:
  // the sign-in screen is already what the page shows, and `onSessionDead` reloads the page. A
  // visitor with no Clerk cookie hit exactly that on every load (hq.neuramesh.app blinked forever,
  // George, 2026-09-12) once the server stopped accepting the bare actor header. Throw, so the
  // SDK backs off, and nothing else.
  if (!sessionId) throw new Error('no clerk session — sign in first');

  let res = await post(sessionId);

  if (res.status === 401) {
    // The server has verified this id is dead. Before believing it, ask the live client once more:
    // clerk-js can be mid-refresh with no session momentarily, and signing someone out over a
    // transient null is the very failure we are fixing, one layer up.
    const fresh = await d.liveSessionId();
    if (fresh && fresh !== sessionId) {
      res = await post(fresh);
      if (res.ok) d.remember(fresh);
    } else {
      d.onSessionDead();
      throw new Error('clerk session expired or revoked — sign in again');
    }
  }

  if (res.status === 401) {
    d.onSessionDead();
    throw new Error('clerk session expired or revoked — sign in again');
  }
  // 503 AUTH_UNAVAILABLE, a network blip, a 5xx: transient by the server's own classification.
  // Throw WITHOUT declaring the session dead, so the SDK retries and nobody is signed out over a
  // Clerk outage.
  if (!res.ok) throw new Error(`powersync token mint failed: ${res.status}`);

  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error('powersync token mint returned no token');
  if (sessionId !== (await d.storedSessionId())) d.remember(sessionId);
  return body.token;
}
