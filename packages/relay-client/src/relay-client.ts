// THE BROWSER EDGE OF nm-relay (plan §3.5) — the lane webnm-local.ts was holding open.
//
// A browser cannot reach a machine: machines never listen (outbound-only doctrine) and
// Vercel functions cannot hold a stream. So both sides dial OUT to the relay and it joins
// them. This module is the browser's half of that: one socket per tab, many terminals
// multiplexed over it by `ch`, which is exactly what the protocol was shaped for.
//
// ONE SOCKET, NOT ONE PER TERMINAL. Every pty in the tab shares it. Three reasons, in
// order of how much they would hurt: each socket costs its own attach round-trip to
// control-api (a Clerk verify + a membership read), the relay counts client edges per
// machine, and a per-terminal socket makes "is the relay up?" a question with N answers.
//
// IT NEVER PRETENDS. Every failure path writes a sentence to the pane and then exits,
// because the alternative — the shape this replaced — was a terminal that renders empty
// and reads as a hung shell. See webnm-local.ts for why that rule exists.
//
// A SESSION OUTLIVES ITS SOCKET (the session round, 2026-10; RESUME in @neuramesh/relay protocol.ts).
// On Cloud Run every relay socket ends: the request timeout cuts it at 3600 s, a relay rollout
// retires it (1012), a restart drops it. When the machine names `resume` in `attached`, a dropped
// socket no longer ends a terminal or a Code session. This client dials again, attaches, and takes
// each session back with a resume open that says how many of its bytes the pane already has, and the
// machine replays the rest. A short drop prints nothing, a longer one prints one line. Before the
// relay's cut, this client also replaces its own socket. A live-reply or browser channel is no
// session: it ends with its socket, as before, and whoever opened it opens it again.
//
// THE RELAY IS N SHARDS (gate A2, 2026-10; @neuramesh/relay shard.ts). `relayUrl` may be a comma list
// in shard order, and each machine's socket dials the shard its id hashes to, by the same function the
// fleet stamps on the machine and the hub refuses by. A shard that is not the machine's refuses with
// 4421 and names the right one, and this client dials that one once: that covers a tab whose list is
// older than the relay's.
import { parseRelayShards, shardUrlFor, WRONG_SHARD_CLOSE, wrongShardTarget } from '@neuramesh/relay/shard';
import { b64ToBytes, closeReason, encodeB64, makeByteDecoder, notice } from './relay-frames';
import { joiningUntil, resetJoining } from './machine-joining';
import { waitForRelayCapacity } from './relay-capacity';
export { waitForRelayCapacity } from './relay-capacity';

import type { RelayConfig } from './relay-config';
export type { RelayConfig } from './relay-config';

export const RESUME_WINDOW_MS = 110_000;
export const ROTATE_MS = 50 * 60_000;
/** the line a terminal prints when its socket has been down for a moment (NOTE_AFTER_MS) */
export const RECONNECTING = 'The connection to the machine dropped. Reconnecting...';
/** the line a terminal prints while a machine that just started joins the relay (machine-joining.ts) */
export const RELAY_JOINING = 'Waiting for the machine to join the relay...';
const JOIN_REDIAL_MAX_MS = 4_000;
const RECONNECT_FAILED = 'The connection to the machine dropped and did not come back.';
const CHANNEL_CLOSED = 'The Engineering relay channel is closed.';
const REDIAL_FIRST_MS = 500;
const REDIAL_MAX_MS = 8_000;
// a short drop says nothing: a redial usually attaches within a second
const NOTE_AFTER_MS = 2_000;
const ROTATE_RETRY_MS = 5 * 60_000;
const ROTATE_ATTACH_MS = 30_000;
// the older socket closes a moment after a rotation, once the relay has moved the sessions off it
const RETIRE_AFTER_MS = 3_000;
/** a client closing its older socket after a rotation moved every session off it (CLOSE.HANDOVER) */
const HANDOVER = 4000;
// verdicts, not outages: dialling again cannot change the answer
const FINAL_CODES: ReadonlySet<number> = new Set([4401, 4403, 1008]);
/** closes that are a lost connection, not a verdict, even before the attach (upstream relay-client) */
const ORDINARY_CLOSES: ReadonlySet<number> = new Set([1000, 1001, 1005, 1006]);
/** how many wrong-shard refusals one attach follows. Two shards that each name the other are a broken
 *  rollout, and dialling on would only ping-pong between them */
const MAX_SHARD_HOPS = 1;

type Timer = ReturnType<typeof setTimeout>;

/** a session that can outlive its socket (a terminal, a Code session) and how to take it back */
interface Resume {
  /** the open frame as first sent: a resume sends it again with `resume` and `from` */
  open: Record<string, unknown>;
  /** how many bytes of the session this pane has */
  received: number;
  /** a resume open went out and its `resumed` has not come back. A data frame before it is from
   *  before the resume, and the replay after `resumed` brings its bytes again */
  resuming: boolean;
  /** the `from` that resume open said: its answer repeats it */
  asked: number | null;
  /** the pane was told that the connection dropped */
  noted: boolean;
  /** say that the connection dropped (once, after NOTE_AFTER_MS) */
  note(): void;
  /** the session is back. `lost`: bytes of it this pane will never see */
  back(lost: number, noted: boolean): void;
  /** frames that follow a resume open (the pane's size now) */
  after?(): Array<Record<string, unknown>>;
}

interface Channel {
  onData(d: string): void;
  onExit(): void;
  onError?(message: string): void;
  /** the connection went away for good: a network drop no resume took back, or a resume that gave up.
   *  A refusal (4401/4403/1008) still uses onError. Never called for a drop this client resumes */
  onDisconnect?(message: string): void;
  /** the socket this channel lives on at the relay: frames for it on any other socket are stale */
  sock: WebSocket;
  resume?: Resume;
}

interface Conn {
  machineId: string;
  cfg: RelayConfig;
  /** the shard this machine's sockets dial: its entry in the list, or the one a refusal named */
  url: string;
  /** wrong-shard refusals followed since the last attach: one, then the refusal is final */
  hops: number;
  /** the socket new channels open on */
  sock: WebSocket;
  /** connecting: the first attach is in flight · open · down: the socket dropped and a redial runs ·
   *  closed: given up (no longer in `conns`) */
  state: 'connecting' | 'open' | 'down' | 'closed';
  /** the channels whose open went out */
  channels: Map<string, Channel>;
  decoders: Map<string, (bytes: Uint8Array) => string>;
  engineeringSends: Promise<void>;
  engineeringNextSendAt: number;
  /** the lanes the relay says this machine serves (`attached`). An older relay names none. */
  lanes: ReadonlySet<string>;
  /** who waits for an attached, open socket, and how each pane says it is waiting for the machine to join */
  waiters: Array<{ resolve(): void; reject(error: Error): void; onJoining?(text: string): void }>;
  /** the first attach heard 4404 from a machine that just started, and waits for it to join */
  joinWait: boolean;
  /** the open frames of sessions whose pane closed while the socket was down: the next socket ends them */
  closing: Map<string, Record<string, unknown>>;
  /** older sockets a rotation replaced, open until no live-reply or browser channel is left on them */
  retired: Set<WebSocket>;
  /** a rotation's new socket, until it attaches */
  rotating: WebSocket | null;
  /** attached once: a later drop is a reconnect, not a refusal */
  everOpen: boolean;
  signedOut: boolean;
  downSince: number;
  attempt: number;
  lastReason: string;
  failure: string | null;
  timers: Partial<Record<'redial' | 'note' | 'rotate' | 'rotateWait', Timer>>;
}

// ONE SOCKET PER MACHINE, not one per tab. The attach message names one machine, so a socket can
// only ever reach that one. The single shared `conn` this replaced returned the first machine's
// socket for ANY machine id: a Code session naming a member machine (rule D9) rode the runner's
// socket if a terminal had dialled the runner first, and the stream lane subscribes to every cloud
// machine that may serve the workspace at once.
const conns = new Map<string, Conn>();

/** send if the socket is open; frames minted before `attached` are held by the caller */
const raw = (sock: WebSocket, m: unknown): boolean => {
  if (sock.readyState !== WebSocket.OPEN) return false;
  sock.send(JSON.stringify(m));
  return true;
};

// a pending redial or rotation must not keep a Node test process alive (a browser has no unref)
const unref = (t: unknown): void => { (t as { unref?: () => void } | null)?.unref?.(); };
const clearTimer = (c: Conn, name: keyof Conn['timers']): void => {
  const t = c.timers[name];
  if (t !== undefined) clearTimeout(t);
  delete c.timers[name];
};
const later = (c: Conn, name: keyof Conn['timers'], ms: number, fn: () => void): void => {
  clearTimer(c, name);
  const t = setTimeout(() => { delete c.timers[name]; fn(); }, ms);
  unref(t);
  c.timers[name] = t;
};

/** a dropped socket's sessions wait for the next one: only against a machine that names `resume` */
const canResume = (c: Conn): boolean => c.everOpen && c.lanes.has('resume') && !c.signedOut;

/** resolves once the connection is attached on an open socket, rejects when it gave up. `onJoining`
 *  hears it once while a machine that just started joins the relay */
function whenOpen(c: Conn, onJoining?: (text: string) => void): Promise<void> {
  if (c.state === 'closed') return Promise.reject(new Error(c.failure ?? 'Could not reach the relay.'));
  if (c.state === 'open' && c.sock.readyState === WebSocket.OPEN) return Promise.resolve();
  if (c.joinWait) onJoining?.(RELAY_JOINING);
  return new Promise<void>((resolve, reject) => { c.waiters.push({ resolve, reject, ...(onJoining ? { onJoining } : {}) }); });
}

function connect(cfg: RelayConfig, machineId: string): Conn {
  const held = conns.get(machineId);
  if (held && held.state !== 'closed') return held;
  const c: Conn = {
    machineId, cfg, url: shardUrlFor(cfg.relayUrl, machineId), hops: 0, sock: undefined as unknown as WebSocket, state: 'connecting',
    channels: new Map(), decoders: new Map(), engineeringSends: Promise.resolve(), engineeringNextSendAt: 0,
    lanes: new Set(), waiters: [], joinWait: false, closing: new Map(), retired: new Set(), rotating: null,
    everOpen: false, signedOut: false, downSince: 0, attempt: 0, lastReason: '', failure: null, timers: {},
  };
  // `new WebSocket(url)` throws synchronously on a malformed origin: the caller's try holds that
  c.sock = dial(c, 'dial');
  conns.set(machineId, c);
  return c;
}

/** one socket to the relay for this machine: `dial` becomes the connection's socket, `rotate` replaces it once it attaches */
function dial(c: Conn, role: 'dial' | 'rotate'): WebSocket {
  const sock = new WebSocket(c.url);
  sock.addEventListener('open', () => {
    void c.cfg.clientBearer().then((token) => {
      if (c.state === 'closed') return;
      if (!token) { if (role === 'dial') c.signedOut = true; sock.close(); return; }
      // the credential rides a MESSAGE, never a query string: URLs land in proxy logs
      // and browser history, and this one is a live session token
      raw(sock, { t: 'attach', machineId: c.machineId, token });
    }, () => { sock.close(); });
  });
  sock.addEventListener('message', (ev: MessageEvent<string>) => {
    let m: Record<string, unknown>;
    try { m = JSON.parse(ev.data) as Record<string, unknown>; } catch { return; }
    if (m['t'] === 'attached') {
      const lanes = new Set(Array.isArray(m['lanes']) ? m['lanes'].filter((l): l is string => typeof l === 'string') : []);
      if (role === 'rotate') rotated(c, sock, lanes); else attached(c, sock, lanes);
      return;
    }
    channelFrame(c, sock, m);
  });
  sock.addEventListener('close', (ev: CloseEvent) => socketClosed(c, sock, ev.code, ev.reason));
  sock.addEventListener('error', () => { /* close always follows; it carries the code */ });
  return sock;
}

function attached(c: Conn, sock: WebSocket, lanes: Set<string>): void {
  if (c.state === 'closed' || sock !== c.sock) { try { sock.close(); } catch { /* gone */ } return; }
  const wasDown = c.state === 'down';
  c.state = 'open';
  c.lanes = lanes;
  c.everOpen = true;
  c.attempt = 0;
  c.hops = 0;
  c.joinWait = false;
  clearTimer(c, 'note');
  if (wasDown) resumeAll(c, sock);
  for (const w of c.waiters.splice(0)) w.resolve();
  scheduleRotation(c, false);
}

/** every session on an older socket moves to `sock`: its open again, with how many bytes the pane has */
function resumeAll(c: Conn, sock: WebSocket): void {
  for (const [ch, h] of c.channels) {
    if (!h.resume || h.sock === sock) continue;
    h.sock = sock;
    h.resume.resuming = true;
    h.resume.asked = h.resume.received;
    raw(sock, { ...h.resume.open, resume: true, from: h.resume.received });
    for (const f of h.resume.after?.() ?? []) raw(sock, { ...f, ch });
  }
  // a pane closed while the socket was down: its session is taken back only to be closed, and the
  // offset past its end asks for no replay
  for (const [ch, open] of c.closing) {
    raw(sock, { ...open, resume: true, from: Number.MAX_SAFE_INTEGER });
    raw(sock, { ch, t: 'close' });
  }
  c.closing.clear();
}

/** a rotation's socket attached: the sessions move to it, and the older socket retires */
function rotated(c: Conn, sock: WebSocket, lanes: Set<string>): void {
  if (c.rotating !== sock) { try { sock.close(); } catch { /* gone */ } return; }
  c.rotating = null;
  c.hops = 0;
  clearTimer(c, 'rotateWait');
  // a machine that stopped naming `resume` (an older daemon after a restart) cannot take a session
  // back: the current socket carries on until its cut
  if (c.state !== 'open' || !lanes.has('resume')) {
    try { sock.close(); } catch { /* gone */ }
    scheduleRotation(c, true);
    return;
  }
  const old = c.sock;
  c.sock = sock;
  c.lanes = lanes;
  resumeAll(c, sock);
  // a live-reply or browser channel stays on the older socket and ends at its cut, as before
  c.retired.add(old);
  unref(setTimeout(() => retire(c, old), RETIRE_AFTER_MS));
  scheduleRotation(c, false);
}

/** close a retired socket once no channel is left on it */
function retire(c: Conn, old: WebSocket): void {
  if (!c.retired.has(old)) return;
  for (const h of c.channels.values()) if (h.sock === old) return;
  c.retired.delete(old);
  try { old.close(HANDOVER, 'handover'); } catch { /* gone */ }
}

function scheduleRotation(c: Conn, retry: boolean): void {
  clearTimer(c, 'rotate');
  const every = c.cfg.rotateMs ?? ROTATE_MS;
  if (every <= 0 || !c.lanes.has('resume') || c.state !== 'open') return;
  const wait = retry ? Math.min(ROTATE_RETRY_MS, every) : every;
  later(c, 'rotate', Math.round(wait * (0.9 + Math.random() * 0.2)), () => rotate(c));
}

/** BEFORE THE RELAY'S CUT, A NEW SOCKET. The relay's request timeout ends every socket at 3600 s. This
 *  one dials a second socket, attaches it, and moves every session to it with a resume open, so the
 *  cut finds nothing on the old one. A rotation that fails leaves the current socket as it is */
function rotate(c: Conn): void {
  if (c.state !== 'open' || c.rotating) return;
  let next: WebSocket;
  try { next = dial(c, 'rotate'); } catch { scheduleRotation(c, true); return; }
  c.rotating = next;
  later(c, 'rotateWait', ROTATE_ATTACH_MS, () => {
    if (c.rotating !== next) return;
    c.rotating = null;
    try { next.close(); } catch { /* gone */ }
    scheduleRotation(c, true);
  });
}

/** take a session back on the current socket: a gap showed that bytes went missing */
function askResume(c: Conn, h: Channel): void {
  if (!h.resume || h.resume.resuming || h.sock !== c.sock || c.state !== 'open') return;
  h.resume.resuming = true;
  h.resume.asked = h.resume.received;
  raw(h.sock, { ...h.resume.open, resume: true, from: h.resume.received });
}

function channelFrame(c: Conn, sock: WebSocket, m: Record<string, unknown>): void {
  const ch = typeof m['ch'] === 'string' ? m['ch'] : null;
  if (!ch) return;
  const h = c.channels.get(ch);
  // a frame for a channel we already closed, or for one a resume moved to a newer socket (whose
  // replay brings the same bytes again)
  if (!h || h.sock !== sock) return;
  const r = h.resume;
  if (m['t'] === 'data' && typeof m['d'] === 'string') {
    let bytes = b64ToBytes(m['d']);
    if (r) {
      // A MACHINE THAT RESUMES NAMES THE OFFSET OF EVERY BYTE. A pane keeps each byte once, in order
      if (typeof m['o'] === 'number') {
        if (r.resuming) return;
        // a gap: the bytes before this frame went with a socket that dropped. Take the session back from
        // what the pane has
        if (m['o'] > r.received) { askResume(c, h); return; }
        const seen = r.received - m['o'];
        if (seen >= bytes.length) return;
        bytes = bytes.subarray(seen);
      }
      r.received += bytes.length;
    }
    let dec = c.decoders.get(ch);
    if (!dec) { dec = makeByteDecoder(); c.decoders.set(ch, dec); }
    h.onData(dec(bytes));
  } else if (m['t'] === 'resumed' && r) {
    const o = typeof m['o'] === 'number' ? m['o'] : r.received;
    if (!r.resuming || m['from'] !== r.asked) {
      // not the answer to this pane's resume (that repeats its `from`) but the machine saying where the
      // session stands after its own socket changed: a gap asks for the bytes that went with the old one
      if (!r.resuming && o > r.received) askResume(c, h);
      return;
    }
    r.resuming = false;
    r.asked = null;
    const lost = Math.max(0, o - r.received);
    r.received = o;
    // a character cut by the gap must not join the bytes after it
    if (lost) c.decoders.delete(ch);
    const noted = r.noted;
    r.noted = false;
    r.back(lost, noted);
  } else if (m['t'] === 'close') {
    c.channels.delete(ch);
    c.decoders.delete(ch);
    // a resume that found no session says why
    const reason = typeof m['reason'] === 'string' && m['reason'] ? m['reason'] : null;
    if (reason) { if (h.onError) h.onError(reason); else h.onData(notice(reason)); }
    h.onExit();
    retire(c, sock);
  }
}

/** A WRONG-SHARD REFUSAL (4421): the machine lives on the shard the reason names. The refusal comes
 *  before the attach, so nothing rode this socket, and the next one dials that shard at once. True =
 *  handled. False = it cannot be followed (no shard named, or one hop already): a final refusal */
function followShard(c: Conn, sock: WebSocket, reason: string): boolean {
  const target = wrongShardTarget(reason, parseRelayShards(c.cfg.relayUrl), c.url);
  if (!target || c.hops >= MAX_SHARD_HOPS) return false;
  c.hops += 1;
  c.url = target;
  if (sock === c.rotating) {
    c.rotating = null;
    clearTimer(c, 'rotateWait');
    rotate(c);
    return true;
  }
  try { c.sock = dial(c, 'dial'); }
  catch (error: unknown) { closeConn(c, error instanceof Error ? error.message : 'Could not reach the relay.'); }
  return true;
}

function socketClosed(c: Conn, sock: WebSocket, code: number, reason = ''): void {
  if (c.state === 'closed') return;
  if (code === WRONG_SHARD_CLOSE && (sock === c.sock || sock === c.rotating) && followShard(c, sock, reason)) return;
  if (sock === c.rotating) {
    // a rotation's socket that never attached: the current socket carries on, and a later rotation tries again
    c.rotating = null;
    clearTimer(c, 'rotateWait');
    scheduleRotation(c, true);
    return;
  }
  // A MACHINE THAT JUST STARTED joins the relay a moment after its first heartbeat (machine-joining.ts):
  // the first attach waits through its 4404 until it does, and a 4404 from any other machine ends it
  if (!c.everOpen && code === 4404 && sock === c.sock && Math.max(joiningUntil(c.machineId), c.cfg.joiningDeadlineMs ?? 0) > Date.now()) {
    if (!c.joinWait) { c.joinWait = true; for (const w of c.waiters) w.onJoining?.(RELAY_JOINING); }
    const wait = Math.min(JOIN_REDIAL_MAX_MS, 1_000 * 2 ** c.attempt);
    c.attempt += 1;
    later(c, 'redial', wait, () => {
      if (c.state !== 'connecting') return;
      try { c.sock = dial(c, 'dial'); }
      catch (error: unknown) { closeConn(c, error instanceof Error ? error.message : 'Could not reach the relay.'); }
    });
    return;
  }
  const said = c.signedOut ? 'signed out' : closeReason(code);
  // a refusal that names a shard this client already tried is final: another dial gets the same answer
  const keep = canResume(c) && !FINAL_CODES.has(code) && code !== WRONG_SHARD_CLOSE;
  // a drop, not a verdict: a channel that hears it (no resume took it back) hears onDisconnect
  const dropped = !c.signedOut && !FINAL_CODES.has(code) && code !== WRONG_SHARD_CLOSE;
  // every channel on this socket hears about it, unless it is a session the next socket takes back:
  // silence here is the exact ambiguity this lane exists to remove
  for (const [ch, h] of [...c.channels]) {
    if (h.sock !== sock || (h.resume && keep)) continue;
    c.channels.delete(ch);
    c.decoders.delete(ch);
    if (dropped && h.onDisconnect) h.onDisconnect(said);
    else if (h.onError) h.onError(said); else h.onData(notice(said));
    h.onExit();
  }
  c.retired.delete(sock);
  if (sock !== c.sock) return; // an older socket a rotation replaced: nothing else rode it
  const waiting = c.waiters.length > 0 || c.closing.size > 0 || [...c.channels.values()].some((h) => !!h.resume);
  if (!keep || !waiting) {
    // before the first attach only an ordinary or network close is a disconnect (upstream's rule): a
    // relay that refuses (4404, a machine not on the relay yet) still says so as an error
    closeConn(c, c.state === 'down' ? `${RECONNECT_FAILED} ${said}` : said, dropped,
      c.everOpen ? dropped : !c.signedOut && ORDINARY_CLOSES.has(code));
    return;
  }
  c.lastReason = said;
  if (c.state !== 'down') {
    c.state = 'down';
    c.downSince = Date.now();
    clearTimer(c, 'rotate');
    later(c, 'note', NOTE_AFTER_MS, () => {
      for (const h of c.channels.values()) if (h.resume && !h.resume.noted) { h.resume.noted = true; h.resume.note(); }
    });
  }
  redial(c);
}

function redial(c: Conn): void {
  const wait = Math.min(REDIAL_MAX_MS, REDIAL_FIRST_MS * 2 ** c.attempt);
  if (Date.now() + wait - c.downSince > (c.cfg.resumeWindowMs ?? RESUME_WINDOW_MS)) {
    closeConn(c, `${RECONNECT_FAILED} ${c.lastReason}`, true);
    return;
  }
  c.attempt += 1;
  later(c, 'redial', wait, () => {
    if (c.state !== 'down') return;
    try { c.sock = dial(c, 'dial'); }
    catch (error: unknown) { closeConn(c, error instanceof Error ? error.message : 'Could not reach the relay.'); }
  });
}

/** give up on a connection: every channel and every waiter hears `reason`, and the next open dials fresh */
/** `disconnected`: the channels lost the connection (onDisconnect), as against a refusal (onError).
 *  `waitersDisconnected`: the same answer for an open still waiting for its first attach */
function closeConn(c: Conn, reason: string, disconnected = false, waitersDisconnected = disconnected): void {
  if (c.state === 'closed') return;
  c.state = 'closed';
  c.failure = reason;
  if (conns.get(c.machineId) === c) conns.delete(c.machineId);
  for (const name of Object.keys(c.timers) as Array<keyof Conn['timers']>) clearTimer(c, name);
  const sockets = [c.sock, c.rotating, ...c.retired];
  c.rotating = null;
  c.retired.clear();
  c.closing.clear();
  const channels = [...c.channels.values()];
  c.channels.clear();
  c.decoders.clear();
  for (const w of c.waiters.splice(0)) w.reject(Object.assign(new Error(reason), { disconnected: waitersDisconnected }));
  for (const h of channels) {
    if (disconnected && h.onDisconnect) h.onDisconnect(reason);
    else if (h.onError) h.onError(reason); else h.onData(notice(reason));
    h.onExit();
  }
  for (const s of sockets) { if (s) { try { s.close(); } catch { /* already gone */ } } }
}

/** a pane closed its channel. The machine hears close now or, for a session whose socket dropped, on the next socket */
function release(c: Conn, ch: string, h: Channel): void {
  if (c.channels.get(ch) !== h) return; // the machine closed it already, or the connection gave up
  c.channels.delete(ch);
  c.decoders.delete(ch);
  if (!raw(h.sock, { ch, t: 'close' }) && h.resume && c.state === 'down') c.closing.set(ch, h.resume.open);
  retire(c, h.sock);
}

let seq = 0;
const mintCh = (): string => `c${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}`;

export interface PtyHandle {
  subId: string;
  input(d: string): void;
  resize(c: number, r: number): void;
  close(): void;
}

export interface RelayJsonHandle {
  subId: string;
  send(message: unknown): Promise<void>;
  close(): void;
}

const ENGINEERING_RELAY_BYTES_PER_SECOND = 4 * 1024 * 1024;
const waitMilliseconds = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Engineering channels share one socket, so their actual outer frames share one rate budget. A frame
 *  for a session whose socket dropped waits for the next socket, as one waits for the first attach:
 *  the session is still there, and a command is safe to deliver late (unlike a keystroke). */
function bufferedEngineeringRaw(c: Conn, h: Channel, message: unknown, canceled: () => boolean): Promise<void> {
  const serialized = JSON.stringify(message);
  const wireBytes = new TextEncoder().encode(serialized).byteLength;
  const send = c.engineeringSends.catch(() => {}).then(async () => {
    const delay = Math.max(0, c.engineeringNextSendAt - Date.now());
    if (delay) await waitMilliseconds(delay);
    for (;;) {
      if (canceled()) throw new Error(CHANNEL_CLOSED);
      const sock = h.sock;
      if (sock.readyState === WebSocket.OPEN) {
        try { await waitForRelayCapacity(sock); } catch (error: unknown) { if (!h.resume || !canResume(c)) throw error; continue; }
        if (canceled()) throw new Error(CHANNEL_CLOSED);
        if (h.sock === sock && sock.readyState === WebSocket.OPEN) { sock.send(serialized); break; }
        continue;
      }
      if (!h.resume || !canResume(c)) throw new Error('The relay connection is not open.');
      await whenOpen(c);
      if (h.sock.readyState !== WebSocket.OPEN && h.sock !== c.sock) throw new Error('The relay connection is not open.');
    }
    c.engineeringNextSendAt = Date.now() + Math.ceil((wireBytes / ENGINEERING_RELAY_BYTES_PER_SECOND) * 1000);
  });
  c.engineeringSends = send.catch(() => {});
  return send;
}

/** Open one typed, JSON-message channel over the same authenticated socket terminals use.
 * The hub remains deliberately unaware of the payload. This is the Engineering/Cline lane,
 * not a second websocket protocol or a second per-tab connection. */
export function openRelayJsonChannel(
  cfg: RelayConfig,
  opts: {
    /** `engineering`: the Code lane · `stream`: a read-only subscription to live agent replies ·
     *  `browser`: the machine's Chromium in the web panel (@neuramesh/shared browser-lane.ts) */
    lane: 'engineering' | 'stream' | 'browser';
    meta: Record<string, unknown>;
    onMessage(message: unknown): void;
    onExit(): void;
    onError(message: string): void;
    /** a Code session's socket has been down for a moment and this client is taking the session back.
     *  Nothing ended: the session runs on at the machine. Only the `engineering` lane resumes */
    onReconnecting?(): void;
    /** it is back. `lost`: bytes of its events the machine could not keep meanwhile (0 = none) */
    onReconnected?(lost: number): void;
    /** the session was taken back on a new socket, after ANY drop, even one too short to note. A
     *  command sent in the instant before the client saw the drop may be gone (relay-resume.ts) */
    onResumed?(lost: number): void;
    /** the connection went away for good (a drop no resume took back, or the resume gave up). A drop this
     *  client resumes never calls it: on Cloud Run every socket ends within the hour, and a session the
     *  machine still runs is not a failed one. Refusals and malformed messages still use onError */
    onDisconnect?(message: string): void;
  },
): RelayJsonHandle {
  const ch = mintCh();
  let c: Conn | null = null;
  let h: Channel | null = null;
  let closed = false;
  const queued: Array<{ message: unknown; resolve(): void; reject(error: unknown): void }> = [];
  let incoming = '';

  const exit = (): void => {
    if (closed) return;
    closed = true; incoming = '';
    for (const item of queued.splice(0)) item.reject(new Error(CHANNEL_CLOSED));
    opts.onExit();
  };
  const fail = (message: string, disconnected = false): void => {
    if (closed) return;
    for (const item of queued.splice(0)) item.reject(new Error(message));
    if (disconnected && opts.onDisconnect) opts.onDisconnect(message);
    else opts.onError(message);
    exit();
  };
  const deliver = (data: string): void => {
    incoming += data;
    let newline = incoming.indexOf('\n');
    while (newline >= 0) {
      const line = incoming.slice(0, newline);
      incoming = incoming.slice(newline + 1);
      if (line) {
        let message: unknown;
        try { message = JSON.parse(line) as unknown; }
        catch { opts.onError('The machine returned an invalid message.'); newline = incoming.indexOf('\n'); continue; }
        try { opts.onMessage(message); }
        catch (error) { console.error('The relay event handler failed', error); opts.onError('This client could not apply a machine update. Reload the thread.'); }
      }
      newline = incoming.indexOf('\n');
    }
  };
  void (async () => {
    let machineId: string | null = null;
    try { machineId = await cfg.machineId(); } catch { /* reported below */ }
    if (closed) return;
    if (!machineId) return fail('No cloud machine yet. Send a message to start one, then try again.');
    try {
      c = connect(cfg, machineId);
      await whenOpen(c);
    } catch (error: unknown) {
      return fail(error instanceof Error ? error.message : 'Could not reach the relay.', (error as { disconnected?: boolean } | null)?.disconnected === true);
    }
    if (closed) return;
    // A LANE THE RELAY DOES NOT NAME IS NEVER OPENED. An older relay forwards any lane as-is, and an
    // older daemon reads an unknown lane as a terminal: it would start a shell for every tab and
    // count it as work. The hub names the machine's lanes in `attached`; no name, no open.
    if (opts.lane === 'stream' && !c.lanes.has('stream')) return fail('This machine does not serve live replies yet.');
    if (opts.lane === 'browser' && !c.lanes.has('browser')) return fail('This cloud machine does not have a browser yet. It gets one at its next update.');
    const open = { ch, t: 'open', lane: opts.lane, meta: opts.meta };
    const channel: Channel = {
      onData: deliver, onExit: exit, onError: fail, onDisconnect: (message: string) => fail(message, true), sock: c.sock,
      ...(opts.lane === 'engineering' ? {
        resume: {
          open, received: 0, resuming: false, asked: null, noted: false,
          note: () => opts.onReconnecting?.(),
          back: (lost: number, noted: boolean) => {
            // the machine replays an event stream from a whole event: a line the gap cut is gone
            if (lost) incoming = '';
            if (noted || lost) opts.onReconnected?.(lost);
            opts.onResumed?.(lost);
          },
        },
      } : {}),
    };
    h = channel;
    c.channels.set(ch, channel);
    raw(c.sock, open);
    for (const item of queued.splice(0)) {
      try { await bufferedEngineeringRaw(c, channel, { ch, t: 'data', d: encodeB64(JSON.stringify(item.message)) }, () => closed); item.resolve(); }
      catch (error: unknown) { item.reject(error); }
    }
  })();

  return {
    subId: ch,
    // Unlike terminal keystrokes, Engineering commands are semantic and safe to buffer until
    // the authenticated attach/open handshake finishes. Dropping the first prompt would create
    // an apparently idle task with no recoverable user action.
    send: (message) => new Promise<void>((resolve, reject) => {
      if (closed) { reject(new Error(CHANNEL_CLOSED)); return; }
      if (!h || !c) { queued.push({ message, resolve, reject }); return; }
      void bufferedEngineeringRaw(c, h, { ch, t: 'data', d: encodeB64(JSON.stringify(message)) }, () => closed).then(resolve, reject);
    }),
    close: () => {
      closed = true;
      for (const item of queued.splice(0)) item.reject(new Error('The Engineering relay channel closed before sending.'));
      incoming = '';
      if (c && h) release(c, ch, h);
    },
  };
}

/** open one pty over the relay. Returns the SAME handle shape the desktop preload returns,
 *  so the terminal surface cannot tell the two apart — that is the point of the seam. */
export function openRelayPty(
  cfg: RelayConfig,
  opts: {
    cols: number; rows: number;
    cwd?: string; taskNumber?: number; hasRepo?: boolean; threadId?: string; repo?: { repoId: string; projectId: string };
    onData(d: string): void; onExit(): void;
  },
): PtyHandle {
  const ch = mintCh();
  let c: Conn | null = null;
  let h: Channel | null = null;
  // a surface may close a tab before the machine lookup returns; without this the late
  // `open` would spawn a shell nobody is watching and leak it until the socket drops
  let closed = false;
  // the pane's size now: the open carries it, and so does the resize after a resume
  let size = { cols: opts.cols, rows: opts.rows };

  const fail = (text: string): void => { opts.onData(notice(text)); opts.onExit(); };

  void (async () => {
    let machineId: string | null = null;
    try { machineId = await cfg.machineId(); } catch { /* treated as none, below */ }
    if (closed) return;
    // NO MACHINE IS A SENTENCE, NOT AN EMPTY PANE. A workspace that has never woken has no
    // runner row, so there is nothing to attach to and retrying does not invent one.
    if (!machineId) return fail('No cloud machine yet. Send a message to start one, then reopen the terminal.');

    try {
      // NOTE: `new WebSocket(url)` throws synchronously on a malformed origin, so the
      // construction belongs inside this try alongside the await — not before it.
      c = connect(cfg, machineId);
      await whenOpen(c, (text) => opts.onData(notice(text)));
    } catch (e: unknown) {
      return fail(e instanceof Error ? e.message : 'Could not reach the relay.');
    }
    if (closed) return;
    const open = {
      ch, t: 'open', cols: size.cols, rows: size.rows,
      ...(opts.threadId ? { meta: { threadId: opts.threadId } } : opts.repo ? { meta: opts.repo } : {}),
      // Older machines ignore repository meta. Refuse there rather than silently opening
      // their home directory and pretending it is the requested checkout.
      ...(opts.repo && !opts.threadId ? { cwd: `nm-repo:${opts.repo.repoId}` } : {}),
      ...(opts.cwd && !opts.repo && !opts.threadId ? { cwd: opts.cwd } : {}),
      ...(opts.taskNumber !== undefined ? { taskNumber: opts.taskNumber, hasRepo: !!opts.hasRepo } : {}),
    };
    const channel: Channel = {
      onData: opts.onData, onExit: opts.onExit, sock: c.sock,
      resume: {
        open, received: 0, resuming: false, asked: null, noted: false,
        note: () => opts.onData(notice(RECONNECTING)),
        back: (lost, noted) => {
          if (lost) opts.onData(notice(`Reconnected. ${lost} bytes of output were lost while the connection was down.`));
          else if (noted) opts.onData(notice('Reconnected.'));
        },
        // a resize while the socket was down went nowhere
        after: () => [{ t: 'resize', cols: size.cols, rows: size.rows }],
      },
    };
    h = channel;
    c.channels.set(ch, channel);
    raw(c.sock, open);
  })();

  const live = (): Channel | null => (c && h && c.channels.get(ch) === h ? h : null);
  return {
    subId: ch,
    // input before the open is DROPPED, deliberately, and so is input while the socket is down.
    // There is no shell to receive it yet, and replaying buffered keystrokes into a session that
    // has just come up (or come back) is how you run a command nobody meant to send.
    input: (d) => { const k = live(); if (k) raw(k.sock, { ch, t: 'data', d: encodeB64(d) }); },
    resize: (cols, rows) => { size = { cols, rows }; const k = live(); if (k) raw(k.sock, { ch, t: 'resize', cols, rows }); },
    close: () => {
      closed = true;
      if (c && h) release(c, ch, h);
    },
  };
}

/** test seam: drop every machine's socket so the next open dials fresh, and forget which machines just started */
export function resetRelay(): void {
  for (const c of [...conns.values()]) closeConn(c, 'The relay connection was reset.');
  conns.clear();
  resetJoining();
}
