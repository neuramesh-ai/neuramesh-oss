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
import WebSocket from 'ws';
import { existsSync, mkdirSync } from 'node:fs';
import { isChannelFrame, parseMessage, toB64, fromB64, type ChannelFrame } from '@neuramesh/relay';
import { makeJail } from './jail';
import { brainRoot, cachePath, deliverablePath } from '../harness/brain';
import { isEngineeringOpenMeta, type EngineeringRuntimeEvent } from '../../engineering-protocol';
import type { EngineeringMachineHost } from './engineering-host';
import { createEngineeringCommandBuffer, MAX_ENGINEERING_COMMAND_BYTES } from './engineering-channel-buffer';
import { createBoundedFrameSender } from './bounded-frame-sender';
import { EngineeringSessionLeases } from './engineering-session-leases';

export interface MachineEdgeOptions {
  relayUrl: string;
  token: string;
  machineId: string;
  log?(line: string): void;
  /** a shell ended — a vendor login may just have happened in it (member-machines plan §4) */
  onSessionEnd?(): void;
  engineering?: EngineeringMachineHost;
}

interface Session {
  write(d: string): void;
  resize(c: number, r: number): void;
  kill(): void;
  /** which task's workspace this shell is standing in, so the berth sweep can close it
   *  BEFORE deleting the directory underneath it */
  taskNumber: number | null;
  lane: 'terminal' | 'engineering';
  actorId: string;
}

const ENGINEERING_CHUNK_BYTES = 128 * 1024;
export const MAX_MACHINE_CHANNELS = 32;
export const MAX_TERMINAL_SESSIONS_PER_ACTOR = 8;

/** where an `open` frame points. The browser has no filesystem, so it names the SESSION and
 *  the machine resolves the path — the same resolution the desktop does locally. */
function resolveCwd(f: ChannelFrame): { cwd: string; note: string | null } {
  const home = brainRoot();
  if (!existsSync(home)) { try { mkdirSync(home, { recursive: true }); } catch { /* spawn will fail loudly */ } }
  if (typeof f.taskNumber === 'number') {
    const dir = f.hasRepo ? cachePath('worktrees', `nm-${f.taskNumber}`) : deliverablePath(f.taskNumber);
    if (existsSync(dir)) return { cwd: dir, note: null };
    // the desktop says this too, and for the same reason: an explained terminal you can work
    // in beats a dead one, and silence would read as a broken shell
    return {
      cwd: home,
      note: `\r\n\x1b[33mnm:\x1b[0m \x1b[2m#${f.taskNumber}'s ${f.hasRepo ? 'worktree' : 'deliverables folder'} is not on this machine — opened the NeuraMesh home instead.\x1b[0m\r\n`,
    };
  }
  if (f.cwd && existsSync(f.cwd)) return { cwd: f.cwd, note: null };
  return { cwd: home, note: null };
}

export function connectMachineEdge(opts: MachineEdgeOptions): { close(): void; killTask(taskNumber: number): void; sessionCount(): number } {
  const log = opts.log ?? ((l: string) => console.log(`[relay-edge] ${l}`));
  const sessions = new Map<string, Session>();
  const pendingTerminals = new Map<string, { actorId: string; cancelled: boolean }>();
  const engineeringLeases = new EngineeringSessionLeases();
  let sock: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const killAll = (): void => {
    const had = sessions.size > 0;
    for (const s of sessions.values()) s.kill();
    for (const pending of pendingTerminals.values()) pending.cancelled = true;
    pendingTerminals.clear();
    sessions.clear();
    engineeringLeases.clear();
    if (had) opts.onSessionEnd?.();
  };

  const open = async (frame: ChannelFrame, send: (m: ChannelFrame) => void): Promise<void> => {
    if (sessions.has(frame.ch) || pendingTerminals.has(frame.ch)) return; // a duplicate open would orphan the first shell
    const actorId = frame.actorId || 'anonymous';
    const actorCount = [...sessions.values()].filter((session) => session.lane === 'terminal' && session.actorId === actorId).length
      + [...pendingTerminals.values()].filter((pending) => pending.actorId === actorId).length;
    if (sessions.size + pendingTerminals.size >= MAX_MACHINE_CHANNELS || actorCount >= MAX_TERMINAL_SESSIONS_PER_ACTOR) {
      send({ ch: frame.ch, t: 'close' });
      return;
    }
    const reservation = { actorId, cancelled: false };
    pendingTerminals.set(frame.ch, reservation);
    let cleanup: (() => void) | null = null;
    try {
      const pty = await import('node-pty');
      if (reservation.cancelled) return;
      const { cwd, note } = resolveCwd(frame);
      const jail = makeJail(cwd);
      cleanup = jail.cleanup;
      const term = pty.spawn(jail.shell, jail.args, {
        name: 'xterm-color', cwd, cols: frame.cols || 80, rows: frame.rows || 24,
        env: { ...process.env, ...jail.env } as Record<string, string>,
      });
    // the note rides the shell's FIRST output so it lands under the prompt instead of being
    // overwritten by bash's startup redraw
      let pending = note;
      term.onData((d: string) => {
        send({ ch: frame.ch, t: 'data', d: toB64(d) });
        if (pending) { const n = pending; pending = null; queueMicrotask(() => send({ ch: frame.ch, t: 'data', d: toB64(n) })); }
      });
      term.onExit(() => {
        sessions.delete(frame.ch); jail.cleanup(); send({ ch: frame.ch, t: 'close' }); opts.onSessionEnd?.();
      });
      sessions.set(frame.ch, {
        write: (d) => term.write(d), resize: (c, r) => { try { term.resize(c, r); } catch { /* race on close */ } },
        kill: () => { try { term.kill(); } catch { /* gone */ } jail.cleanup(); },
        taskNumber: typeof frame.taskNumber === 'number' ? frame.taskNumber : null, lane: 'terminal', actorId,
      });
      cleanup = null;
      log(`pty_open ch=${frame.ch} cwd=${cwd}`);
    } catch (error) {
      cleanup?.();
      if (!reservation.cancelled) send({ ch: frame.ch, t: 'close' });
      throw error;
    } finally {
      if (pendingTerminals.get(frame.ch) === reservation) pendingTerminals.delete(frame.ch);
    }
  };

  const openEngineering = async (frame: ChannelFrame, send: (m: ChannelFrame) => void): Promise<void> => {
    if (sessions.has(frame.ch)) return;
    const emit = (event: EngineeringRuntimeEvent): void => {
      const bytes = Buffer.from(`${JSON.stringify(event)}\n`);
      for (let offset = 0; offset < bytes.length; offset += ENGINEERING_CHUNK_BYTES) {
        send({ ch: frame.ch, t: 'data', d: toB64(bytes.subarray(offset, offset + ENGINEERING_CHUNK_BYTES)) });
      }
      if (event.type === 'error' && event.code === 'ENGINEERING_PROTOCOL_LIMIT') {
        sessions.get(frame.ch)?.kill();
        sessions.delete(frame.ch);
        send({ ch: frame.ch, t: 'close' });
      }
    };
    if (!opts.engineering || !isEngineeringOpenMeta(frame.meta) || typeof frame.actorId !== 'string' || !frame.actorId) {
      emit({ type: 'error', code: 'ENGINEERING_UNAVAILABLE', message: opts.engineering ? 'The Engineering session request was invalid.' : 'This machine does not have the Engineering runtime.' });
      send({ ch: frame.ch, t: 'close' });
      return;
    }
    const meta = { ...frame.meta, actorId: frame.actorId };
    if (sessions.size + pendingTerminals.size >= MAX_MACHINE_CHANNELS) {
      emit({ type: 'error', code: 'ENGINEERING_CHANNEL_LIMIT', recoverable: true, message: 'Too many machine sessions are active. Close one before opening another.' });
      send({ ch: frame.ch, t: 'close' });
      return;
    }
    const claim = engineeringLeases.claim(meta.actorId, meta.threadId);
    if (!claim.ok) {
      emit(claim.reason === 'active'
        ? { type: 'error', code: 'SESSION_ACTIVE', recoverable: true, message: 'This Engineering thread is already active on another connection.' }
        : { type: 'error', code: 'ENGINEERING_CHANNEL_LIMIT', recoverable: true, message: 'Too many Code sessions are active. Close one before opening another.' });
      send({ ch: frame.ch, t: 'close' });
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
      sessions.delete(frame.ch);
      engineeringLeases.release(lease);
      live?.close();
      emit({ type: 'error', code: 'ENGINEERING_PROTOCOL_LIMIT', message: 'The Engineering command buffer exceeded its safe limit.' });
      send({ ch: frame.ch, t: 'close' });
    };
    const queued = createEngineeringCommandBuffer(rejectOverflow);
    const command = (data: string): void => {
      if (Buffer.byteLength(data) > MAX_ENGINEERING_COMMAND_BYTES) { rejectOverflow(); return; }
      if (live) live.command(JSON.parse(data) as unknown);
      else queued.push(data);
    };
    sessions.set(frame.ch, {
      write: command,
      resize: () => {},
      kill: () => { killed = true; queued.close(); engineeringLeases.release(lease); live?.close(); },
      taskNumber: null, lane: 'engineering', actorId: meta.actorId,
    });
    try {
      live = await opts.engineering.open(meta, emit);
      if (killed) { live.close(); return; }
      queued.drain((data) => {
        try { live!.command(JSON.parse(data) as unknown); }
        catch { emit({ type: 'error', code: 'INVALID_COMMAND', message: 'The Engineering command was invalid.' }); }
      });
      log(`engineering_open ch=${frame.ch} repo=${meta.repoId}`);
    } catch (error: unknown) {
      sessions.delete(frame.ch);
      engineeringLeases.release(lease);
      emit({ type: 'error', code: 'ENGINEERING_START_FAILED', message: error instanceof Error ? error.message : String(error) });
      send({ ch: frame.ch, t: 'close' });
    }
  };

  const dial = (): void => {
    if (stopped) return;
    const s = new WebSocket(opts.relayUrl, { headers: { authorization: `Bearer ${opts.token}` }, maxPayload: 1024 * 1024 });
    sock = s;
    const frameSender = createBoundedFrameSender(s, WebSocket.OPEN);
    const send = (m: ChannelFrame): void => { if (s.readyState === WebSocket.OPEN) frameSender.send(m); };

    s.on('open', () => {
      attempt = 0;
      s.send(JSON.stringify({ t: 'hello', machineId: opts.machineId }));
      log(`dialled ${opts.relayUrl}`);
    });
    s.on('message', (raw: WebSocket.RawData) => {
      const text = Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : Buffer.from(raw as Buffer).toString('utf8');
      const m = parseMessage(text);
      if (!m || !isChannelFrame(m)) return;
      if (m.t === 'open') {
        if (m.lane === 'engineering') void openEngineering(m, send).catch((e: unknown) => log(`engineering_open_failed ch=${m.ch}: ${String(e)}`));
        else void open(m, send).catch((e: unknown) => log(`pty_open_failed ch=${m.ch}: ${String(e)}`));
        return;
      }
      const sess = sessions.get(m.ch);
      if (!sess) return;
      if (m.t === 'data' && typeof m.d === 'string') {
        try { sess.write(fromB64(m.d).toString('utf8')); }
        catch { /* malformed lane data is contained to its channel */ }
      }
      else if (m.t === 'resize') sess.resize(m.cols || 80, m.rows || 24);
      else if (m.t === 'close') { sess.kill(); sessions.delete(m.ch); opts.onSessionEnd?.(); }
    });
    s.on('close', (code: number) => {
      frameSender.close();
      // EVERY SHELL DIES WITH THE SOCKET. The browser that owned them is unreachable, so a
      // surviving pty is an orphan holding a worktree open with nobody able to type into it.
      killAll();
      if (stopped) return;
      // 4401/4403 are verdicts, not outages: redialling cannot change the answer, and a tight
      // loop against control-api is how a misconfigured machine becomes a denial of service
      if (code === 4401 || code === 4403) return log(`refused code=${code} — not redialling`);
      attempt += 1;
      const wait = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
      log(`disconnected code=${code}; redialling in ${wait}ms`);
      timer = setTimeout(dial, wait);
    });
    s.on('error', (e: Error) => log(`socket_error ${e.message}`));
  };

  dial();
  return {
    close: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      killAll();
      sock?.close();
    },
    // a live terminal is WORK for the activity meter: someone is typing into this machine
    sessionCount: () => sessions.size,
    // THE BERTH SWEEP CALLS THIS BEFORE THE DIRECTORY VANISHES. A settled task's worktree is
    // removed totally (docs/40), and a shell still standing in it would keep the inode alive
    // and then be typing into a directory that no longer exists. The desktop has had this
    // hook since review terminals existed; on a machine it was a no-op only because machines
    // had no shells — which stopped being true one file ago.
    killTask: (taskNumber) => {
      for (const [ch, sess] of sessions) {
        if (sess.taskNumber !== taskNumber) continue;
        sess.kill();
        sessions.delete(ch);
        if (sock?.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ ch, t: 'close' } satisfies ChannelFrame));
        log(`pty_reclaimed ch=${ch} task=${taskNumber}`);
      }
    },
  };
}
