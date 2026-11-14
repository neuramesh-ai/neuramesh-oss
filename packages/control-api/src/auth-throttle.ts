// THE PUBLIC AUTH DOORS ARE RATE-LIMITED (R10 lane A, NM-080, 2026-11-09). /auth/clerk/token and
// /auth/clerk/api-token mint a fresh Clerk JWT for any session id presented, with no proof of
// possession and no limit, so one leaked token (its `sid` claim) re-mints for the life of the session,
// as fast as the caller likes; /auth/clerk/password and /signup took unlimited guesses and sign-ups.
// A sliding window per key now answers 429 past its budget (the clients retry a 429; only a 401 signs
// them out). Per instance, in memory: a Cloud Run service with N instances allows N times the budget,
// which still turns an unbounded loop into a slow one. Proof of possession for the session mint (an
// nm-side refresh secret every client stores) needs a client rollout and is the follow-up.
//
// THE MINT HAS NO BUDGET FOR AN ADDRESS, AND ITS SESSION BUDGET IS WIDE (the security lane's review,
// 2026-11-13). A desktop that cannot mint sends its call with no bearer, the gate answers 401, and
// the app signs the person out (apiauth.ts, sync/boot.ts). The address key is the first forwarded
// address, which the caller writes, so a stranger could spend a victim's address budget and sign
// the victim out. A desktop also mints once for each concurrent call while it has no token. So the
// mint keeps one key, the session id (a secret the caller must hold), at a budget no client reaches.
import { createHash } from 'node:crypto';

const windows = new Map<string, number[]>();
let sweptAt = 0;
// a key comes from the request body: a long one is stored as its digest, and the map has a ceiling
const MAX_KEY_CHARS = 96;
const MAX_KEYS = 50_000;
const stored = (key: string): string => (key.length <= MAX_KEY_CHARS ? key : `sha256:${createHash('sha256').update(key).digest('base64url')}`);

export const AUTH_LIMITS = {
  sessionMint: { max: 300, windowMs: 10 * 60_000 },
  ipPassword: { max: 20, windowMs: 15 * 60_000 },
  emailPassword: { max: 10, windowMs: 15 * 60_000 },
} as const;

/** count one hit for `key`; false = over the budget (the hit is not counted against later windows) */
export function allowHit(key: string, limit: { max: number; windowMs: number }, now = Date.now()): boolean {
  if (now - sweptAt > 60_000) { // drop idle keys now and then so the map cannot grow without bound
    sweptAt = now;
    for (const [k, hits] of windows) if (!hits.length || now - hits[hits.length - 1]! > 60 * 60_000) windows.delete(k);
  }
  key = stored(key);
  // a flood of new keys must not grow the map without bound: past the ceiling the counters start again
  if (!windows.has(key) && windows.size >= MAX_KEYS) windows.clear();
  const hits = (windows.get(key) ?? []).filter((t) => now - t < limit.windowMs);
  if (hits.length >= limit.max) { windows.set(key, hits); return false; }
  hits.push(now);
  windows.set(key, hits);
  return true;
}

/** tests only */
export function resetAuthThrottle(): void { windows.clear(); sweptAt = 0; }

/** the caller's address as Cloud Run (and Vercel) forward it: the first x-forwarded-for entry */
export const clientIp = (header: (name: string) => string | undefined): string =>
  (header('x-forwarded-for')?.split(',')[0] ?? header('x-real-ip') ?? 'unknown').trim() || 'unknown';
