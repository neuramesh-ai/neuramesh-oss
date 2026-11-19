// nm-relay frame protocol (docs/design/cloud-first-2026-08: architecture §4, plan §3.5).
//
// one JSON envelope per websocket text message, both directions. two vocabularies:
//
// channel frames — the PTY lane, forwarded VERBATIM between a client and its machine
// (the relay reads `ch` to route and nothing else; it never decodes `d`):
//
//   { ch, t: 'open', cols?, rows? }    client→machine: start the pty session `ch` names
//                                      (cols/rows ride along exactly as the desktop's
//                                      nm:terminal-open does today)
//   { ch, t: 'data', d }               either direction: payload bytes, base64 in `d`
//   { ch, t: 'resize', cols, rows }    client→machine: pty resize
//   { ch, t: 'close' }                 either direction: tear down `ch`
//
// RESUME (the session round, 2026-10): a terminal or a Code session outlives the socket that
// carried it. Only between a machine whose hello names the `resume` capability and a client that
// sees it in `attached`; with an older machine or client nothing below is ever sent.
//
//   { ch, t: 'detach' }                relay→machine: the client that held `ch` is gone. The
//                                      session lives on for the machine's grace window, its
//                                      output kept in a bounded buffer (it replaces the `close` a
//                                      departed client used to cost)
//   { ch, t: 'open', resume: true, from } client→machine: take back the session `ch` names. `from`
//                                      is how many bytes of it this client already has. The
//                                      relay hands the channel to a new socket of the same user
//   { ch, t: 'open', resume: true }    relay→machine, no `from`: after a takeover, this channel
//                                      still has its client (the machine reattaches a session it
//                                      detached when its own old socket dropped)
//   { ch, t: 'resumed', o, dropped, from } machine→client: the session is back. Replay starts at byte
//                                      `o`, and `dropped` bytes before it are gone (the buffer
//                                      overflowed while nobody listened). `from` repeats the resume
//                                      it answers. Without `from` it is the machine saying where the
//                                      session stands (its own socket changed): a client that has
//                                      fewer than `o` bytes asks again with its own `from`
//   { ch, t: 'data', d, o }            machine→client: `o` is the byte offset of `d` in the session
//   { ch, t: 'close', reason }         machine→client: a resume found no session, and why
//
// SHARDS (gate A2, 2026-10; shard.ts): the relay runs as N services, and a machine lives on the
// shard that shardIndexFor(machineId, N) names. A socket that dials another shard is refused with
// close 4421 (WRONG_SHARD) and the reason `shard <k>/<n> <url>`, before any credential is checked.
// A client dials the named shard once. A machine whose hello names the `shard` capability is
// refused the same way and follows; an older machine, which cannot follow, is served where it is.
//
// edge messages — relay handshakes, consumed by the relay, never forwarded:
//
//   { t: 'hello', machineId, lanes? }  machine→relay, first message after header auth
//                                      (`authorization: Bearer nmm_…` on the upgrade). `lanes`
//                                      names the lanes this daemon serves; a lane born after the
//                                      field (`stream`, `browser`) is only ever opened on a
//                                      machine that names it, because an older daemon reads any
//                                      unknown lane as a terminal and would spawn a shell for it
//   { t: 'attach', machineId, token }  client→relay, first message; token = clerk bearer
//                                      (a message, not a URL param — credentials never
//                                      ride query strings)
//   { t: 'attached', machineId, lanes? } relay→client: attach accepted, frames may flow. `lanes`
//                                      repeats what the machine's hello named, so a client opens a
//                                      lane born after the field (`stream`) only when it sees it
//                                      here: an older relay sends none, and forwards any lane as-is
//
// `ch` is minted by the client (one per pty session) and owned by the client that first
// opens it; the relay routes machine frames back by that ownership and drops the rest.

import { WRONG_SHARD_CLOSE } from './shard.js';

/** app close codes (4000-range) — the relay's coded refusals, asserted by tests */
export const CLOSE = {
  /** bad or unknown credential, or a hello that contradicts it */
  UNAUTHORIZED: 4401,
  /** authenticated but not a member of the machine's workspace */
  FORBIDDEN: 4403,
  /** attach target has no live machine socket */
  MACHINE_OFFLINE: 4404,
  /** a newer socket announced the same machineId (last-writer-wins) */
  TAKEOVER: 4409,
  /** the machine socket dropped while this client was attached */
  MACHINE_GONE: 4410,
  /** control-api unreachable — try again later (standard 1013) */
  VALIDATE_UNAVAILABLE: 1013,
  /** malformed handshake (standard 1008 policy violation) */
  PROTOCOL: 1008,
  /** a bounded per-socket queue or message size was exceeded (standard 1009) */
  TOO_LARGE: 1009,
  /** the relay process is retiring for a newer revision: redial (standard 1012, rollover.ts) */
  RETIRED: 1012,
  /** a client closing its older socket after it moved every channel to a newer one */
  HANDOVER: 4000,
  /** this machine lives on another relay shard: the reason names it (shard.ts, wrongShardReason) */
  WRONG_SHARD: WRONG_SHARD_CLOSE,
} as const;

export type FrameType = 'data' | 'open' | 'close' | 'resize' | 'detach' | 'resumed';
/** what a machine's hello may name besides its lanes: `resume` = its sessions outlive a socket,
 *  `shard` = it dials the shard a wrong-shard refusal names (so the hub may refuse it) */
export type RelayCapability = 'resume' | 'shard';
/** `stream`: a read-only subscription to the machine's live agent replies (the browser's live
 *  bubble). it is not a session: it has its own caps on both edges and never counts as activity.
 *  `browser`: the machine's Chromium drawn in the web panel (browser-lane.ts, docs/42). screencast
 *  frames go out, input comes in, and it has its own small budget on both edges. */
export type ChannelLane = 'terminal' | 'engineering' | 'stream' | 'browser';

export interface ChannelFrame {
  ch: string;
  t: FrameType;
  /** base64 payload — data frames only */
  d?: string;
  cols?: number;
  rows?: number;
  /** OPEN frames only: what to open. A cloud machine holds the task worktrees, so the
   *  client names the session it wants and the machine edge resolves the path — the
   *  browser has no filesystem to resolve one against. Absent = the machine's default
   *  working directory. */
  cwd?: string;
  taskNumber?: number;
  hasRepo?: boolean;
  /** OPEN frames only. Absent means the original terminal lane. The relay intentionally
   *  treats this as opaque metadata; only the two authenticated edges interpret it. */
  lane?: ChannelLane;
  /** OPEN frames only: lane-specific JSON bootstrap data. Never contains credentials. */
  meta?: Record<string, unknown>;
  /** OPEN frames only: authenticated client identity injected by the hub. */
  actorId?: string;
  /** OPEN frames only: take back a live session instead of starting one (RESUME above) */
  resume?: boolean;
  /** resume OPEN frames: the bytes of the session this client already has. RESUMED frames: the resume they answer */
  from?: number;
  /** machine DATA and RESUMED frames: the byte offset in the session where the payload starts */
  o?: number;
  /** RESUMED frames only: bytes lost before `o` while nobody listened */
  dropped?: number;
  /** machine CLOSE frames only: why a resume found nothing (a sentence the pane can show) */
  reason?: string;
}

/** a machine's hello and the relay's attached name lanes and, beside them, capabilities */
export type MachineLane = ChannelLane | RelayCapability;

export type EdgeMessage =
  | { t: 'registered'; machineId: string }
  | { t: 'hello'; machineId: string; lanes?: MachineLane[]; readinessProtocol?: 1 }
  | { t: 'attach'; machineId: string; token: string }
  | { t: 'attached'; machineId: string; lanes?: MachineLane[] };

export type RelayMessage = ChannelFrame | EdgeMessage;

const FRAME_TYPES: ReadonlySet<string> = new Set(['data', 'open', 'close', 'resize', 'detach', 'resumed']);
/** what a client may send on a channel: `detach` and `resumed` are the relay's and the machine's words */
export const CLIENT_FRAME_TYPES: ReadonlySet<FrameType> = new Set<FrameType>(['data', 'open', 'close', 'resize']);
const LANES: ReadonlySet<string> = new Set(['terminal', 'engineering', 'stream', 'browser', 'resume', 'shard']);
export const MAX_CHANNEL_DATA_B64_CHARS = 512 * 1024;
const offsetOk = (v: unknown): boolean => v === undefined || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0);

export function isChannelFrame(m: RelayMessage): m is ChannelFrame {
  if (!('ch' in m) || typeof m.ch !== 'string' || !m.ch.length || m.ch.length > 200 || !FRAME_TYPES.has(m.t)) return false;
  if (!offsetOk(m.o) || !offsetOk(m.from) || !offsetOk(m.dropped)) return false;
  return m.t !== 'data' || (typeof m.d === 'string' && m.d.length > 0 && m.d.length <= MAX_CHANNEL_DATA_B64_CHARS);
}

/** parse one raw ws message; null = not a message we speak (caller drops or refuses) */
export function parseMessage(raw: string): RelayMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const m = v as Record<string, unknown>;
  if (typeof m['t'] !== 'string') return null;
  if (m['t'] === 'registered') return typeof m['machineId'] === 'string' ? { t: 'registered', machineId: m['machineId'] } : null;
  if (FRAME_TYPES.has(m['t'])) {
    const frame = m as unknown as ChannelFrame;
    return isChannelFrame(frame) ? frame : null;
  }
  if (m['t'] === 'hello') {
    if (typeof m['machineId'] !== 'string') return null;
    const lanes = Array.isArray(m['lanes']) ? (m['lanes'] as unknown[]).filter((l): l is MachineLane => typeof l === 'string' && LANES.has(l)) : undefined;
    return { t: 'hello', machineId: m['machineId'], ...(lanes ? { lanes } : {}), ...(m['readinessProtocol'] === 1 ? { readinessProtocol: 1 as const } : {}) };
  }
  if (m['t'] === 'attach') {
    return typeof m['machineId'] === 'string' && typeof m['token'] === 'string'
      ? { t: 'attach', machineId: m['machineId'], token: m['token'] }
      : null;
  }
  return null;
}

/** base64 helpers for the node-side edges (the browser terminal brings its own) */
export const toB64 = (v: string | Buffer): string => Buffer.from(v).toString('base64');
export const fromB64 = (d: string): Buffer => Buffer.from(d, 'base64');
