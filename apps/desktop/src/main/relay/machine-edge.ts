// THE MACHINE EDGE OF nm-relay, with real shells (slice 2).
//
// packages/relay ships connectEchoMachine, which answers every keystroke with itself. That
// was the right v1: it made the whole browser -> relay -> machine path testable before a pty
// existed. This replaces it with node-pty, and it lives HERE rather than in packages/relay
// on purpose — the relay hub image builds from that package, and adding node-pty to it would
// make the hub compile a native module it never calls.
//
// THE DAEMON DIALS OUT. Machines never listen; this is the same outbound-only rule the whole
// design rests on. It also means the relay restarting is normal (single replica, rolls on
// deploy), so redialling is a first-class path rather than error handling.
//
// SESSIONS OUTLIVE SOCKETS (the session round, 2026-10; RESUME in @neuramesh/relay protocol.ts). On
// Cloud Run every relay socket ends: the request timeout cuts it at 3600 s on either side, a relay
// rollout retires the old instance (1012), a restart drops everything. A terminal or a Code session
// is no longer killed with its socket. It detaches, keeps its newest output in a bounded buffer
// (resume-buffer.ts), and its client takes it back on the next socket with a resume open, which
// replays exactly the bytes that client missed. A session nobody takes back within the grace window
// ends as before. The only intended end of a live session is its client's close, its shell's exit,
// or a drain (closeTerminals, and the Code host's closeAll). And before the relay's cut, this edge
// rotates its own socket: it dials a second one, the relay's takeover (4409) moves every attachment
// to it, and no client notices.
import WebSocket from 'ws';
import { CLOSE, isChannelFrame, keepAlive, parseMessage, parseRelayShards, shardUrlFor, toB64, fromB64, wrongShardTarget, type ChannelFrame } from '@neuramesh/relay';
import { terminalDirectory, type TerminalLocation } from './terminal-workspace';
import { makeJail } from './jail';
import { isEngineeringOpenMeta, type EngineeringRuntimeEvent } from '../../engineering-protocol';
import type { EngineeringMachineHost } from './engineering-host';
import { createEngineeringCommandBuffer, MAX_ENGINEERING_COMMAND_BYTES } from './engineering-channel-buffer';
import { createBoundedFrameSender } from './bounded-frame-sender';
import { EngineeringSessionLeases } from './engineering-session-leases';
import type { LiveStreams } from '../livestreams';
import { createStreamLane } from './stream-lane'; import { createBrowserLane } from './browser-lane';
import { ResumeBuffer } from './resume-buffer';

export interface MachineEdgeOptions {
  /** the relay, or the relay shards as a comma list in shard order: this machine dials its own shard */
  relayUrl: string;
  token: string;
  machineId: string;
  log?(line: string): void;
  /** a shell ended — a vendor login may just have happened in it (member-machines plan §4) */
  onSessionEnd?(): void;
  onRegistered?(ready: boolean): void;
  engineering?: EngineeringMachineHost;
  threadTerminalDirectory?: (threadId: string, actorId: string) => Promise<TerminalLocation>;
  repoTerminalDirectory?: (repoId: string, projectId: string) => Promise<TerminalLocation>;
  /** the keepalive period (tests shorten it) */
  keepaliveMs?: number;
  /** the live-reply registry emitStream feeds (livestreams.ts). Absent = no `stream` lane here. */
  streams?: Pick<LiveStreams, 'subscribe' | 'resync'>;
  /** this machine's Chromium (browser/service.ts), a cloud machine only. absent = no `browser` lane here. */
  browser?: import('../browser/service').BrowserService;
  /** the pty a terminal runs in. Absent = node-pty (tests hand in a fake: CI builds no native module) */
  spawnPty?: SpawnPty;
  /** where terminals run instead of this process's own pty: a Cloud Run machine's agent box
   *  (cloudrun/box-terminal.ts). Absent = node-pty here, as on the desktop and a GKE machine. */
  terminals?: TerminalHost;
  /** how long a session whose client left waits to be taken back. 0 = it ends with its client, as
   *  before resume. Default NM_RELAY_RESUME_GRACE_MS, else 120 s */
  resumeGraceMs?: number;
  /** the newest output bytes a terminal keeps for a resume (a Code session keeps four times as many).
   *  Default NM_RELAY_RESUME_BUFFER_BYTES, else 256 KiB */
  resumeBufferBytes?: number;
  /** when this edge replaces its own socket, before the relay's request timeout cuts it (jittered by
   *  10 %). 0 = never. Default NM_RELAY_ROTATE_MS, else 50 min */
  rotateMs?: number;
  /** how long a rotation waits for the relay to take the new socket over before it gives up */
  handoverWaitMs?: number;
  /** A member machine is its owner's shell and holds their logins. nm-api's attach check
   *  (validate-client) is the authority. This is the second check, on the machine: every open whose
   *  actor is not this user id is closed. Absent = no machine-side check (a runner, a desktop). */
  ownerOnly?: string | null;
}

/** the part of node-pty's IPty a terminal session uses */
export interface PtyLike {
  onData(cb: (d: string) => void): unknown;
  onExit(cb: () => void): unknown;
  write(d: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}
export type SpawnPty = (file: string, args: string[], o: { name: string; cwd: string; cols: number; rows: number; env: Record<string, string> }) => PtyLike;
/** a terminal somewhere other than this process: a running session, or the sentence a refused pane prints */
export interface TerminalHost {
  open(o: { cwd: string; cols: number; rows: number }): PtyLike | { refused: string };
}

/** what machined holds: the edge, and the two calls a Cloud Run drain makes on it */
export interface MachineEdge {
  close(): void;
  killTask(taskNumber: number): void;
  /** the sessions a client is attached to right now: a detached one waits for a resume and is no work */
  sessionCount(): number;
  /** the sessions waiting for their client to come back */
  detachedCount(): number;
  /** when a person last typed into (or opened) a terminal or Code session that is still open: epoch
   *  ms, 0 when none is open. machined's busy rule reads it (NM_TERMINAL_IDLE_MS). A detached session
   *  keeps its last input, so it ages out to idle, and a resume is no input */
  lastInputAt(): number;
  /** the drain begins: every open terminal is told, and no new one opens */
  hold(): void;
  /** the drain, before its snapshot: close every terminal with a line saying why. Returns how many */
  closeTerminals(): number;
}

import { RESUME_GRACE_MS, RESUME_BUFFER_BYTES, ROTATE_MS, envMs } from './machine-edge-settings';
export { RESUME_GRACE_MS, RESUME_BUFFER_BYTES, ROTATE_MS, relayUrlProblem } from './machine-edge-settings';

// the lines a terminal prints when a Cloud Run drain takes its machine (nm: voice, as resolveCwd's note)
const nmNote = (text: string): string => `\r\n\x1b[33mnm:\x1b[0m \x1b[2m${text}\x1b[0m\r\n`;
export const DRAIN_WARNING = nmNote('This machine is stopping (a resize or a sleep). This terminal closes in a moment, before the machine saves its work dir.');
export const DRAIN_CLOSED = nmNote('This terminal closed: the machine is saving its work dir before it stops. Open a terminal again when the machine is back.');
export const DRAIN_REFUSED = nmNote('This machine is stopping (a resize or a sleep). Open the terminal again when it is back.');
/** what a resume hears when its session is no longer here (a `close` with this reason) */
export const RESUME_GONE_TERMINAL = 'This terminal ended while the connection was down. Open a new one.';
export const RESUME_GONE_CODE = 'This Code session ended while the connection was down. Open the thread again.';
export const RESUME_NOT_YOURS = 'This session belongs to someone else.';
/** the close reason when a person who is not the owner reaches a member machine (ownerOnly) */
export const NOT_THE_OWNER = 'This machine belongs to another member. Only its owner can open it.';

/** a frame out on one socket: false when it did not go (the socket is not open, or its queue is full) */
type Sender = (m: ChannelFrame) => boolean;

interface Session {
  write(d: string): void;
  resize(c: number, r: number): void;
  kill(): void;
  /** which task's workspace this shell is standing in, so the berth sweep can close it
   *  BEFORE deleting the directory underneath it */
  taskNumber: number | null;
  lane: 'terminal' | 'engineering';
  actorId: string;
  /** a Code session's thread: the same thread opened again takes over a session its old channel left */
  thread: string | null;
  /** epoch ms of the last input frame (the open counts as one): an idle open tab is not work */
  lastInputAt: number;
  /** every byte it produced, the newest of them kept for a resume */
  out: ResumeBuffer;
  /** its client is attached at the relay: its bytes go out as they come */
  attached: boolean;
  /** how far its bytes went out to its client */
  sent: number;
  /** a resume (or bytes the buffer lost) to announce with `resumed` before the next bytes */
  announce: boolean;
  /** the `from` of the client's resume that `resumed` answers next: the client knows its answer by it */
  answer: number | null;
  /** detached: when this fires, the session ends */
  grace: ReturnType<typeof setTimeout> | null;
  /** when its client left: the oldest detached session is the first to give up its slot */
  detachedAt: number;
}

const ENGINEERING_CHUNK_BYTES = 128 * 1024;
/** the longest a rotation holds the sessions' bytes while it waits for the relay's takeover */
const HOLD_MAX_MS = 2_000;
export const MAX_MACHINE_CHANNELS = 32;
export const MAX_TERMINAL_SESSIONS_PER_ACTOR = 8;

export function connectMachineEdge(opts: MachineEdgeOptions): MachineEdge {
  const log = opts.log ?? ((l: string) => console.log(`[relay-edge] ${l}`));
  const graceMs = opts.resumeGraceMs ?? envMs('NM_RELAY_RESUME_GRACE_MS', RESUME_GRACE_MS);
  const bufferBytes = Math.max(4096, opts.resumeBufferBytes ?? envMs('NM_RELAY_RESUME_BUFFER_BYTES', RESUME_BUFFER_BYTES));
  const rotateMs = opts.rotateMs ?? envMs('NM_RELAY_ROTATE_MS', ROTATE_MS);
  const handoverWaitMs = opts.handoverWaitMs ?? 30_000;
  // THE SHARD THIS MACHINE DIALS (@neuramesh/relay shard.ts): its own entry when the setting is a list.
  // A shard that is not this machine's refuses with 4421 and names the right one, and the edge dials
  // that one from then on. So a new shard list on the relays moves a running machine at its next
  // redial, before the fleet restamps its pool
  let relayUrl = shardUrlFor(opts.relayUrl, opts.machineId) || opts.relayUrl;
  /** wrong-shard refusals in a row: the first is followed at once, a second waits out the backoff */
  let shardRefusals = 0;
  const sessions = new Map<string, Session>();
  // `stream` lane subscribers: NOT sessions, so a tab left open never reads as work (stream-lane.ts)
  // the `browser` lane's viewers are not sessions either (browser-lane.ts)
  const streamLane = createStreamLane(opts.streams, log), browserLane = createBrowserLane(opts.browser, log);
  // a shell still starting: `answer` is the `from` of a resume that came for it meanwhile
  const pendingTerminals = new Map<string, { actorId: string; cancelled: boolean; detached: boolean; answer: number | null }>();
  const engineeringLeases = new EngineeringSessionLeases();
  const registered = new WeakSet<WebSocket>();
  let sock: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // THE DRAIN'S HALF (cloudrun/lifecycle.ts through machined.ts). A terminal stands in the work dir the
  // drain snapshots, and what it writes after the snapshot is gone when the instance stops. So a
  // draining machine opens no new terminal and closes the open ones, each with a line saying why,
  // before the snapshot. Code sessions have their own drain hooks (EngineeringMachineHost).
  let held = false;
  // the open socket's sender: every session's bytes go out on it. null while no socket is open
  let current: Sender | null = null;
  // THE ROTATION: a second socket dialled before the relay's cut. While the relay has not taken it over
  // yet, the sessions' bytes are held (they wait in their buffers), so none goes out on the socket the
  // relay is about to close. The hold is short (HOLD_MAX_MS): a takeover that is slow, or that never
  // comes (the new socket reached another relay instance in a rollout), costs a terminal no more than
  // that, and a byte the old socket then loses is one the client asks for again (it sees the gap)
  let successor: { sock: WebSocket; send: Sender; ready: boolean } | null = null;
  let holding = false;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let rotation: ReturnType<typeof setTimeout> | null = null;
  let handoverTimer: ReturnType<typeof setTimeout> | null = null;
  const endHold = (): void => {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    holding = false;
  };

  /** send what a session's client has not had yet, on the open socket, with the offset of every byte */
  const flush = (ch: string, s: Session): void => {
    if (!s.attached || holding || !current) return;
    const out = current;
    let dropped = 0;
    if (s.sent < s.out.start) {
      // the buffer let go of bytes this client never had: say how many, and go on from a whole line
      // (a Code session's events are lines of JSON) or the oldest byte held (a terminal)
      const start = s.lane === 'engineering' ? s.out.lineStart() : s.out.start;
      dropped = start - s.sent;
      s.sent = start;
      s.announce = true;
    }
    if (s.announce) {
      if (!out({ ch, t: 'resumed', o: s.sent, dropped, ...(s.answer !== null ? { from: s.answer } : {}) })) return;
      s.announce = false;
      s.answer = null;
    }
    for (const piece of s.out.read(s.sent, ENGINEERING_CHUNK_BYTES)) {
      if (!out({ ch, t: 'data', d: toB64(piece.bytes), o: piece.at })) return;
      s.sent = piece.at + piece.bytes.length;
    }
  };
  const flushAll = (): void => { for (const [ch, s] of sessions) flush(ch, s); };
  /** a session's bytes: kept for a resume, and sent at once while its client is attached */
  const output = (ch: string, bytes: Buffer): void => {
    const s = sessions.get(ch);
    if (!s) return;
    const at = s.out.end;
    s.out.push(bytes);
    // THE COMMON CASE: the client is attached and has had every earlier byte, so these go out whole and
    // at once. The buffer may keep only the newest part of one large event (a Code error can pass a
    // megabyte), and what it keeps is for a resume, never a reason to hold back what can go now
    if (s.attached && !holding && current && !s.announce && s.sent === at) {
      for (let offset = 0; offset < bytes.length; offset += ENGINEERING_CHUNK_BYTES) {
        const piece = bytes.subarray(offset, offset + ENGINEERING_CHUNK_BYTES);
        if (!current({ ch, t: 'data', d: toB64(piece), o: at + offset })) return;
        s.sent = at + offset + piece.length;
      }
      return;
    }
    flush(ch, s);
  };
  const control = (m: ChannelFrame): void => { current?.(m); };

  const endSession = (ch: string, s: Session, why: string): void => {
    if (sessions.get(ch) !== s) return;
    if (s.grace) { clearTimeout(s.grace); s.grace = null; }
    s.kill();
    sessions.delete(ch);
    log(`session_end ch=${ch} lane=${s.lane}: ${why}`);
    opts.onSessionEnd?.();
  };
  /** its client left: the session waits for a resume, its output kept, until the grace runs out */
  const detach = (ch: string, s: Session): void => {
    if (!s.attached) return;
    s.attached = false;
    s.detachedAt = Date.now();
    if (graceMs <= 0) { endSession(ch, s, 'its client left'); return; }
    s.grace = setTimeout(() => { s.grace = null; if (!s.attached) endSession(ch, s, `no client came back within ${graceMs} ms`); }, graceMs);
    s.grace.unref?.();
  };
  const reattach = (ch: string, s: Session): void => {
    if (s.grace) { clearTimeout(s.grace); s.grace = null; }
    s.attached = true;
    flush(ch, s);
  };
  const detachAll = (): void => {
    for (const [ch, s] of [...sessions]) detach(ch, s);
    for (const pending of pendingTerminals.values()) pending.detached = true;
  };
  const addSession = (ch: string, parts: Pick<Session, 'write' | 'resize' | 'kill' | 'taskNumber' | 'lane' | 'actorId' | 'thread' | 'lastInputAt'>, detached = false): Session => {
    const s: Session = { ...parts, out: new ResumeBuffer(parts.lane === 'engineering' ? bufferBytes * 4 : bufferBytes), attached: true, sent: 0, announce: false, answer: null, grace: null, detachedAt: 0 };
    sessions.set(ch, s);
    // a session that came up after its socket went (a spawn outlived it) starts out waiting for a resume
    if (detached || !current) detach(ch, s);
    return s;
  };
  /** A SESSION NOBODY IS ATTACHED TO GIVES UP ITS SLOT. Its client left and may never come back (a reload
   *  opens new channels, it never resumes the old ones), so a new open is not refused for it: the oldest
   *  detached session that matches ends instead */
  const evictDetached = (match: (s: Session) => boolean): boolean => {
    let oldest: [string, Session] | null = null;
    for (const entry of sessions) {
      if (!entry[1].attached && match(entry[1]) && (!oldest || entry[1].detachedAt < oldest[1].detachedAt)) oldest = entry;
    }
    if (!oldest) return false;
    endSession(oldest[0], oldest[1], 'a new session took its slot');
    return true;
  };

  const killAll = (): void => {
    streamLane.stopAll(); browserLane.stopAll();
    const had = sessions.size > 0;
    for (const s of sessions.values()) { if (s.grace) clearTimeout(s.grace); s.kill(); }
    for (const pending of pendingTerminals.values()) pending.cancelled = true;
    pendingTerminals.clear();
    sessions.clear();
    engineeringLeases.clear();
    if (had) opts.onSessionEnd?.();
  };

  const open = async (frame: ChannelFrame, send: Sender): Promise<void> => {
    if (sessions.has(frame.ch) || pendingTerminals.has(frame.ch)) return; // a duplicate open would orphan the first shell
    if (held) {
      send({ ch: frame.ch, t: 'data', d: toB64(DRAIN_REFUSED) });
      send({ ch: frame.ch, t: 'close' });
      return;
    }
    const actorId = frame.actorId || 'anonymous';
    const actorCount = (): number => [...sessions.values()].filter((session) => session.lane === 'terminal' && session.actorId === actorId).length
      + [...pendingTerminals.values()].filter((pending) => pending.actorId === actorId).length;
    while (sessions.size + pendingTerminals.size >= MAX_MACHINE_CHANNELS && evictDetached(() => true)) { /* one slot freed */ }
    while (actorCount() >= MAX_TERMINAL_SESSIONS_PER_ACTOR && evictDetached((s) => s.lane === 'terminal' && s.actorId === actorId)) { /* one slot freed */ }
    if (sessions.size + pendingTerminals.size >= MAX_MACHINE_CHANNELS || actorCount() >= MAX_TERMINAL_SESSIONS_PER_ACTOR) {
      send({ ch: frame.ch, t: 'close' });
      return;
    }
    const reservation = { actorId, cancelled: false, detached: false, answer: null as number | null };
    pendingTerminals.set(frame.ch, reservation);
    let cleanup: (() => void) | null = null;
    try {
      // WHERE THE SHELL RUNS. On a Cloud Run machine, in its agent box (cloudrun/box-terminal.ts), and
      // only there: a box that is down refuses with its reason. Everywhere else, a pty in this process
      // inside the bash jail.
      // WHERE IT OPENS (terminal-workspace.ts): the thread's own directory, a task's worktree or deliverables,
      // or the NeuraMesh home. A directory that is not on this machine refuses (the catch below says why).
      const { cwd, taskNumber, note: restoreNote } = await terminalDirectory(frame, opts.threadTerminalDirectory, opts.repoTerminalDirectory);
      if (reservation.cancelled) return;
      const note: string | null = restoreNote ?? null;
      let opened: { term: PtyLike; cwd: string; note: string | null; release(): void } | { refused: string };
      if (opts.terminals) {
        const got = opts.terminals.open({ cwd, cols: frame.cols || 80, rows: frame.rows || 24 });
        opened = 'refused' in got ? got : { term: got, cwd, note, release: () => {} };
      } else {
        const spawnPty: SpawnPty = opts.spawnPty ?? (await import('node-pty')).spawn;
        if (reservation.cancelled) return;
        const jail = makeJail(cwd);
        cleanup = jail.cleanup;
        const term = spawnPty(jail.shell, jail.args, {
          name: 'xterm-color', cwd, cols: frame.cols || 80, rows: frame.rows || 24,
          env: { ...process.env, ...jail.env } as Record<string, string>,
        });
        opened = { term, cwd, note, release: jail.cleanup };
      }
      if ('refused' in opened) {
        log(`pty_refused ch=${frame.ch}: ${opened.refused}`);
        send({ ch: frame.ch, t: 'data', d: toB64(nmNote(opened.refused)) });
        send({ ch: frame.ch, t: 'close' });
        return;
      }
      const { term, release } = opened;
      const ch = frame.ch;
      const session = addSession(ch, {
        write: (d) => term.write(d), resize: (c, r) => { try { term.resize(c, r); } catch { /* race on close */ } },
        kill: () => { try { term.kill(); } catch { /* gone */ } release(); },
        taskNumber: taskNumber ?? null, lane: 'terminal', actorId, thread: null, lastInputAt: Date.now(),
      }, reservation.detached);
      // its client resumed it while it started (a socket dropped in between): the answer goes before its first byte
      if (reservation.answer !== null) { session.answer = reservation.answer; session.announce = true; }
    // the note rides the shell's FIRST output so it lands under the prompt instead of being
    // overwritten by bash's startup redraw
      let pending = note;
      term.onData((d: string) => {
        output(ch, Buffer.from(d, 'utf8'));
        if (pending) { const n = pending; pending = null; queueMicrotask(() => output(ch, Buffer.from(n, 'utf8'))); }
      });
      term.onExit(() => {
        release();
        if (sessions.get(ch) !== session) return; // its client closed it, or it was reaped: nothing to say
        if (session.grace) clearTimeout(session.grace);
        flush(ch, session); // its last bytes go before its close
        sessions.delete(ch);
        control({ ch, t: 'close' });
        opts.onSessionEnd?.();
      });
      cleanup = null;
      log(`pty_open ch=${frame.ch} cwd=${cwd}${opts.terminals ? ' (agent box)' : ''}`);
    } catch (error) {
      cleanup?.();
      if (!reservation.cancelled) {
        send({ ch: frame.ch, t: 'data', d: toB64(`\r\nTerminal could not start: ${error instanceof Error ? error.message : 'directory unavailable'}.\r\n`) });
        send({ ch: frame.ch, t: 'close' });
      }
      throw error;
    } finally {
      if (pendingTerminals.get(frame.ch) === reservation) pendingTerminals.delete(frame.ch);
    }
  };

  const openEngineering = async (frame: ChannelFrame, send: Sender): Promise<void> => {
    if (sessions.has(frame.ch)) return;
    const ch = frame.ch;
    let session: Session | null = null;
    // before the session exists, or after it ended, an event goes straight out (a refusal, a failed start)
    const direct = (bytes: Buffer): void => {
      const out = current ?? send;
      for (let offset = 0; offset < bytes.length; offset += ENGINEERING_CHUNK_BYTES) {
        out({ ch, t: 'data', d: toB64(bytes.subarray(offset, offset + ENGINEERING_CHUNK_BYTES)) });
      }
    };
    const emit = (event: EngineeringRuntimeEvent): void => {
      const bytes = Buffer.from(`${JSON.stringify(event)}\n`);
      if (session && sessions.get(ch) === session) output(ch, bytes);
      else direct(bytes);
      if (event.type === 'error' && event.code === 'ENGINEERING_PROTOCOL_LIMIT') {
        sessions.get(ch)?.kill();
        sessions.delete(ch);
        (current ?? send)({ ch, t: 'close' });
      }
    };
    if (!opts.engineering || !isEngineeringOpenMeta(frame.meta) || typeof frame.actorId !== 'string' || !frame.actorId) {
      emit({ type: 'error', code: 'ENGINEERING_UNAVAILABLE', message: opts.engineering ? 'The Engineering session request was invalid.' : 'This machine does not have the Engineering runtime.' });
      send({ ch, t: 'close' });
      return;
    }
    const meta = { ...frame.meta, actorId: frame.actorId };
    while (sessions.size + pendingTerminals.size >= MAX_MACHINE_CHANNELS && evictDetached(() => true)) { /* one slot freed */ }
    if (sessions.size + pendingTerminals.size >= MAX_MACHINE_CHANNELS) {
      emit({ type: 'error', code: 'ENGINEERING_CHANNEL_LIMIT', recoverable: true, message: 'Too many machine sessions are active. Close one before opening another.' });
      send({ ch, t: 'close' });
      return;
    }
    let claim = engineeringLeases.claim(meta.actorId, meta.threadId);
    // THE SAME THREAD OPENED AGAIN takes over the session its old channel left detached (a reload opens a
    // new channel, and so does a client that gave up on its resume): before resume that session had
    // already ended with its socket. A Code session attached elsewhere is still refused (SESSION_ACTIVE)
    if (!claim.ok && evictDetached(claim.reason === 'active'
      ? (s) => s.lane === 'engineering' && s.actorId === meta.actorId && s.thread === meta.threadId
      : (s) => s.lane === 'engineering' && s.actorId === meta.actorId)) claim = engineeringLeases.claim(meta.actorId, meta.threadId);
    if (!claim.ok && claim.reason === 'limit' && evictDetached((s) => s.lane === 'engineering')) claim = engineeringLeases.claim(meta.actorId, meta.threadId);
    if (!claim.ok) {
      emit(claim.reason === 'active'
        ? { type: 'error', code: 'SESSION_ACTIVE', recoverable: true, message: 'This Engineering thread is already active on another connection.' }
        : { type: 'error', code: 'ENGINEERING_CHANNEL_LIMIT', recoverable: true, message: 'Too many Code sessions are active. Close one before opening another.' });
      send({ ch, t: 'close' });
      return;
    }
    const { lease } = claim;
    // Claim the channel before async Cline/provider setup so an immediately-buffered prompt
    // cannot fall through the sessions map. Writes queue until the real session is ready.
    let live: Awaited<ReturnType<EngineeringMachineHost['open']>> | null = null;
    let killed = false;
    const rejectOverflow = () => {
      if (killed) return;
      killed = true;
      sessions.delete(ch);
      engineeringLeases.release(lease);
      live?.close();
      emit({ type: 'error', code: 'ENGINEERING_PROTOCOL_LIMIT', message: 'The Engineering command buffer exceeded its safe limit.' });
      (current ?? send)({ ch, t: 'close' });
    };
    const queued = createEngineeringCommandBuffer(rejectOverflow);
    const command = (data: string): void => {
      if (Buffer.byteLength(data) > MAX_ENGINEERING_COMMAND_BYTES) { rejectOverflow(); return; }
      if (live) live.command(JSON.parse(data) as unknown);
      else queued.push(data);
    };
    // the live session's event stream runs through the session, so a resume reattaches it as it is:
    // the host never learns that its browser left and came back
    session = addSession(ch, {
      write: command,
      resize: () => {},
      kill: () => { killed = true; queued.close(); engineeringLeases.release(lease); live?.close(); },
      taskNumber: null, lane: 'engineering', actorId: meta.actorId, thread: meta.threadId, lastInputAt: Date.now(),
    });
    try {
      live = await opts.engineering.open(meta, emit);
      if (killed) { live.close(); return; }
      queued.drain((data) => {
        try { live!.command(JSON.parse(data) as unknown); }
        catch { emit({ type: 'error', code: 'INVALID_COMMAND', message: 'The Engineering command was invalid.' }); }
      });
      log(`engineering_open ch=${ch} repo=${meta.repoId}`);
    } catch (error: unknown) {
      if (sessions.get(ch) === session) { if (session.grace) clearTimeout(session.grace); sessions.delete(ch); }
      engineeringLeases.release(lease);
      // a session that waits for GitHub says so by its code, so the thread shows the GitHub card (docs/design/repo-connect-2026-10)
      emit({ type: 'error', code: (error as { code?: unknown } | null)?.code === 'GITHUB_REQUIRED' ? 'ENGINEERING_GITHUB_REQUIRED' : 'ENGINEERING_START_FAILED', message: error instanceof Error ? error.message : String(error) });
      (current ?? send)({ ch, t: 'close' });
    }
  };

  /** a client takes back a session it held (RESUME): replay what it missed, never spawn. Without `from`
   *  it is the relay instead, after a takeover: this channel still has its client */
  const resumeSession = (m: ChannelFrame, send: Sender): void => {
    const lane = m.lane === 'engineering' ? 'engineering' : 'terminal';
    const actorId = m.actorId || 'anonymous';
    const kept = typeof m.from !== 'number';
    const s = sessions.get(m.ch);
    if (!s) {
      const pending = pendingTerminals.get(m.ch);
      // still starting: it comes up attached, on the socket that is open then, and answers this resume
      if (pending && pending.actorId === actorId) { pending.detached = false; if (!kept) pending.answer = m.from!; return; }
      log(`resume_${pending ? 'refused' : 'unknown'} ch=${m.ch} lane=${lane}${kept ? ' (relay)' : ''}`);
      send({ ch: m.ch, t: 'close', reason: pending ? RESUME_NOT_YOURS : lane === 'engineering' ? RESUME_GONE_CODE : RESUME_GONE_TERMINAL });
      return;
    }
    // the relay hands a channel only to its owner's sockets; the person check stands behind it
    if (s.lane !== lane || s.actorId !== actorId) {
      log(`resume_refused ch=${m.ch}: another lane or another person`);
      send({ ch: m.ch, t: 'close', reason: RESUME_NOT_YOURS });
      return;
    }
    if (kept) {
      // after a rotation of this edge's own the session never detached, and nothing changes. After a
      // socket this edge lost while the relay never saw it close, the client stayed: the bytes go on from
      // where they stopped, and the client asks for any it is missing (it sees the gap in `resumed`)
      if (s.attached) return;
      log(`resume ch=${m.ch} lane=${lane}: the relay kept its client`);
    } else {
      s.sent = Math.min(m.from!, s.out.end);
      s.answer = m.from!;
      log(`resume ch=${m.ch} lane=${lane} from=${s.sent} held=${s.out.start}..${s.out.end}`);
    }
    s.announce = true;
    reattach(m.ch, s);
  };

  // a live-reply or browser channel goes out on whichever socket is open, so this edge's own rotation
  // carries it too: the relay keeps its client through the takeover
  const sideSend = (fallback: Sender): Sender => (f) => (current ?? fallback)(f);

  const onFrame = (m: ChannelFrame, send: Sender): void => {
    if (m.t === 'open') {
      // every lane and every resume: the relay forwards one actor per client, and a member machine has one person
      if (opts.ownerOnly && m.actorId !== opts.ownerOnly) {
        log(`open_refused ch=${m.ch} lane=${m.lane ?? 'terminal'} actor=${m.actorId ?? 'none'}: not the owner of this member machine`);
        send({ ch: m.ch, t: 'close', reason: NOT_THE_OWNER });
        return;
      }
      if (m.resume === true && (m.lane === 'stream' || m.lane === 'browser')) {
        // the relay, after a takeover: a side channel still here carries on, and one that ended with the old
        // socket says so (its tab opens it again)
        if (!(m.lane === 'stream' ? streamLane : browserLane).has(m.ch)) send({ ch: m.ch, t: 'close' });
        return;
      }
      if (m.resume === true) { resumeSession(m, send); return; }
      if (m.lane === 'stream') streamLane.open(m, sideSend(send)); else if (m.lane === 'browser') browserLane.open(m, sideSend(send));
      else if (m.lane === 'engineering') void openEngineering(m, send).catch((e: unknown) => log(`engineering_open_failed ch=${m.ch}: ${String(e)}`));
      else void open(m, send).catch((e: unknown) => log(`pty_open_failed ch=${m.ch}: ${String(e)}`));
      return;
    }
    if (m.t === 'resumed') return; // this edge's own word, never one it hears
    const side = streamLane.has(m.ch) ? streamLane : browserLane.has(m.ch) ? browserLane : null;
    // a live-reply or browser channel is no session: its client leaving ends it
    if (side) { side.frame(m.t === 'detach' ? { ...m, t: 'close' } : m); return; }
    const sess = sessions.get(m.ch);
    if (!sess) {
      const pending = pendingTerminals.get(m.ch);
      if (pending) {
        // a shell still starting: its client left (it comes up waiting for a resume) or closed it
        if (m.t === 'detach') pending.detached = true;
        else if (m.t === 'close') pending.cancelled = true;
        return;
      }
      // A CHANNEL THIS PROCESS DOES NOT HOLD. Its shell died with an older instance (a Cloud Run
      // resize or wake), its grace ran out, or a drain closed it. Answering close ends the pane with a
      // reason instead of keystrokes that go nowhere. A close or a detach needs no answer.
      if (m.t !== 'close' && m.t !== 'detach') send({ ch: m.ch, t: 'close' });
      return;
    }
    if (m.t === 'detach') { detach(m.ch, sess); return; }
    if (m.t === 'close') { endSession(m.ch, sess, 'its client closed it'); return; }
    // the relay routes this channel here again, so its client is back (a takeover kept it attached)
    if (!sess.attached) reattach(m.ch, sess);
    if (m.t === 'data' && typeof m.d === 'string') {
      sess.lastInputAt = Date.now();
      try { sess.write(fromB64(m.d).toString('utf8')); }
      catch { /* malformed lane data is contained to its channel */ }
    }
    else if (m.t === 'resize') sess.resize(m.cols || 80, m.rows || 24);
  };

  const lanes = (): string[] => [
    'terminal', ...(opts.engineering ? ['engineering'] : []), ...(opts.streams ? ['stream'] : []), ...(opts.browser ? ['browser'] : []),
    // the capability a client checks before it ever sends a resume (an older daemon would spawn a new shell for one)
    ...(graceMs > 0 ? ['resume'] : []),
    // this edge follows a wrong-shard refusal, so a relay shard may refuse it (an older daemon is served where it lands)
    'shard',
  ];

  const scheduleRotation = (s: WebSocket, ms = rotateMs): void => {
    if (rotation) { clearTimeout(rotation); rotation = null; }
    if (ms <= 0) return;
    rotation = setTimeout(() => {
      rotation = null;
      if (sock === s && !stopped && !successor && s.readyState === WebSocket.OPEN) dial('successor');
    }, Math.round(ms * (0.9 + Math.random() * 0.2)));
    rotation.unref?.();
  };
  /** the relay took the new socket over: every session's bytes go out on it from here */
  const completeHandover = (): void => {
    const next = successor;
    if (!next) return;
    successor = null;
    if (handoverTimer) { clearTimeout(handoverTimer); handoverTimer = null; }
    const old = sock;
    sock = next.sock;
    current = next.send;
    endHold();
    log('rotation: the relay took the new socket over');
    scheduleRotation(next.sock);
    // every attached session says where it stands on the new socket: a client that has fewer bytes (one
    // the old socket lost in its last moment) asks for them, and one that has them all hears nothing new
    for (const s of sessions.values()) if (s.attached) s.announce = true;
    flushAll();
    // the relay closes the old socket itself (4409). One it left open goes after a moment: no client
    // routes through it any more, so its close costs nothing
    if (old && old !== next.sock) {
      const straggler = setTimeout(() => { if (old.readyState === WebSocket.OPEN) old.close(CLOSE.HANDOVER, 'handover'); }, 5_000);
      straggler.unref?.();
    }
  };
  /** the rotation did not complete: the socket in use carries on, and a later rotation tries again */
  const endRotation = (why: string): void => {
    const next = successor;
    successor = null;
    if (handoverTimer) { clearTimeout(handoverTimer); handoverTimer = null; }
    endHold();
    log(`rotation: ${why}; the current socket carries on`);
    if (next && next.sock.readyState <= WebSocket.OPEN) { try { next.sock.close(1000, 'rotation abandoned'); } catch { /* gone */ } }
    flushAll();
    if (sock) scheduleRotation(sock, Math.min(5 * 60_000, rotateMs));
  };

  const dial = (role: 'primary' | 'successor' = 'primary'): void => {
    if (stopped) return;
    let created: WebSocket;
    try {
      created = new WebSocket(relayUrl, { headers: { authorization: `Bearer ${opts.token}` }, maxPayload: 1024 * 1024 });
    } catch (e: unknown) {
      // a URL ws refuses at construction (relayUrlProblem names the usual ones): there is no socket,
      // so no close event to redial from, and the same URL would be refused again
      log(`dial_refused ${e instanceof Error ? e.message : String(e)} — not redialling`);
      if (role === 'successor') endRotation('the new socket could not be made');
      return;
    }
    const s = created;
    const frameSender = createBoundedFrameSender(s, WebSocket.OPEN);
    const send: Sender = (m) => s.readyState === WebSocket.OPEN && frameSender.send(m);
    if (role === 'primary') sock = s;
    else successor = { sock: s, send, ready: false };

    s.on('open', () => {
      // the lanes this daemon serves: the relay opens a `stream` channel only on a machine that
      // names it, because an older daemon would read the unknown lane as a terminal
      s.send(JSON.stringify({ t: 'hello', machineId: opts.machineId, lanes: lanes(), ...(opts.onRegistered ? { readinessProtocol: 1 } : {}) }));
      // the half-open socket (2026-09-19, @neuramesh/relay keepalive.ts): the balancer closed this
      // socket at its idle timeout and this side never saw a close, so no redial ran for hours. A
      // missed pong terminates it, which is the close event the redial below waits for.
      keepAlive(s, opts.keepaliveMs, () => log('keepalive: no pong, terminating the socket'));
      if (role === 'primary') {
        attempt = 0;
        current = send;
        log(`dialled ${relayUrl}`);
        scheduleRotation(s);
        flushAll();
        return;
      }
      if (successor?.sock !== s) return;
      successor.ready = true;
      holding = true;
      holdTimer = setTimeout(() => { holdTimer = null; holding = false; flushAll(); }, HOLD_MAX_MS);
      holdTimer.unref?.();
      handoverTimer = setTimeout(() => endRotation('the relay did not take the new socket over'), handoverWaitMs);
      handoverTimer.unref?.();
      log('rotation: a new socket is open; waiting for the relay to take it over');
    });
    s.on('message', (raw: WebSocket.RawData) => {
      const text = Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : Buffer.from(raw as Buffer).toString('utf8');
      const m = parseMessage(text);
      if (m?.t === 'registered' && m.machineId === opts.machineId) {
        registered.add(s);
        if (sock === s || successor?.sock === s) opts.onRegistered?.(true);
        if (successor?.sock === s && sock !== s) completeHandover();
        return;
      }
      if (!m || !isChannelFrame(m)) return;
      // a frame came, so the relay took this socket: the refusals in a row are over
      shardRefusals = 0;
      // the relay routes a channel to a socket only once its hello took over: the handover is done
      if (role === 'successor' && successor?.sock === s && sock !== s) completeHandover();
      onFrame(m, send);
    });
    s.on('close', (code: number, why: Buffer) => {
      frameSender.close();
      // THIS MACHINE LIVES ON ANOTHER SHARD (4421): every later dial, a redial or a rotation, goes there
      let shardMoved = false;
      if (code === CLOSE.WRONG_SHARD) {
        const target = wrongShardTarget(why?.toString('utf8') ?? '', parseRelayShards(opts.relayUrl), relayUrl);
        if (target) { log(`wrong shard: ${relayUrl} sent this machine to ${target}`); relayUrl = target; shardMoved = true; }
        shardRefusals += 1;
      } else shardRefusals = 0;
      if (role === 'successor' && sock !== s) {
        if (successor?.sock === s) endRotation(`the new socket closed first (code ${code})`);
        return;
      }
      if (sock !== s) return; // an older socket a handover already replaced
      // the relay's takeover of OUR new socket: the planned handover, and no client noticed
      if (code === CLOSE.TAKEOVER && successor?.ready) { completeHandover(); return; }
      current = null;
      sock = null;
      if (!successor || !registered.has(successor.sock)) opts.onRegistered?.(false);
      if (rotation) { clearTimeout(rotation); rotation = null; }
      streamLane.stopAll(); browserLane.stopAll();
      // THE SESSIONS LIVE ON (RESUME): each waits for its client to come back through the next socket
      detachAll();
      // the socket died during a rotation: the new one, already open, carries on (the relay registers it)
      if (successor?.ready) {
        const next = successor;
        successor = null;
        if (handoverTimer) { clearTimeout(handoverTimer); handoverTimer = null; }
        endHold();
        sock = next.sock;
        current = next.send;
        log(`disconnected code=${code} during a rotation; the new socket carries on`);
        scheduleRotation(next.sock);
        return;
      }
      if (successor) {
        try { successor.sock.close(); } catch { /* gone */ }
        successor = null;
        if (handoverTimer) { clearTimeout(handoverTimer); handoverTimer = null; }
        endHold();
      }
      if (stopped) return;
      // 4401/4403 are verdicts, not outages: redialling cannot change the answer, and a tight
      // loop against control-api is how a misconfigured machine becomes a denial of service
      if (code === 4401 || code === 4403) return log(`refused code=${code} — not redialling`);
      // the first refusal in a row moves at once: the browsers already look for this machine there
      if (shardMoved && shardRefusals === 1) {
        log('redialling its own shard now');
        timer = setTimeout(() => dial(), 0);
        return;
      }
      attempt += 1;
      const wait = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
      log(`disconnected code=${code}; redialling in ${wait}ms`);
      timer = setTimeout(() => dial(), wait);
    });
    s.on('error', (e: Error) => log(`socket_error ${e.message}`));
  };

  dial();
  return {
    close: () => {
      stopped = true;
      for (const t of [timer, rotation, handoverTimer, holdTimer]) if (t) clearTimeout(t);
      killAll();
      sock?.close();
      successor?.sock.close();
    },
    // a live terminal is WORK for the activity meter: someone is typing into this machine. A detached
    // one waits for its client to come back, and that is nobody's work
    sessionCount: () => [...sessions.values()].filter((s) => s.attached).length,
    detachedCount: () => [...sessions.values()].filter((s) => !s.attached).length,
    // a detached session keeps the last input it had, so it ages out to idle like an open tab nobody uses
    lastInputAt: () => { let at = 0; for (const s of sessions.values()) at = Math.max(at, s.lastInputAt); return at; },
    // THE BERTH SWEEP CALLS THIS BEFORE THE DIRECTORY VANISHES. A settled task's worktree is
    // removed totally (docs/40), and a shell still standing in it would keep the inode alive
    // and then be typing into a directory that no longer exists. The desktop has had this
    // hook since review terminals existed; on a machine it was a no-op only because machines
    // had no shells — which stopped being true one file ago.
    killTask: (taskNumber) => {
      for (const [ch, sess] of [...sessions]) {
        if (sess.taskNumber !== taskNumber) continue;
        endSession(ch, sess, `task ${taskNumber} settled`);
        control({ ch, t: 'close' });
        log(`pty_reclaimed ch=${ch} task=${taskNumber}`);
      }
    },
    hold: () => {
      if (held) return;
      held = true;
      for (const [ch, sess] of sessions) if (sess.lane === 'terminal') output(ch, Buffer.from(DRAIN_WARNING));
      log('drain: holding, no new terminal opens');
    },
    closeTerminals: () => {
      held = true;
      let closed = 0;
      for (const [ch, sess] of [...sessions]) {
        if (sess.lane !== 'terminal') continue;
        output(ch, Buffer.from(DRAIN_CLOSED));
        endSession(ch, sess, 'the machine drains');
        control({ ch, t: 'close' });
        closed += 1;
      }
      // a shell still starting would come up after the snapshot: it never starts, and its pane hears so
      for (const [ch, pending] of [...pendingTerminals]) {
        pending.cancelled = true;
        pendingTerminals.delete(ch);
        control({ ch, t: 'close' });
        closed += 1;
      }
      if (closed) log(`drain: closed ${closed} terminal(s)`);
      return closed;
    },
  };
}
