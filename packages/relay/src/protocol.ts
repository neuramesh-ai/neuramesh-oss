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
// edge messages — relay handshakes, consumed by the relay, never forwarded:
//
//   { t: 'hello', machineId }          machine→relay, first message after header auth
//                                      (`authorization: Bearer nmm_…` on the upgrade)
//   { t: 'attach', machineId, token }  client→relay, first message; token = clerk bearer
//                                      (a message, not a URL param — credentials never
//                                      ride query strings)
//   { t: 'attached', machineId }       relay→client: attach accepted, frames may flow
//
// `ch` is minted by the client (one per pty session) and owned by the client that first
// opens it; the relay routes machine frames back by that ownership and drops the rest.

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
} as const;

export type FrameType = 'data' | 'open' | 'close' | 'resize';
export type ChannelLane = 'terminal' | 'engineering';

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
}

export type EdgeMessage =
  | { t: 'hello'; machineId: string }
  | { t: 'attach'; machineId: string; token: string }
  | { t: 'attached'; machineId: string };

export type RelayMessage = ChannelFrame | EdgeMessage;

const FRAME_TYPES: ReadonlySet<string> = new Set(['data', 'open', 'close', 'resize']);
export const MAX_CHANNEL_DATA_B64_CHARS = 512 * 1024;

export function isChannelFrame(m: RelayMessage): m is ChannelFrame {
  if (!('ch' in m) || typeof m.ch !== 'string' || !m.ch.length || m.ch.length > 200 || !FRAME_TYPES.has(m.t)) return false;
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
  if (FRAME_TYPES.has(m['t'])) {
    const frame = m as unknown as ChannelFrame;
    return isChannelFrame(frame) ? frame : null;
  }
  if (m['t'] === 'hello') {
    return typeof m['machineId'] === 'string' ? { t: 'hello', machineId: m['machineId'] } : null;
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
