// The Pro handoff's pure core (pro.tsx and billing-return.tsx mount it). The desktop's one-time
// nonce rides the /pro URL, but Stripe's success_url is built server-side (billing.ts RETURN_BASE)
// and cannot carry it, so the page stashes it before checkout and the return page takes it back
// once. The window matches the desktop's wait (artboard C2: fifteen minutes) with slack.
export const NONCE_KEY = 'nm:pro:nonce';
export const NONCE_MAX_AGE_MS = 20 * 60_000;

export function stashNonce(storage: Storage, nonce: string, now = Date.now()): void {
  storage.setItem(NONCE_KEY, JSON.stringify({ nonce, at: now }));
}

/** the stashed nonce, once: a second call answers null, and so does a record past the window */
export function takeNonce(storage: Storage, now = Date.now()): string | null {
  const raw = storage.getItem(NONCE_KEY);
  if (!raw) return null;
  storage.removeItem(NONCE_KEY);
  try {
    const rec = JSON.parse(raw) as { nonce?: unknown; at?: unknown };
    if (typeof rec.nonce !== 'string' || typeof rec.at !== 'number') return null;
    return now - rec.at <= NONCE_MAX_AGE_MS ? rec.nonce : null;
  } catch {
    return null;
  }
}

export type WorkspaceRow = { id: string; role: string; plan: string };

/** the workspace the checkout names: the one this person owns, else the first */
export function pickWorkspace<T extends WorkspaceRow>(rows: T[]): T | null {
  return rows.find((w) => w.role === 'owner') ?? rows[0] ?? null;
}

/** Pro is plan id `cloud` server-side (docs/07): the words changed, the id did not */
export const isPro = (plan: string | null | undefined): boolean => plan === 'cloud';
