// A SERVER FETCH ON SOMEONE ELSE'S URL (R10 lane A, NM-089 + NM-115, 2026-11-09).
//
// The TikTok media proxy and the X media pull fetched a URL a member or an agent wrote on a draft,
// checking only the literal hostname, then followed redirects blindly: a public host that 302s to
// http://169.254.169.254/ or a 10.x service (Cloud SQL's private address, the worker pool, the relay)
// passed, and so did any name that RESOLVES to one. The bytes came back through our own domain.
//
// safeFetch: https only (http only where a caller allows it), every hop's host resolved and refused
// if ANY address is loopback, private, link-local, CGNAT, ULA, multicast or reserved, redirects
// followed by hand (each hop re-checked), and the body streamed under a byte cap that aborts. The
// remaining gap is DNS rebinding between our lookup and fetch's own connect (closing it needs a
// connect-time lookup hook, i.e. an undici Agent, which this package does not depend on); the
// redirect and resolution holes, the ones the review exercised, are closed.
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** the real fetch, as this module first saw it: an injected or stubbed fetch makes no connection, so
 *  the address guard (which needs DNS) runs only in front of this one */
const nativeFetch = globalThis.fetch;

export class SafeFetchError extends Error {
  constructor(readonly code: 'BAD_URL' | 'PRIVATE_ADDRESS' | 'TOO_MANY_REDIRECTS' | 'TOO_LARGE' | 'FETCH_FAILED', message: string) { super(message); }
}

const v4 = (ip: string): number[] => ip.split('.').map(Number);
/** the eight groups of an IPv6 address, with `::` and a dotted tail expanded; null = not one */
function v6groups(ip: string): number[] | null {
  let x = ip.toLowerCase();
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(x);
  if (dotted) x = `${dotted[1]}${((Number(dotted[2]) << 8) | Number(dotted[3])).toString(16)}:${((Number(dotted[4]) << 8) | Number(dotted[5])).toString(16)}`;
  const [head = '', tail, more] = x.split('::');
  if (more !== undefined) return null;
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array<string>(8 - a.length - b.length).fill('0');
  const groups = [...a, ...fill, ...b].map((g) => Number.parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}
/** may a server connect to this address on a stranger's word? */
export function publicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a = 0, b = 0] = v4(ip);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this-net, private, loopback, multicast + reserved
    if (a === 169 && b === 254) return false; // link-local (the metadata server)
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 192 && b === 0 && v4(ip)[2] === 0) return false; // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    return true;
  }
  if (kind === 6) {
    const x = ip.toLowerCase();
    if (x === '::' || x === '::1') return false;
    // AN IPv4 ADDRESS INSIDE AN IPv6 ONE IS JUDGED AS THE IPv4 ADDRESS, in each spelling. `new URL` turns
    // [::ffff:169.254.169.254] into ::ffff:a9fe:a9fe, and only the dotted spelling was read (the
    // security lane's review, 2026-11-13). mapped (::ffff:a.b.c.d), translated (::ffff:0:a.b.c.d) and
    // the old compatible form (::a.b.c.d) all carry the address in the last two groups.
    const g = v6groups(x);
    if (!g) return false;
    const [g0, g1, g2, g3, g4, g5, g6 = 0, g7 = 0] = g;
    const embedded = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && ((g4 === 0 && (g5 === 0xffff || g5 === 0)) || (g4 === 0xffff && g5 === 0));
    if (embedded) return publicAddress(`${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`);
    if (/^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x)) return false; // ULA, link-local, multicast
    if (x.startsWith('64:ff9b:') || x.startsWith('2001:db8')) return false; // NAT64, documentation
    return true;
  }
  return false;
}

type Lookup = (host: string) => Promise<string[]>;
const systemLookup: Lookup = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** every address the host names must be public; a literal address is judged as it stands. With no
 *  lookup (an injected fetch) a NAME is not resolved, but a literal address and a local name still are judged */
export async function assertPublicHost(hostname: string, lookup: Lookup | null = systemLookup): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || /\.(localhost|local|internal|home\.arpa)$/i.test(host)) throw new SafeFetchError('PRIVATE_ADDRESS', 'the address must be public');
  if (!isIP(host) && !lookup) return;
  const addresses = isIP(host) ? [host] : await lookup!(host).catch(() => { throw new SafeFetchError('FETCH_FAILED', `${host} did not resolve`); });
  if (!addresses.length || addresses.some((a) => !publicAddress(a))) throw new SafeFetchError('PRIVATE_ADDRESS', 'the address must be public');
}

export interface SafeFetchOpts {
  fetchFn?: typeof fetch;
  /** null = no address guard (an injected fetch, which connects nowhere) */
  lookup?: Lookup | null;
  maxBytes: number;
  timeoutMs?: number;
  maxHops?: number;
  allowHttp?: boolean;
  headers?: Record<string, string>;
}

export async function safeFetch(url: string, opts: SafeFetchOpts): Promise<{ status: number; headers: Headers; bytes: Buffer; url: string }> {
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const lookup = opts.lookup === undefined ? (fetchFn === nativeFetch ? systemLookup : null) : opts.lookup;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  let cur = url;
  for (let hop = 0; hop <= (opts.maxHops ?? 3); hop++) {
    let u: URL;
    try { u = new URL(cur); } catch { throw new SafeFetchError('BAD_URL', 'not a valid url'); }
    if (u.protocol !== 'https:' && !(opts.allowHttp && u.protocol === 'http:')) throw new SafeFetchError('BAD_URL', 'the url must be https');
    if (u.username || u.password) throw new SafeFetchError('BAD_URL', 'the url must not carry a login');
    await assertPublicHost(u.hostname, lookup);
    const res = await fetchFn(u.toString(), { signal, redirect: 'manual', ...(opts.headers ? { headers: opts.headers } : {}) })
      .catch((e: unknown) => { throw new SafeFetchError('FETCH_FAILED', e instanceof Error ? e.message : 'fetch failed'); });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined);
      cur = new URL(location, u).toString();
      continue;
    }
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > opts.maxBytes) { await res.body?.cancel().catch(() => undefined); throw new SafeFetchError('TOO_LARGE', 'too large'); }
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = res.body?.getReader();
    // a fetch that hands back no stream (a test double, an old polyfill) is read whole, then capped
    if (!reader) {
      const whole = Buffer.from(await res.arrayBuffer());
      if (whole.length > opts.maxBytes) throw new SafeFetchError('TOO_LARGE', 'too large');
      return { status: res.status, headers: res.headers, bytes: whole, url: u.toString() };
    }
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > opts.maxBytes) { await reader.cancel().catch(() => undefined); throw new SafeFetchError('TOO_LARGE', 'too large'); }
      chunks.push(Buffer.from(value));
    }
    return { status: res.status, headers: res.headers, bytes: Buffer.concat(chunks), url: u.toString() };
  }
  throw new SafeFetchError('TOO_MANY_REDIRECTS', 'too many redirects');
}
