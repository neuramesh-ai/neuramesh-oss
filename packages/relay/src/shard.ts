// WHICH RELAY SHARD A MACHINE LIVES ON (gate A2, 2026-10). One relay instance holds every socket of
// the machines it serves, because a machine and its browser must meet on the same in-memory hub. One
// instance caps out at about a thousand sockets, so the relay runs as N services, the shards, and a
// machine always meets its browsers on the same one. This file is the ONE rule for "which one". The
// fleet stamps it on each machine's pool, the browser client dials by it, the hub refuses by it, and
// the live check picks by it. If two of them computed it apart, a browser would wait on a shard that
// never sees its machine, so they all import this file and test vectors pin its output.
//
// Rendezvous (highest random weight) hashing over the shard INDEXES. Each shard scores the machine id,
// and the highest score wins. Adding shard N moves only the machines that shard N now outscores,
// about 1/(N+1) of them, and each of them moves to the new shard. The score keys on the index, not on
// the URL, because one Cloud Run service answers on two URLs and a list may name either: the shard
// list is in shard ORDER, and the order is what every side must agree on.
//
// NO IMPORTS, NO NODE, NO DOM. This file runs in the hub, in the fleet, in a browser bundle, in the
// phone, and under plain `node` (scripts/e2e-cloudrun/relay-terminal.mjs imports it with Node's type
// stripping), so it stays erasable TypeScript with no dependency at all.

/** the hub's refusal of a socket that dialled the wrong shard: the reason names the right one
 *  (wrongShardReason). 4421 after HTTP 421 Misdirected Request. */
export const WRONG_SHARD_CLOSE = 4421;
/** a WebSocket close reason is at most 123 bytes of UTF-8 */
const MAX_CLOSE_REASON_BYTES = 123;

/** the UTF-8 bytes of a string, by hand: TextEncoder is not in every runtime this file runs in */
function utf8(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

/** shard `index`'s score for a machine: FNV-1a (32 bit) over `<index>:<machineId>`, then murmur3's
 *  finalizer. FNV alone leaves keys that differ in one character too close for a fair split */
export function shardScore(machineId: string, index: number): number {
  let h = 0x811c9dc5;
  for (const b of utf8(`${index}:${machineId}`)) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** the shard of a machine among `count` shards: the highest score, the lower index on a tie */
export function shardIndexFor(machineId: string, count: number): number {
  if (!(count > 1)) return 0;
  let best = 0;
  let bestScore = shardScore(machineId, 0);
  for (let i = 1; i < count; i += 1) {
    const s = shardScore(machineId, i);
    if (s > bestScore) { best = i; bestScore = s; }
  }
  return best;
}

/** a shard list from its setting: a comma list in shard order. One URL is the list of one (N=1).
 *  Blanks go, and so does a trailing slash, so `wss://a/, wss://b` is two shards */
export function parseRelayShards(raw: string | readonly string[] | null | undefined): string[] {
  const parts = typeof raw === 'string' ? raw.split(',') : [...(raw ?? [])];
  return parts.map((s) => s.trim().replace(/\/+$/, '')).filter((s) => s.length > 0);
}

/** the relay URL a machine's sockets use: its shard's entry in the list. '' for an empty list */
export function shardUrlFor(raw: string | readonly string[] | null | undefined, machineId: string): string {
  const list = parseRelayShards(raw);
  return list[shardIndexFor(machineId, list.length)] ?? '';
}

/** the close reason of a wrong-shard refusal: `shard <k>/<n> <url>`. The URL is left out when it
 *  would not fit in a close frame, and a client then takes entry k of its own list */
export function wrongShardReason(index: number, count: number, url: string): string {
  const full = `shard ${index}/${count} ${url}`;
  return url && utf8(full).length <= MAX_CLOSE_REASON_BYTES ? full : `shard ${index}/${count}`;
}

export interface WrongShard { index: number; count: number; url: string | null }

export function parseWrongShard(reason: string | null | undefined): WrongShard | null {
  const m = /^shard (\d+)\/(\d+)(?: (\S+))?$/.exec((reason ?? '').trim());
  if (!m) return null;
  const index = Number(m[1]);
  const count = Number(m[2]);
  if (!(index < count)) return null;
  return { index, count, url: m[3] ?? null };
}

/** WHERE A REFUSED SOCKET DIALS NEXT: the URL the refusal names, else entry k of this side's own list
 *  when the two lists have the same length. null = nowhere: the refusal is final.
 *
 *  The named URL is trusted because only the relay can send this close (inside TLS), and a relay
 *  already sees every frame. It must still keep the scheme that was dialled, so a refusal can never
 *  move a wss: socket to plain ws:, and it must be a different URL, so two refusals cannot loop. */
export function wrongShardTarget(reason: string | null | undefined, list: readonly string[], dialled: string): string | null {
  const w = parseWrongShard(reason);
  if (!w) return null;
  const named = w.url ?? (list.length === w.count ? list[w.index] ?? null : null);
  if (!named) return null;
  // the scheme by pattern, not by `new URL`: the phone's URL class is partial
  const scheme = (u: string): string | null => /^([a-z][a-z0-9+.-]*):\/\/[^/\s]/i.exec(u)?.[1]?.toLowerCase() ?? null;
  const want = scheme(dialled);
  if (!want || scheme(named) !== want) return null;
  const clean = named.replace(/\/+$/, '');
  return clean === dialled.replace(/\/+$/, '') ? null : clean;
}
