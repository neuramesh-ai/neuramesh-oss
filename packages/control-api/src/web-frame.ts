// GET /v1/web/frame — may the web client show this page in its side panel? (models-and-replies
// round, plan §3). The browser pane on the web is an iframe, and a site that forbids embedding
// paints the browser's own error page, which a cross-origin frame never lets the client read. The
// server can read why: X-Frame-Options and CSP frame-ancestors. So the pane asks first, and a site
// that refuses gets the honest card (open it in a new tab) instead of a broken page.
//
// The fetch rides siteread.ts's guards: a named public host, every redirect hop re-checked, one
// clock. Headers only: the body is cancelled unread. A verdict is per host and origin, cached.
import type { Actor } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import { fetchPublic, normalizeSiteUrl } from './siteread';

export interface FrameVerdict {
  frameable: boolean;
  /** why a page cannot be framed: the header that says so, or that the server could not read it */
  reason?: 'x-frame-options' | 'frame-ancestors' | 'unreachable' | 'bad-url';
  /** the page's Cross-Origin-Resource-Policy: a browser with no credentialless frames needs `cross-origin` */
  corp?: string | null;
}

/** one CSP source expression against the origin that would frame the page */
function sourceAllows(src: string, origin: URL): boolean {
  const s = src.toLowerCase();
  if (s === '*') return true;
  if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return s === origin.protocol;
  const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:\s]+)(?::(\d+|\*))?/.exec(s);
  if (!m || s.startsWith("'")) return false; // 'self' names the page's own origin, never ours
  const [, scheme, wild, host = '', port] = m;
  if (scheme && `${scheme}:` !== origin.protocol) return false;
  if (!(wild ? origin.hostname.endsWith(`.${host}`) : origin.hostname === host)) return false;
  const ours = origin.port || (origin.protocol === 'https:' ? '443' : '80');
  return !port || port === '*' || port === ours;
}

/** pure: may `origin` frame a page that answered with these headers? frame-ancestors wins over
 *  X-Frame-Options when both are present, because that is what browsers do */
export function frameVerdict(headers: { get(name: string): string | null }, origin: string): FrameVerdict {
  const corp = headers.get('cross-origin-resource-policy')?.trim().toLowerCase() || null;
  let at: URL;
  try { at = new URL(origin); } catch { return { frameable: false, reason: 'bad-url', corp }; }
  const directive = (headers.get('content-security-policy') ?? '')
    .split(/[,;]/).map((d) => d.trim()).find((d) => /^frame-ancestors(\s|$)/i.test(d));
  if (directive) {
    const sources = directive.split(/\s+/).slice(1);
    return sources.some((src) => sourceAllows(src, at)) ? { frameable: true, corp } : { frameable: false, reason: 'frame-ancestors', corp };
  }
  const xfo = headers.get('x-frame-options')?.trim().toLowerCase() ?? '';
  if (xfo === 'deny' || xfo === 'sameorigin') return { frameable: false, reason: 'x-frame-options', corp };
  return { frameable: true, corp };
}

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; verdict: FrameVerdict }>();

export async function checkFrame(raw: string, origin: string, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<FrameVerdict> {
  let url: URL;
  try { url = normalizeSiteUrl(raw); } catch { return { frameable: false, reason: 'bad-url' }; }
  const key = `${url.host}|${origin}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.verdict;
  let verdict: FrameVerdict;
  try {
    const { res } = await fetchPublic(url, fetchFn, AbortSignal.timeout(6000), 'text/html,*/*;q=0.8');
    await res.body?.cancel().catch(() => undefined);
    verdict = frameVerdict(res.headers, origin);
  } catch {
    // the server could not reach the site, which says nothing about frames: let the pane try
    verdict = { frameable: true, reason: 'unreachable' };
  }
  cache.set(key, { at: now, verdict });
  return verdict;
}

export function webFrameRoute<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>): void {
  app.get('/v1/web/frame', async (c) => {
    const url = c.req.query('url') ?? '';
    const origin = c.req.query('origin') ?? '';
    if (!url || !origin) return c.json({ error: 'url and origin are required', code: 'INVALID_INPUT' }, 400);
    return c.json(await checkFrame(url, origin));
  });
}
