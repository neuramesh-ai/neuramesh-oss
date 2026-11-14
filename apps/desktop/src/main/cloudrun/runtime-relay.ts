// THE RELAY: how an SDK's child CLI runs in the box although only PID 1 may call `sandbox`.
//
// The Claude Agent SDK (`pathToClaudeCodeExecutable`), the Codex SDK (`codexPathOverride`) and the agy
// spawns each start a CLI as their own child. On a Cloud Run machine that child is a relay wrapper
// (written here, one per target). The wrapper runs on the HOST, so it reaches machined over
// 127.0.0.1; it sends its argv, cwd and env with the ticket from its env, then streams stdin in and
// stdout/stderr/exit back. machined (PID 1) runs the real CLI in the box (`BoxRuntimeSpawner`) and
// pipes the two together. The wrapper never spawns anything: no `child_process`, no `sandbox`
// (invariant 4: `sandbox exec` kills its parent, so it must be machined's own child).
//
// Frames, both ways: [type u8][length u32 BE][payload]. Backpressure is TCP's: a side that cannot
// write pauses its reader until 'drain'. A wrapper that goes away (the SDK killed it) takes its box
// process with it: the socket closes, and machined signals the process in the box.
import { createServer, type Server, type Socket } from 'node:net';
import type { Readable } from 'node:stream';
import type { BoxProcess, SpawnRequest } from './runtime-box';
import { BOX_TARGETS } from './runtime-state';

export * from './runtime-relay-protocol';
export * from './runtime-relay-wrapper';
import { FRAME, FrameDecoder, Tickets, encodeFrame, parseHello, type Frame, type Hello } from './runtime-relay-protocol';
const HELLO_TIMEOUT_MS = 10_000;
const SIGNALS = new Set(['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT', 'SIGKILL']);

export interface RelaySpawner { spawn(req: SpawnRequest): Promise<BoxProcess> }

export class RelayServer {
  readonly tickets: Tickets;
  private server: Server | null = null;
  private readonly conns = new Set<Socket>();
  private readonly log: (line: string) => void;

  constructor(private readonly o: { spawner: RelaySpawner; log?: (line: string) => void; now?: () => number; helloTimeoutMs?: number; targets?: readonly string[] }) {
    this.tickets = new Tickets(o.now);
    this.log = o.log ?? ((line) => console.log(`[box-relay] ${line}`));
  }

  /** loopback only: the wrapper is the SDK's child on the host */
  async listen(host = '127.0.0.1', port = 0): Promise<number> {
    const server = createServer((sock) => this.accept(sock));
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve()); });
    this.server = server;
    const addr = server.address();
    return typeof addr === 'object' && addr ? addr.port : 0;
  }

  mintTicket(): string { return this.tickets.mint(); }

  async close(): Promise<void> {
    for (const c of this.conns) c.destroy();
    const s = this.server;
    this.server = null;
    if (s) await new Promise<void>((r) => s.close(() => r()));
  }

  private accept(sock: Socket): void {
    this.conns.add(sock);
    sock.setNoDelay(true);
    const decoder = new FrameDecoder();
    let proc: BoxProcess | null = null;
    let starting = false;
    let finished = false;
    const queued: Frame[] = [];
    // machined is PID 1: nothing a wrapper sends may throw out of an event handler here
    const send = (type: number, payload?: Buffer | string): boolean => {
      if (!sock.writable) return false;
      try { return sock.write(encodeFrame(type, payload)); } catch { sock.destroy(); return false; }
    };
    const fail = (why: string, code = 126): void => {
      if (finished) return;
      finished = true;
      this.log(`refused a spawn: ${why}`);
      send(FRAME.FAIL, `nm-box-relay: ${why}`);
      send(FRAME.EXIT, JSON.stringify({ code, signal: null }));
      sock.end();
    };
    const helloTimer = setTimeout(() => { if (!proc && !starting) fail('no hello'); }, this.o.helloTimeoutMs ?? HELLO_TIMEOUT_MS);
    helloTimer.unref?.();

    let inBlocked = false;
    const handle = (f: Frame): void => {
      if (!proc) { queued.push(f); return; }
      if (f.type === FRAME.STDIN) {
        if (proc.stdin.writableEnded || proc.stdin.destroyed) return;
        if (!proc.stdin.write(f.payload) && !inBlocked) { inBlocked = true; sock.pause(); proc.stdin.once('drain', () => { inBlocked = false; sock.resume(); }); }
      } else if (f.type === FRAME.STDIN_END) {
        if (!proc.stdin.writableEnded) proc.stdin.end();
      } else if (f.type === FRAME.SIGNAL) {
        const sig = f.payload.toString('utf8');
        if (SIGNALS.has(sig)) proc.kill(sig);
      }
    };

    const start = async (hello: Hello): Promise<void> => {
      starting = true;
      const p = await Promise.resolve().then(() => this.o.spawner.spawn({ target: hello.target, argv: hello.argv, cwd: hello.cwd, env: hello.env })).catch((err: unknown) => {
        fail(`the box could not start ${hello.target}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
      if (!p) return;
      proc = p;
      p.stdin.on('error', () => { /* the box process is gone; its exit is on the way */ });
      if (finished || sock.destroyed) { p.kill('SIGTERM'); return; }
      // the wrapper cannot keep up (its SDK stopped reading): stop reading the box until it drains
      let outBlocked = false;
      const pump = (src: Readable, type: number): void => {
        src.on('data', (c: Buffer | string) => {
          if (!send(type, typeof c === 'string' ? Buffer.from(c) : c) && !outBlocked) {
            outBlocked = true;
            p.stdout.pause(); p.stderr.pause();
            sock.once('drain', () => { outBlocked = false; p.stdout.resume(); p.stderr.resume(); });
          }
        });
      };
      pump(p.stdout, FRAME.STDOUT);
      pump(p.stderr, FRAME.STDERR);
      p.onExit((code, signal) => {
        if (finished) return;
        finished = true;
        send(FRAME.EXIT, JSON.stringify({ code, signal }));
        sock.end();
      });
      for (const f of queued.splice(0)) handle(f);
    };

    sock.on('data', (chunk: Buffer) => {
      let frames: Frame[];
      try { frames = decoder.push(chunk); } catch (err) { fail(err instanceof Error ? err.message : 'bad frame'); return; }
      for (const f of frames) {
        if (!proc && !starting) {
          if (f.type !== FRAME.HELLO) { fail('the first frame must be the hello'); return; }
          clearTimeout(helloTimer);
          let hello: Hello;
          try { hello = parseHello(f.payload, this.o.targets ?? BOX_TARGETS); } catch (err) { fail(err instanceof Error ? err.message : 'bad hello'); return; }
          if (!this.tickets.redeem(hello.ticket)) { fail('the relay ticket is unknown or expired'); return; }
          void start(hello);
          continue;
        }
        handle(f);
      }
    });
    const gone = (): void => {
      clearTimeout(helloTimer);
      this.conns.delete(sock);
      // the wrapper went away first (its SDK killed it): its box process goes too
      if (!finished) { finished = true; proc?.kill('SIGTERM'); }
    };
    sock.on('close', gone);
    sock.on('error', () => sock.destroy());
  }
}

// ── The wrapper ─────────────────────────────────────────────────────────────────────────────────
