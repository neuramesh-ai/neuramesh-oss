// The server port of the desktop's site read (host/marketing-research.ts siteDesignTokens; plan
// docs/design/release-drafts-2026-09 §4.8, "the website is the brand read"). A stranger's URL is
// the input, so the guards are the point: http(s) only, a named public host (never an address,
// never loopback or link-local), every redirect hop re-checked, one 10 s clock over the whole
// read, 1 MB of HTML and 200 KB per stylesheet. Regex parsing over node: modules, no HTML library.

import { brandTokens, tallyFonts, tallyPalette, type DeclaredBrand as SiteTokens } from '@neuramesh/shared';

export interface SiteRead {
  url: string;
  title: string | null;
  description: string | null;
  /** `#rrggbb`, most frequent first, white/black/greys dropped, at most 8 */
  palette: string[];
  /** what the site DECLARES as its ground, ink and accent (custom properties, theme-color), when it does */
  tokens: SiteTokens;
  /** the first named family of each font stack, most frequent first, at most 4 */
  fonts: string[];
  /** the page's visible copy, headline first, at most 1500 characters */
  voice: string;
  logo: string | null;
  /** the stylesheets that were read, absolute */
  cssUrls: string[];
}

export type SiteReadErrorCode = 'BAD_URL' | 'PRIVATE_HOST' | 'FETCH_FAILED' | 'NOT_HTML';

export class SiteReadError extends Error {
  constructor(readonly code: SiteReadErrorCode, message: string) {
    super(message);
    this.name = 'SiteReadError';
  }
}

export const HTML_CAP = 1_000_000;
export const CSS_CAP = 200_000;
const MAX_SHEETS = 3;
const MAX_HOPS = 3;
const VOICE_CAP = 1500;
const UA = 'NeuraMesh/1.0 (+https://neuramesh.app)';
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©',
  reg: '®', trade: '™', middot: '·', bull: '•',
};

function isPrivateHost(host: string): boolean {
  if (!host) return true;
  const bare = host.startsWith('[') ? host.slice(1, -1) : host;
  // the WHATWG parser already normalized every IPv4 spelling to dotted decimal
  if (/^[\d.]+$/.test(bare) || bare.includes(':')) return true;
  if (bare === 'localhost' || /\.(localhost|local|internal|home\.arpa)$/.test(bare)) return true;
  return !bare.includes('.'); // a single label only resolves on a LAN
}

/** A URL a server may fetch on a stranger's word: http(s), a named public host, no login, no hash. */
export function normalizeSiteUrl(input: string): URL {
  const raw = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new SiteReadError('BAD_URL', 'The website address is not valid.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new SiteReadError('BAD_URL', 'The website address must start with http or https.');
  if (u.username || u.password) throw new SiteReadError('BAD_URL', 'The website address must not carry a login.');
  if (isPrivateHost(u.hostname.toLowerCase())) throw new SiteReadError('PRIVATE_HOST', 'The website must be a public address.');
  u.hash = '';
  return u;
}

// Redirects are followed by hand so each hop faces the same host guard as the first URL.
async function fetchPublic(start: URL, fetchFn: typeof fetch, signal: AbortSignal, accept: string): Promise<{ res: Response; url: URL }> {
  let cur = start;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const res = await fetchFn(cur.toString(), { signal, redirect: 'manual', headers: { accept, 'user-agent': UA } }).catch((e: unknown) => {
      const timedOut = e instanceof Error && e.name === 'TimeoutError';
      throw new SiteReadError('FETCH_FAILED', timedOut ? 'The website did not answer in time.' : 'The website did not answer.');
    });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) return { res, url: cur };
    await res.body?.cancel().catch(() => undefined);
    let next: string;
    try {
      next = new URL(location, cur).toString();
    } catch {
      throw new SiteReadError('FETCH_FAILED', 'The website redirected to an address that is not valid.');
    }
    cur = normalizeSiteUrl(next);
  }
  throw new SiteReadError('FETCH_FAILED', 'The website redirected too many times.');
}

// Bytes, not strings (docs/42): one streaming decoder, so a multi-byte character split across
// chunks survives, and the cap counts bytes on the wire.
async function readCapped(res: Response, cap: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, cap);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value.byteLength > cap - bytes ? value.subarray(0, cap - bytes) : value;
    out += decoder.decode(chunk, { stream: true });
    bytes += chunk.byteLength;
    if (bytes >= cap) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return out + decoder.decode();
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith('#')) {
      const code = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s: string): string => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tags = (html: string, name: string): string[] => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => m[0]);

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null;
}

function metaContent(html: string, keys: string[]): string | null {
  const metas = tags(html, 'meta');
  for (const key of keys) {
    for (const t of metas) {
      const k = (attr(t, 'name') ?? attr(t, 'property') ?? '').toLowerCase();
      const content = k === key ? clean(attr(t, 'content') ?? '') : '';
      if (content) return content;
    }
  }
  return null;
}

function absolute(href: string | null, base: URL, sameOriginOrHttps = false): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (sameOriginOrHttps && u.protocol !== 'https:' && u.origin !== base.origin) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function linkHrefs(html: string, base: URL, rels: string[], sameOriginOrHttps: boolean): string[] {
  const out: string[] = [];
  for (const t of tags(html, 'link')) {
    const tokens = (attr(t, 'rel') ?? '').toLowerCase().split(/\s+/);
    const href = rels.some((r) => tokens.includes(r)) ? absolute(attr(t, 'href'), base, sameOriginOrHttps) : null;
    if (href && !out.includes(href)) out.push(href);
  }
  return out;
}

export { tallyFonts, tallyPalette } from '@neuramesh/shared';

export function voiceOf(html: string): string {
  let body = html.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const t of ['head', 'script', 'style', 'noscript', 'template', 'svg', 'nav', 'footer']) {
    body = body.replace(new RegExp(`<${t}\\b[\\s\\S]*?<\\/${t}\\s*>`, 'gi'), ' ');
  }
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(body);
  const headline = h1 ? clean(h1[1]!) : '';
  if (h1) body = body.replace(h1[0], ' ');
  const text = clean(body);
  return `${headline}${headline && text ? '\n' : ''}${text}`.slice(0, VOICE_CAP);
}

async function readSheet(url: string, fetchFn: typeof fetch, signal: AbortSignal): Promise<string | null> {
  try {
    const { res } = await fetchPublic(normalizeSiteUrl(url), fetchFn, signal, 'text/css,*/*;q=0.5');
    return res.ok ? await readCapped(res, CSS_CAP) : null;
  } catch {
    return null;
  }
}

export async function readSite(url: string, opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {}): Promise<SiteRead> {
  const fetchFn = opts.fetchFn ?? fetch;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
  const { res, url: final } = await fetchPublic(normalizeSiteUrl(url), fetchFn, signal, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
  if (!res.ok) throw new SiteReadError('FETCH_FAILED', `The website answered ${res.status}.`);
  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  if (ct && !ct.includes('html')) throw new SiteReadError('NOT_HTML', 'The website did not answer with a page.');
  const html = await readCapped(res, HTML_CAP);
  if (!ct && !/<(!doctype\s+html|html)\b/i.test(html.slice(0, 2048))) throw new SiteReadError('NOT_HTML', 'The website did not answer with a page.');

  const title = clean(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').slice(0, 200) || metaContent(html, ['og:title']);
  const description = metaContent(html, ['description', 'og:description']);
  const logo = absolute(metaContent(html, ['og:image']), final) ?? linkHrefs(html, final, ['icon', 'apple-touch-icon'], false)[0] ?? null;
  let css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]!).join('\n');
  const cssUrls: string[] = [];
  for (const sheet of linkHrefs(html, final, ['stylesheet'], true).slice(0, MAX_SHEETS)) {
    const body = await readSheet(sheet, fetchFn, signal);
    if (body === null) continue;
    css += `\n${body}`;
    cssUrls.push(sheet);
  }
  return { url: final.toString(), title, description, palette: tallyPalette(css), tokens: brandTokens(css, html), fonts: tallyFonts(css), voice: voiceOf(html), logo, cssUrls };
}
