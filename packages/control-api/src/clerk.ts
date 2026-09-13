import { createPublicKey, verify } from 'node:crypto';
import { DomainError } from './errors';

// api.clerk.com sits behind Cloudflare, which 1010-blocks unfamiliar User-Agents
// (observed: python-urllib gets a 403 "error code: 1010"). Node's fetch UA passes
// today, but a runtime/CF shift would break auth with a confusing 401 — pin a
// browser-like UA on the Backend-API calls so it can't silently regress.
const CLERK_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Clerk auth bridge: verify a Clerk session JWT (RS256) against Clerk's published
// JWKS, then resolve the user. We do NOT make PowerSync trust Clerk directly —
// Clerk locks `sub` to its own user id and PowerSync requires the user id to be
// `sub`, so the host mints its own PowerSync token (sub = our internal uuid) after
// this verification. No new deps: node:crypto verifies RS256 from the JWK.

// The Clerk frontend API domain is encoded in the publishable key:
// pk_<env>_<base64("<domain>$")>. Derive it so JWKS + issuer need no extra env.
export function clerkDomain(): string {
  const pk = process.env['CLERK_PUBLISHABLE_KEY'] ?? '';
  const b64 = pk.split('_').slice(2).join('_');
  if (!b64) return '';
  try {
    return Buffer.from(b64, 'base64').toString('utf8').replace(/\$+$/, '');
  } catch {
    return '';
  }
}

type Jwk = { kid: string; kty: string; n: string; e: string; alg?: string };
let jwksCache: { keys: Jwk[]; at: number } | null = null;

// exported for the merged sync JWKS (fleet.ts): PowerSync validates against ONE key
// source, so /v1/sync-jwks serves clerk's keys + the machine issuer's in one document.
export async function clerkJwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.at < 600_000) return jwksCache.keys;
  const domain = clerkDomain();
  if (!domain) throw new DomainError('AUTH_FAILED', 'CLERK_PUBLISHABLE_KEY is not set or malformed');
  // A JWKS WE CANNOT FETCH SAYS NOTHING ABOUT THE TOKEN (George, 2026-09-06: "generate image …
  // authentication failed" on a phone whose session was fine). This fetch can fail three ways the
  // old code turned into a 401: a network throw, the 8s timeout, and unreadable JSON. A 401 makes
  // every client conclude its credential is dead, and the desktop signs the person out on one.
  //
  // So: keep serving the LAST GOOD KEYS through an outage — Clerk rotates rarely and an outage is
  // not a rotation — and when there are none, say AUTH_UNAVAILABLE, which is a 503 the clients
  // already retry. This is the same ruling as auth-boot-identity-fix: 401 is for a verified-dead
  // credential and nothing else.
  let keys: Jwk[];
  try {
    const res = await fetch(`https://${domain}/.well-known/jwks.json`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new DomainError('AUTH_UNAVAILABLE', `clerk jwks fetch failed (${res.status})`);
    keys = ((await res.json()) as { keys?: Jwk[] }).keys ?? [];
  } catch (e) {
    if (jwksCache) return jwksCache.keys;
    if (e instanceof DomainError) throw e;
    throw new DomainError('AUTH_UNAVAILABLE', `clerk jwks unreachable: ${e instanceof Error ? e.message : 'fetch failed'}`);
  }
  jwksCache = { keys, at: Date.now() };
  return keys;
}

// Verify the Clerk JWT and return its claims (throws AUTH_FAILED on any failure).
export async function verifyClerkToken(token: string): Promise<{ sub: string; [k: string]: unknown }> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new DomainError('AUTH_FAILED', 'malformed token');
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let payload: { sub?: string; exp?: number; nbf?: number; iss?: string };
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    throw new DomainError('AUTH_FAILED', 'unparseable token');
  }
  if (header.alg !== 'RS256') throw new DomainError('AUTH_FAILED', `unexpected token alg ${header.alg ?? '?'}`);
  const jwk = (await clerkJwks()).find((k) => k.kid === header.kid);
  if (!jwk) throw new DomainError('AUTH_FAILED', 'token signed by an unknown key');
  const pub = createPublicKey({ key: jwk as never, format: 'jwk' });
  const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), pub, Buffer.from(s, 'base64url'));
  if (!ok) throw new DomainError('AUTH_FAILED', 'bad token signature');
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now - 5) throw new DomainError('AUTH_FAILED', 'token expired');
  if (typeof payload.nbf === 'number' && payload.nbf > now + 5) throw new DomainError('AUTH_FAILED', 'token not yet valid');
  if (payload.iss && payload.iss !== `https://${clerkDomain()}`) throw new DomainError('AUTH_FAILED', `unexpected issuer ${payload.iss}`);
  if (!payload.sub) throw new DomainError('AUTH_FAILED', 'token has no subject');
  return payload as { sub: string; [k: string]: unknown };
}

// Mint a fresh PowerSync token from a live Clerk session via the Backend API,
// using the "powersync" JWT template (sets aud = the PowerSync instance URL). This
// is how the desktop refreshes its sync token without re-opening the browser — the
// session stays valid for days, so we re-mint short-lived tokens against it. The
// token PowerSync validates is Clerk-signed (its JWKS), so no client holds a key.
// Is this Clerk session definitively dead? Consulted only when a token mint fails,
// to decide SESSION_EXPIRED (client signs out) vs AUTH_UNAVAILABLE (client retries).
// Deliberately conservative: dead ONLY on a clean 404 or an explicit non-active
// status — a bad secret key, a Clerk 5xx, or a network failure proves nothing about
// the session, and answering "dead" on uncertainty would sign users out on outages.
async function clerkSessionDead(key: string, sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.clerk.com/v1/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${key}`, 'user-agent': CLERK_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return true; // session gone
    if (!res.ok) return false;
    const s = (await res.json()) as { status?: string };
    return typeof s.status === 'string' && s.status !== 'active'; // expired | revoked | ended | removed | replaced
  } catch {
    return false;
  }
}

export async function mintPowerSyncToken(sessionId: string): Promise<string> {
  const key = process.env['CLERK_SECRET_KEY'];
  if (!key) throw new DomainError('AUTH_UNAVAILABLE', 'CLERK_SECRET_KEY is not set');
  let res: Response;
  try {
    res = await fetch(`https://api.clerk.com/v1/sessions/${sessionId}/tokens/powersync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json', 'user-agent': CLERK_UA },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    // network/timeout to Clerk — transient by definition, never a sign-out signal
    throw new DomainError('AUTH_UNAVAILABLE', `clerk unreachable: ${e instanceof Error ? e.message : 'fetch failed'}`);
  }
  const body = (await res.json().catch(() => ({}))) as { jwt?: string; errors?: Array<{ message?: string }> };
  if (res.ok && body.jwt) return body.jwt;
  // A 4xx could be a dead session OR a config problem (missing "powersync" JWT
  // template, bad secret) — probe the session itself so only a truly dead one
  // signs the user out; everything inconclusive stays retryable.
  if (res.status >= 400 && res.status < 500 && (await clerkSessionDead(key, sessionId))) {
    throw new DomainError('SESSION_EXPIRED', 'Clerk session expired or revoked — sign in again');
  }
  throw new DomainError('AUTH_UNAVAILABLE', body.errors?.[0]?.message ?? `could not mint a PowerSync token (${res.status}) — is the Clerk "powersync" JWT template configured?`);
}

// The session token doesn't carry the email — fetch the primary one from the
// Clerk Backend API (secret key) for nm_users (display + future linking). Best
// effort: a missing email never blocks sign-in.
export async function clerkUserEmail(clerkUserId: string): Promise<string | null> {
  const key = process.env['CLERK_SECRET_KEY'];
  if (!key) return null;
  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
      headers: { Authorization: `Bearer ${key}`, 'user-agent': CLERK_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const u = (await res.json()) as ClerkUser;
    const primary = u.email_addresses?.find((e) => e.id === u.primary_email_address_id) ?? u.email_addresses?.[0];
    return primary?.email_address ?? null;
  } catch {
    return null;
  }
}

// Same lookup, but carrying whether Clerk has VERIFIED the address. Workspace invitations are
// claimed by matching a verified email (docs/27 §1d) — matching an unverified one would let
// anyone join a workspace by signing up with somebody else's address, so this is a security
// boundary, not a nicety. Fails closed: an unreadable verification status is `false`.
export async function clerkPrimaryEmail(clerkUserId: string): Promise<{ email: string; verified: boolean; firstName: string | null } | null> {
  const key = process.env['CLERK_SECRET_KEY'];
  if (!key) return null;
  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
      headers: { Authorization: `Bearer ${key}`, 'user-agent': CLERK_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const u = (await res.json()) as ClerkUser;
    const primary = u.email_addresses?.find((e) => e.id === u.primary_email_address_id) ?? u.email_addresses?.[0];
    if (!primary?.email_address) return null;
    // first_name names the workspace a first sign-in creates (first-workspace.ts); null when unset
    return { email: primary.email_address, verified: primary.verification?.status === 'verified', firstName: u.first_name?.trim() || null };
  } catch {
    return null;
  }
}

type ClerkUser = {
  id: string;
  first_name?: string | null;
  email_addresses?: Array<{ id: string; email_address: string; verification?: { status?: string } | null }>;
  primary_email_address_id?: string;
};

function primaryEmail(u: ClerkUser, fallback: string): string {
  const p = u.email_addresses?.find((e) => e.id === u.primary_email_address_id) ?? u.email_addresses?.[0];
  return p?.email_address ?? fallback;
}

// Look up a Clerk user by email (Backend API) for the in-app email/password path.
export async function clerkFindUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const key = process.env['CLERK_SECRET_KEY'];
  if (!key) throw new DomainError('AUTH_FAILED', 'CLERK_SECRET_KEY is not set');
  const res = await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${key}`, 'user-agent': CLERK_UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new DomainError('AUTH_FAILED', `clerk user lookup failed (${res.status})`);
  const users = (await res.json()) as ClerkUser[];
  const u = users?.[0];
  return u ? { id: u.id, email: primaryEmail(u, email) } : null;
}

// Create a Clerk user (Backend API) for the in-app sign-up path. Clerk enforces
// its own password policy (length, breach check) — its human-readable message is
// surfaced as-is so the form can show *why*. A taken email is CONFLICT, worded so
// the UI can steer to sign-in (signup forms reveal duplicates by nature; the
// sign-in endpoint stays opaque).
export async function clerkCreateUser(email: string, password: string): Promise<{ id: string; email: string }> {
  const key = process.env['CLERK_SECRET_KEY'];
  if (!key) throw new DomainError('AUTH_FAILED', 'CLERK_SECRET_KEY is not set');
  const res = await fetch('https://api.clerk.com/v1/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json', 'user-agent': CLERK_UA },
    body: JSON.stringify({ email_address: [email], password }),
    signal: AbortSignal.timeout(8000),
  });
  const body = (await res.json().catch(() => ({}))) as ClerkUser & { errors?: Array<{ code?: string; message?: string; long_message?: string }> };
  if (res.ok && body.id) return { id: body.id, email: primaryEmail(body, email) };
  const err = body.errors?.[0];
  if (err?.code === 'form_identifier_exists' || err?.code === 'duplicate_record') {
    throw new DomainError('CONFLICT', 'an account with this email already exists — sign in instead');
  }
  if (res.status === 422) throw new DomainError('INVALID_INPUT', err?.long_message ?? err?.message ?? 'invalid email or password');
  throw new DomainError('AUTH_FAILED', err?.long_message ?? err?.message ?? `account creation failed (${res.status})`);
}

// Verify a Clerk user's password (Backend API). True only on a confirmed match —
// a wrong password (4xx) or a password-less (social-only) account returns false.
export async function clerkVerifyPassword(userId: string, password: string): Promise<boolean> {
  const key = process.env['CLERK_SECRET_KEY'];
  if (!key) throw new DomainError('AUTH_FAILED', 'CLERK_SECRET_KEY is not set');
  const res = await fetch(`https://api.clerk.com/v1/users/${userId}/verify_password`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json', 'user-agent': CLERK_UA },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(8000),
  });
  const body = (await res.json().catch(() => ({}))) as { verified?: boolean };
  return res.ok && body.verified === true;
}

// Create a session for a user → its id, which re-mints PowerSync tokens later.
// The Backend API's create-session endpoint is DEV-ONLY ("Request only valid for
// development instances" — the v0.19.0 prod signup/sign-in failure), so this mints
// a short-lived sign-in token (Backend API, prod-supported) and exchanges it via
// the Frontend API's native ticket flow — the same path Clerk's mobile SDKs use.
// Session establishment has been observed to flake transiently — retry.
export async function createClerkSession(userId: string): Promise<string> {
  const key = process.env['CLERK_SECRET_KEY'];
  if (!key) throw new DomainError('AUTH_FAILED', 'CLERK_SECRET_KEY is not set');
  const fapi = clerkDomain();
  if (!fapi) throw new DomainError('AUTH_FAILED', 'CLERK_PUBLISHABLE_KEY is not set or malformed');
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const tokRes = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json', 'user-agent': CLERK_UA },
        body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }),
        signal: AbortSignal.timeout(8000),
      });
      const tok = (await tokRes.json().catch(() => ({}))) as { token?: string; errors?: Array<{ message?: string; long_message?: string }> };
      if (!tokRes.ok || !tok.token) {
        lastErr = tok.errors?.[0]?.long_message ?? tok.errors?.[0]?.message ?? `sign-in token mint failed (${tokRes.status})`;
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      const res = await fetch(`https://${fapi}/v1/client/sign_ins?_is_native=1`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': CLERK_UA },
        body: `strategy=ticket&ticket=${encodeURIComponent(tok.token)}`,
        signal: AbortSignal.timeout(8000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        response?: { status?: string; created_session_id?: string };
        errors?: Array<{ message?: string; long_message?: string }>;
      };
      if (res.ok && body.response?.status === 'complete' && body.response.created_session_id) return body.response.created_session_id;
      lastErr = body.errors?.[0]?.long_message ?? body.errors?.[0]?.message ?? `ticket exchange failed (${res.status}, status=${body.response?.status ?? '?'})`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new DomainError('AUTH_FAILED', `could not create a Clerk session: ${lastErr}`);
}
