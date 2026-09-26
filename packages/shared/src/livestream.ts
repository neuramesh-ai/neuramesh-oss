// THE STREAM LANE'S WIRE (web stream lane prototype, 2026-09-24): what a machine sends a browser
// so an agent's reply types into the thread while it is written, the way it does on the desktop.
//
// The desktop gets its live bubble over IPC: emitStream (apps/desktop/src/main/agents.ts) hands the
// renderer the WHOLE growing text on every token burst. A browser has no IPC to a machine, so the
// bytes ride nm-relay's JSON lane instead, and there the whole-text shape stops being free: a reply
// of n characters sent whole at every update costs O(n²) bytes. So the lane carries DELTAS — keep
// the first `keep` characters of what you hold, then append `add` — plus a full `snap` whenever a
// subscriber arrives mid-reply or loses its place.
//
// Pure: no sockets, no timers, no Buffer. The machine edge (node) and the browser bridge both
// import it, and so can the phone.

/** the relay lane name (packages/relay ChannelLane) */
export const LIVE_STREAM_LANE = 'stream' as const;

/** the OPEN meta a subscriber sends. Versioned so a machine can refuse a wire it does not speak. */
export interface LiveStreamOpenMeta { v: 1 }
export const isLiveStreamOpenMeta = (m: unknown): m is LiveStreamOpenMeta =>
  typeof m === 'object' && m !== null && (m as Record<string, unknown>)['v'] === 1;

/**
 * machine → browser, one JSON object per line.
 *
 *   k   the surface key, `${channelId}:${taskOrThreadId ?? ''}` — the desktop's IPC key, unchanged
 *   a   the agent's name (the renderer resolves avatars and roles by name, as it does over IPC)
 *   e   the epoch: one per stream opening on a key, so a delta from the last wake can never
 *       land on the next one
 *   s   the sequence number inside the epoch; a gap is the one signal a subscriber needs to ask
 *       for a `snap`
 *   at  the machine's wall clock when the frame was cut (ms). Diagnostic only: it measures lag
 *       where the clocks agree, and means nothing where they do not
 */
export type LiveFrame =
  | { t: 'snap'; k: string; a: string; e: string; s: number; text: string; at: number }
  | { t: 'd'; k: string; a: string; e: string; s: number; keep: number; add: string; at: number }
  | { t: 'end'; k: string; a: string; e: string; s: number; at: number }
  /** after the attach snapshots and after every resync: the keys live on this machine NOW. A
   *  subscriber drops (lands) any key it holds from this machine that is not in the list — the
   *  stream ended while it was away. */
  | { t: 'live'; keys: string[] }
  /** proof of life every LIVE_HEARTBEAT_MS, so a half-open socket is found by silence */
  | { t: 'hb'; at: number };

/** browser → machine */
export type LiveRequest = { t: 'resync'; k: string };

/** at most this many frames per key per second leave a machine (coalesced, never dropped) */
export const LIVE_MAX_FPS = 30;
export const LIVE_MIN_FRAME_MS = Math.ceil(1000 / LIVE_MAX_FPS);
/** a key stops growing on the wire past this; the synced message still lands whole */
export const LIVE_MAX_CHARS = 200_000;
export const LIVE_HEARTBEAT_MS = 20_000;
/** no frame for this long = the path is dead, whatever the socket says (docs/42 §3) */
export const LIVE_SILENCE_MS = 50_000;

const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

/** the delta that turns `prev` into `next`: keep a common prefix, append the rest. The prefix never
 *  ends between the two halves of a surrogate pair, so `add` is always well-formed UTF-16. */
export function liveDelta(prev: string, next: string): { keep: number; add: string } {
  const max = Math.min(prev.length, next.length);
  let keep = 0;
  while (keep < max && prev.charCodeAt(keep) === next.charCodeAt(keep)) keep += 1;
  if (keep > 0 && keep < next.length && isHigh(next.charCodeAt(keep - 1))) keep -= 1;
  return { keep, add: next.slice(keep) };
}

/** what a subscriber holds for one key */
export interface LiveKeyState { a: string; e: string; s: number; text: string }

export type LiveStep =
  /** apply: the new state (the text changed or a new epoch began) */
  | { kind: 'state'; state: LiveKeyState }
  /** the frame does not follow what is held: ask the machine for a `snap`, keep what is held */
  | { kind: 'resync' }
  /** the stream on this key ended (the synced message lands next) */
  | { kind: 'end' }
  /** nothing to do (a stale frame from an epoch already replaced) */
  | { kind: 'none' };

/** one keyed frame against what is held for its key. Pure; the caller owns the map. */
export function applyLiveFrame(cur: LiveKeyState | undefined, f: Extract<LiveFrame, { k: string }>): LiveStep {
  if (f.t === 'snap') return { kind: 'state', state: { a: f.a, e: f.e, s: f.s, text: f.text } };
  if (f.t === 'end') return cur && cur.e === f.e ? { kind: 'end' } : { kind: 'none' };
  // a new epoch may start from nothing: its first delta keeps nothing
  if (!cur || cur.e !== f.e) {
    return f.s === 1 && f.keep === 0 ? { kind: 'state', state: { a: f.a, e: f.e, s: 1, text: f.add } } : { kind: 'resync' };
  }
  if (f.s <= cur.s) return { kind: 'none' }; // a duplicate after a resync
  if (f.s !== cur.s + 1 || f.keep > cur.text.length) return { kind: 'resync' };
  return { kind: 'state', state: { a: f.a, e: f.e, s: f.s, text: cur.text.slice(0, f.keep) + f.add } };
}

/** parse one line from the wire; null = not a frame this version speaks */
export function parseLiveFrame(line: string): LiveFrame | null {
  let v: unknown;
  try { v = JSON.parse(line); } catch { return null; }
  return liveFrameOf(v);
}

/** a decoded JSON value as a frame, or null (the relay client hands over parsed lines) */
export function liveFrameOf(v: unknown): LiveFrame | null {
  if (typeof v !== 'object' || v === null) return null;
  const f = v as Record<string, unknown>;
  const keyed = typeof f['k'] === 'string' && typeof f['a'] === 'string' && typeof f['e'] === 'string' && typeof f['s'] === 'number';
  switch (f['t']) {
    case 'snap': return keyed && typeof f['text'] === 'string' ? (f as unknown as LiveFrame) : null;
    case 'd': return keyed && typeof f['keep'] === 'number' && f['keep'] >= 0 && typeof f['add'] === 'string' ? (f as unknown as LiveFrame) : null;
    case 'end': return keyed ? (f as unknown as LiveFrame) : null;
    case 'live': return Array.isArray(f['keys']) && f['keys'].every((k) => typeof k === 'string') ? (f as unknown as LiveFrame) : null;
    case 'hb': return { t: 'hb', at: typeof f['at'] === 'number' ? f['at'] : 0 };
    default: return null;
  }
}

/** the surface a key names: a room's own feed (`${channel}:`), or one task or conversation thread */
export function liveKeySurface(key: string): { channelId: string; subjectId: string | null } | null {
  const i = key.indexOf(':');
  if (i <= 0) return null;
  const rest = key.slice(i + 1);
  return { channelId: key.slice(0, i), subjectId: rest || null };
}
