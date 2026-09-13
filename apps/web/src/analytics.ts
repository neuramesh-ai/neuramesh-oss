// Page-side analytics beacon — the top of the launch demand-experiment funnel.
//
//  visitor ─▶ page_view ──┐
//    ▶ demo_play/complete │  fetch(keepalive)      vercel.json rewrite      PostHog
//    ▶ pricing_view (IO)  ├──▶ POST /i/capture/ ─▶ /i/capture/ → ingest ─▶ (same project
//    ▶ benchmarks_footer_ │    first-party         MUST precede the SPA     as the server
//      click              │    no cookies          catch-all /((?!.*\.).*)  funnel)
//  /downloads page_view   │
//    ▶ download_click ────┘                                                    ▲
//  desktop ▶ workspace.created → task.created → task.accepted ─────────────────┘
//           (packages/control-api/src/analytics.ts — untouched)  aggregate correlation
//
// Event-level ONLY, mirroring the server module's contract: no autocapture, no cookies,
// no PII, no session recording. distinct_id is sessionStorage-scoped — stable within a
// visit, gone after — so launch metrics read as per-visit ratios by design.
// Silent by contract: analytics must never break or slow the page; every path no-ops on
// failure. Missing key → hard no-op (vite.config makes that LOUD at production build).

export type Send = (url: string, body: string) => void;

const KEY = (import.meta.env.VITE_PH_KEY ?? '') as string;
const INGEST = '/i/capture/';

/** Visit-scoped id. Private-mode Safari throws on storage access — fall back to a
 *  per-load id rather than ever surfacing an error. */
export function makeDistinctId(store: Pick<Storage, 'getItem' | 'setItem'> | null, rand: () => string): string {
  try {
    if (store) {
      const k = 'nm_ph_id';
      const cur = store.getItem(k);
      if (cur) return cur;
      const id = rand();
      store.setItem(k, id);
      return id;
    }
  } catch { /* storage unavailable — per-load id below */ }
  return rand();
}

/** PostHog /capture/ body — the unit-testable core (shape is the data contract).
 *  Deliberately NO client `timestamp`: PostHog stamps arrival server-side, and client
 *  clocks skew by minutes-to-years — a skewed timestamp mis-buckets launch-hour events. */
export function buildPayload(key: string, event: string, distinctId: string, props?: Record<string, unknown>): string {
  return JSON.stringify({ api_key: key, event, distinct_id: distinctId, properties: { ...props } });
}

/** demo_complete fires at `ended` or ≥90% watched. */
export function shouldComplete(currentTime: number, duration: number): boolean {
  return duration > 0 && currentTime / duration >= 0.9;
}

export function createAnalytics(opts: { key: string; send: Send; id: string }) {
  const seen = new Set<string>();
  const track = (event: string, props?: Record<string, unknown>): void => {
    if (!opts.key) return;
    try { opts.send(INGEST, buildPayload(opts.key, event, opts.id, props)); } catch { /* never break the page */ }
  };
  const trackOnce = (event: string, props?: Record<string, unknown>): void => {
    if (seen.has(event)) return;
    seen.add(event);
    track(event, props);
  };
  return { track, trackOnce };
}

function safeSessionStorage(): Storage | null {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
}
const rand = (): string => {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};
// keepalive: the download_click / benchmarks_footer_click beacons must survive navigation.
// credentials:'omit' — same-origin fetch sends cookies by default, and signed-in visitors
// carry Clerk cookies on this domain; the /i/* rewrite would forward them to the analytics
// ingest and silently break the "no cookies" contract. no-referrer for the same reason.
export const defaultSend: Send = (url, body) => {
  void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'omit', referrerPolicy: 'no-referrer' }).catch(() => {});
};

const singleton = createAnalytics({ key: KEY, send: defaultSend, id: makeDistinctId(safeSessionStorage(), rand) });
export const track = singleton.track;
export const trackOnce = singleton.trackOnce;
