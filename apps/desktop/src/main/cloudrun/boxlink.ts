// THE BOX LINK (round 6). The agent box used to reach the supervisor at its veth gateway (172.20.0.1):
// the tool bus, the agents' egress-proxy forward and the box browser's proxy all listened there. On
// 2026-10-29, between 02:55Z and 23:28Z, Cloud Run's sandbox began to drop every box → gateway packet
// (no RST even on a closed port), with no change on our side: the same machine image passed the e2e
// boxcli witness (bus 200/401) before and failed it after (bus 0/0). The public internet still works
// from the box, and the metadata server and private ranges stay blocked.
//
// So the box reaches the supervisor through the one channel the platform still gives us: the stdio of
// a `sandbox exec`. PID 1 keeps ONE long-lived exec of a small Node script in the box (BOXLINK_SCRIPT,
// written to the work dir). That script listens on the BOX's loopback, one port per exposed service,
// and carries each accepted connection over its stdin/stdout as newline-delimited JSON frames. This
// side connects each stream to the service's port on the SUPERVISOR's loopback and pipes it. The URLs
// the box gets (runtime-box.ts UrlRewrite) name 127.0.0.1:<box port>, which inside the box is the box.
//
// Frames (one JSON object per line, `d` base64, at most CHUNK raw bytes):
//   box → here   {t:'hello',v} · {t:'listening',svc,port} · {t:'refused',svc,error} · {t:'open',id,svc}
//                {t:'data',id,d} · {t:'close',id} · {t:'pause',id} · {t:'resume',id}
//   here → box   {t:'listen',svc,port} · {t:'data',id,d} · {t:'close',id} · {t:'pause',id} · {t:'resume',id}
//
// BOUNDED, so a stuck stream cannot grow PID 1's memory. Each side caps what one stream may have
// queued toward its socket (streamCapBytes): over the cap it asks the other side to pause that stream,
// and at 4x the cap it drops the stream. The sum over all streams is capped too (totalCapBytes): over
// it the stream with the most queued is dropped. A full pipe to the box pauses every upstream socket
// until it drains. A line longer than MAX_LINE_BYTES is a broken link: it restarts.
//
// ONE CHUNK PER TURN. A pause is a frame, so it takes effect only when the far side reads it. libuv reads
// a ready socket up to 32 times (64 KiB each) in one poll turn, so a side that kept reading could send
// up to 2 MiB after the other side asked it to stop, which is more than the 3x headroom before a drop
// (measured: 4 of 20 runs dropped a stream at 1,114,112 bytes with a 256 KiB cap). So each side pauses a
// socket after every chunk it reads and resumes it on the next turn (setImmediate), when the frames in
// its own input (a pause among them) were read. What can arrive after a pause is then about one chunk
// plus the socket's read buffer, plus what the pipe holds.
//
// RESPAWN. The exec ends with the box, or by itself. While the box lives, the link starts again with
// backoff (backoffFirstMs doubling to backoffMaxMs, reset after a run of STABLE_MS) and asks for the
// same box ports, so the URLs already handed to running CLIs keep working. stop() ends it for good.
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect as netConnect, type Socket } from 'node:net';
import { join } from 'node:path';
import { BOX_WORK } from './box';

export * from './boxlink-protocol';
import { BOXLINK_REL, STREAM_CAP_BYTES, TOTAL_CAP_BYTES, BOXLINK_SCRIPT, FrameReader, encodeFrame, dataFrames, type Frame } from './boxlink-protocol';
const STABLE_MS = 60_000;

// ── the supervisor end ──────────────────────────────────────────────────────────────────────────

/** what the link uses of BoxManager (a test fakes it with a child that runs the box end locally) */
export interface LinkBox {
  exec(cmd: readonly string[], o: { stdin: 'pipe'; env?: Record<string, string> }): ChildProcess;
  readonly dead?: boolean;
}

export interface BoxLinkOptions {
  box: () => LinkBox | null;
  /** the host work dir the box sees at /work: the box end's script is written under it */
  workDir: string;
  log?: (line: string) => void;
  streamCapBytes?: number;
  totalCapBytes?: number;
  backoffFirstMs?: number;
  backoffMaxMs?: number;
  /** how a stream reaches a service here (test seam) */
  connect?: (port: number) => Socket;
  /** the command that runs the box end (test seam; the box runs the image's node) */
  command?: readonly string[];
}

/** `boxPort` is kept across a respawn (the box end asks for it again); `open` says the box listens on it now */
interface Service { target: number; boxPort: number | null; open: boolean; waiters: Array<{ resolve(port: number): void; reject(e: Error): void }> }
interface Stream { sock: Socket; asked: boolean; paused: boolean }

export class BoxLink {
  private readonly log: (line: string) => void;
  private readonly streamCap: number;
  private readonly totalCap: number;
  private readonly services = new Map<string, Service>();
  private readonly streams = new Map<number, Stream>();
  private child: ChildProcess | null = null;
  private ready = false;
  private stopped = false;
  private held = false;
  private delay: number;
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** counters for the log and the tests */
  readonly stats = { starts: 0, opened: 0, dropped: 0, bytesIn: 0, bytesOut: 0 };

  constructor(private readonly o: BoxLinkOptions) {
    this.log = o.log ?? ((line) => console.log(`[boxlink] ${line}`));
    this.streamCap = o.streamCapBytes ?? STREAM_CAP_BYTES;
    this.totalCap = o.totalCapBytes ?? TOTAL_CAP_BYTES;
    this.delay = o.backoffFirstMs ?? 500;
  }

  /** true once the box end said hello and has not ended since */
  get up(): boolean { return this.ready && !!this.child; }

  /** the box port a service listens on now, or null */
  boxPort(svc: string): number | null { const s = this.services.get(svc); return s?.open ? s.boxPort : null; }

  start(): void {
    if (this.stopped || this.child) return;
    const box = this.o.box();
    if (!box || box.dead) { this.log('no box to link to'); return; }
    try {
      const dir = join(this.o.workDir, '.nm-box');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(this.o.workDir, BOXLINK_REL), BOXLINK_SCRIPT, { mode: 0o644 });
    } catch (e) {
      this.log(`the box end could not be written: ${e instanceof Error ? e.message : String(e)}`);
      this.later();
      return;
    }
    const env: Record<string, string> = { NM_BOXLINK_STREAM_CAP: String(this.streamCap), NM_BOXLINK_TOTAL_CAP: String(this.totalCap) };
    let child: ChildProcess;
    try {
      child = box.exec(this.o.command ?? ['node', `${BOX_WORK}/${BOXLINK_REL}`], { stdin: 'pipe', env });
    } catch (e) {
      this.log(`the box end did not start: ${e instanceof Error ? e.message : String(e)}`);
      this.later();
      return;
    }
    this.child = child;
    this.ready = false;
    this.held = false;
    this.startedAt = Date.now();
    this.stats.starts += 1;
    const tail: string[] = [];
    const reader = new FrameReader((f) => this.onFrame(f), (why) => { this.log(`broken link (${why}); restarting`); child.kill('SIGKILL'); });
    child.stdout?.on('data', (d: Buffer) => reader.push(d));
    child.stderr?.on('data', (d: Buffer) => { tail.push(String(d)); if (tail.length > 20) tail.shift(); });
    child.stdin?.on('error', () => {});
    const ended = (why: string): void => {
      if (this.child !== child) return;
      this.child = null;
      this.ready = false;
      for (const [id] of this.streams) this.drop(id, false);
      for (const s of this.services.values()) { s.open = false; for (const w of s.waiters.splice(0)) w.reject(new Error(`the box link ended (${why})`)); }
      if (this.stopped) return;
      this.log(`the box end ended (${why})${tail.length ? `: ${tail.join('').trim().slice(-300)}` : ''}`);
      this.later();
    };
    child.once('exit', (code, signal) => ended(`exit ${code ?? signal}`));
    child.once('error', (e) => ended(e.message));
  }

  /** expose a service on the supervisor's loopback `target` to the box; resolves with the box port */
  expose(svc: string, target: number, timeoutMs = 10_000): Promise<number> {
    const s = this.services.get(svc) ?? { target, boxPort: null, open: false, waiters: [] };
    s.target = target;
    this.services.set(svc, s);
    if (this.stopped) return Promise.reject(new Error('the box link is stopped'));
    if (s.boxPort !== null && s.open && this.up) return Promise.resolve(s.boxPort);
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => { s.waiters = s.waiters.filter((w) => w.resolve !== ok); reject(new Error(`the box did not open ${svc} within ${timeoutMs} ms`)); }, timeoutMs);
      (timer as { unref?: () => void }).unref?.();
      const ok = (port: number): void => { clearTimeout(timer); resolve(port); };
      s.waiters.push({ resolve: ok, reject: (e) => { clearTimeout(timer); reject(e); } });
      if (this.up) this.send({ t: 'listen', svc, port: s.boxPort ?? 0 });
      else this.start();
    });
  }

  async stop(why: string): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const [id] of this.streams) this.drop(id, false);
    for (const s of this.services.values()) for (const w of s.waiters.splice(0)) w.reject(new Error(`the box link stopped (${why})`));
    const child = this.child;
    this.child = null;
    this.ready = false;
    if (child) {
      child.stdin?.end();
      const gone = new Promise<void>((r) => { child.once('exit', () => r()); setTimeout(r, 2_000).unref?.(); });
      child.kill('SIGTERM');
      await gone;
    }
    this.log(`stopped (${why}): ${this.stats.opened} streams, ${this.stats.bytesIn} bytes in, ${this.stats.bytesOut} out, ${this.stats.dropped} dropped`);
  }

  private later(): void {
    if (this.stopped || this.timer) return;
    const box = this.o.box();
    if (!box || box.dead) { this.log('the box is gone: the link stays down'); return; }
    if (this.startedAt && Date.now() - this.startedAt > STABLE_MS) this.delay = this.o.backoffFirstMs ?? 500;
    const wait = this.delay;
    this.delay = Math.min(this.o.backoffMaxMs ?? 30_000, this.delay * 2);
    this.timer = setTimeout(() => { this.timer = null; this.start(); }, wait);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private send(f: Frame): void {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) return;
    if (stdin.write(encodeFrame(f)) || this.held) return;
    // the pipe to the box is full: no upstream socket reads until it drains
    this.held = true;
    for (const s of this.streams.values()) s.sock.pause();
    stdin.once('drain', () => { this.held = false; for (const s of this.streams.values()) if (!s.paused) s.sock.resume(); });
  }

  private onFrame(f: Frame): void {
    switch (f.t) {
      case 'hello':
        this.ready = true;
        this.log(`up (box end v${f.v}${this.stats.starts > 1 ? `, start ${this.stats.starts}` : ''})`);
        for (const [svc, s] of this.services) this.send({ t: 'listen', svc, port: s.boxPort ?? 0 });
        return;
      case 'listening': {
        const s = this.services.get(f.svc);
        if (!s) return;
        if (s.boxPort !== f.port) this.log(`${f.svc} → box 127.0.0.1:${f.port} (supervisor 127.0.0.1:${s.target})`);
        s.boxPort = f.port;
        s.open = true;
        for (const w of s.waiters.splice(0)) w.resolve(f.port);
        return;
      }
      case 'refused': {
        const s = this.services.get(f.svc);
        for (const w of s?.waiters.splice(0) ?? []) w.reject(new Error(`the box refused ${f.svc}: ${f.error}`));
        return;
      }
      case 'open': {
        const s = this.services.get(f.svc);
        if (!s) { this.send({ t: 'close', id: f.id }); return; }
        const sock = (this.o.connect ?? ((port) => netConnect({ host: '127.0.0.1', port })))(s.target);
        const st: Stream = { sock, asked: false, paused: false };
        this.streams.set(f.id, st);
        this.stats.opened += 1;
        if (this.held) sock.pause();
        sock.on('data', (d: Buffer) => {
          this.stats.bytesOut += d.length;
          for (const fr of dataFrames(f.id, d)) this.send(fr);
          // one chunk per turn (the header): read the box's frames (a pause) before this socket again
          sock.pause();
          setImmediate(() => { if (this.streams.get(f.id) === st && !st.paused && !this.held) sock.resume(); });
        });
        sock.on('close', () => { if (this.streams.get(f.id) === st) { this.streams.delete(f.id); this.send({ t: 'close', id: f.id }); } });
        sock.on('error', () => {});
        return;
      }
      case 'data': {
        const st = this.streams.get(f.id);
        if (!st) return;
        const buf = Buffer.from(f.d, 'base64');
        this.stats.bytesIn += buf.length;
        st.sock.write(buf);
        const q = st.sock.writableLength;
        if (q > 4 * this.streamCap) { this.log(`stream ${f.id} dropped: ${q} bytes queued (cap ${this.streamCap})`); this.drop(f.id, true); return; }
        if (q > this.streamCap && !st.asked) {
          st.asked = true;
          this.send({ t: 'pause', id: f.id });
          st.sock.once('drain', () => { st.asked = false; if (this.streams.get(f.id) === st) this.send({ t: 'resume', id: f.id }); });
        }
        if (this.queued() > this.totalCap) {
          let big: [number, Stream] | null = null;
          for (const e of this.streams) if (!big || e[1].sock.writableLength > big[1].sock.writableLength) big = e;
          if (big) { this.log(`stream ${big[0]} dropped: the link holds over ${this.totalCap} bytes`); this.drop(big[0], true); }
        }
        return;
      }
      case 'close': {
        const st = this.streams.get(f.id);
        if (!st) return;
        this.streams.delete(f.id);
        st.sock.end();
        return;
      }
      case 'pause': { const st = this.streams.get(f.id); if (st) { st.paused = true; st.sock.pause(); } return; }
      case 'resume': { const st = this.streams.get(f.id); if (st) { st.paused = false; if (!this.held) st.sock.resume(); } return; }
      default: return;
    }
  }

  /** bytes queued toward supervisor-side sockets, over all streams */
  queued(): number {
    let n = 0;
    for (const s of this.streams.values()) n += s.sock.writableLength;
    return n;
  }

  private drop(id: number, tell: boolean): void {
    const st = this.streams.get(id);
    if (!st) return;
    this.streams.delete(id);
    st.sock.destroy();
    this.stats.dropped += tell ? 1 : 0;
    if (tell) this.send({ t: 'close', id });
  }
}

/** NM_BOX_LINK: `stdio` (the default, this link) or `veth` (the gateway listeners, as before 2026-10-29) */
export function boxLinkModeOf(env: NodeJS.ProcessEnv): 'stdio' | 'veth' {
  const v = (env['NM_BOX_LINK'] ?? '').trim();
  if (v === '' || v === 'stdio') return 'stdio';
  if (v === 'veth') return 'veth';
  throw new Error(`NM_BOX_LINK=${v} must be stdio or veth`);
}
