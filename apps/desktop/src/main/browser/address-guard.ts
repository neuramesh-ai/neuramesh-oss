// the address guard (models-and-replies round, board C3): where the machine's browsers may go.
//
// a cloud machine sits inside the cluster. a page that could reach a private address could read the
// metadata server (169.254.169.254 hands out the node's credentials), another pod, or a service on
// the machine itself. so both browsers, the person's and the agents', reach the web only through the
// egress proxy (egress-proxy.ts), and the proxy asks this module about every connection. the check
// reads the address a name resolves to, and the proxy then connects to that same address, so a name
// that answers a public address to the check and a private one to the connection (DNS rebinding)
// cannot slip past. the platform's egress floor (docs/design/machine-hardening-2026-09) is the
// boundary under this, not a substitute for it.
import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

export type Lookup = (host: string) => Promise<Array<{ address: string; family: number }>>;
export type Resolved = { ok: true; address: string; family: number } | { ok: false; reason: string };

// `.local` covers *.svc.cluster.local and mDNS names, `.internal` covers metadata.google.internal
const BLOCKED_NAMES = [/^localhost$/, /\.localhost$/, /\.internal$/, /\.local$/, /^metadata$/];

const v4num = (ip: string): number => ip.split('.').reduce((n, part) => (n * 256) + Number(part), 0);
const V4_BLOCKED: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

/** this-network, private, shared (CGNAT), loopback, link-local (the metadata server), benchmark,
 *  multicast and reserved IPv4 ranges */
export function privateV4(ip: string): boolean {
  const n = v4num(ip);
  return V4_BLOCKED.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(v4num(base) / 2 ** (32 - bits)));
}

/** the eight groups of an IPv6 address, read from its WHATWG form (which writes an embedded IPv4
 *  tail as hex), or null for an address the URL parser refuses, a zone id included */
function hextets(ip: string): number[] | null {
  let canon: string;
  try { canon = new URL(`http://[${ip.replace(/^\[|\]$/g, '')}]/`).hostname.slice(1, -1); } catch { return null; }
  const halves = canon.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length > 1 ? [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail] : head;
  return groups.length === 8 ? groups.map((g) => parseInt(g, 16)) : null;
}

/** loopback, unspecified, unique-local (fc00::/7), link-local, site-local and multicast IPv6, and
 *  every form that carries an IPv4 address inside it (mapped, compatible, NAT64, 6to4) when that
 *  IPv4 address is private */
export function privateV6(ip: string): boolean {
  const h = hextets(ip);
  if (!h) return true; // an address this guard cannot read is refused, never guessed
  const v4 = (hi: number, lo: number): string => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const zero = (from: number, to: number): boolean => h.slice(from, to).every((x) => x === 0);
  if (zero(0, 6)) return privateV4(v4(h[6]!, h[7]!)); // ::/96, which holds :: and ::1
  if (zero(0, 5) && h[5] === 0xffff) return privateV4(v4(h[6]!, h[7]!));
  if (h[0] === 0x64 && h[1] === 0xff9b && zero(2, 6)) return privateV4(v4(h[6]!, h[7]!));
  if (h[0] === 0x2002) return privateV4(v4(h[1]!, h[2]!));
  return (h[0]! & 0xfe00) === 0xfc00 || (h[0]! & 0xffc0) === 0xfe80 || (h[0]! & 0xffc0) === 0xfec0 || (h[0]! & 0xff00) === 0xff00;
}

export function privateAddress(ip: string): boolean {
  const family = isIP(ip);
  return family === 4 ? privateV4(ip) : family === 6 ? privateV6(ip) : true;
}

/** a host as it arrives: lowercased, without IPv6 brackets or a trailing dot */
export const normalHost = (host: string): string => host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

/** why a name or a literal address is refused before any lookup, or null */
export function refusedHost(host: string): string | null {
  const h = normalHost(host);
  if (!h) return 'the address has no host';
  if (isIP(h)) return privateAddress(h) ? `${h} is a private or local address` : null;
  return BLOCKED_NAMES.some((re) => re.test(h)) ? `${h} is a private or local name` : null;
}

/** the check every navigation and every agent call runs first: a web scheme, no user name or
 *  password in the address, and a host that is not refused on its face */
export function checkUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: 'that is not a web address' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: `${url.protocol.replace(/:$/, '')} addresses are refused, only http and https open` };
  if (url.username || url.password) return { ok: false, reason: 'an address with a user name or a password in it is refused' };
  const why = refusedHost(url.hostname);
  return why ? { ok: false, reason: why } : { ok: true, url };
}

const systemLookup: Lookup = (host) => dnsLookup(host, { all: true, verbatim: true });

/** resolve a host and check every address it names. one private answer refuses the whole name,
 *  because a resolver may hand the next connection any of them. the answer names the address to
 *  connect to, which is the one the check read */
export async function resolveAllowed(host: string, lookup: Lookup = systemLookup): Promise<Resolved> {
  const h = normalHost(host);
  const literal = refusedHost(h);
  if (literal) return { ok: false, reason: literal };
  if (isIP(h)) return { ok: true, address: h, family: isIP(h) };
  let answers: Array<{ address: string; family: number }>;
  try { answers = await lookup(h); } catch { return { ok: false, reason: `${h} does not resolve` }; }
  if (!answers.length) return { ok: false, reason: `${h} does not resolve` };
  if (answers.some((a) => privateAddress(a.address))) return { ok: false, reason: `${h} resolves to a private or local address` };
  return { ok: true, address: answers[0]!.address, family: answers[0]!.family };
}
