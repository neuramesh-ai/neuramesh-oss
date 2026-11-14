// RUNS EVERY AGENT CLI TURN INSIDE THE AGENT BOX (README.md, "Agent runtimes in the box").
//
// machined is PID 1 and the only process that may run `sandbox` (invariant 4), so a runtime CLI in
// the box is always `BoxManager.exec`, called from here. This file turns what an SDK asked to spawn on
// the host (a target CLI, argv, cwd, env) into that exec:
//   - paths: the host work dir is /work in the box. cwd, argv words and env values are mapped host →
//     box; the CLI's stdout is mapped box → host, line by line, so the host-side tools and the policy
//     gate see host paths. stdin is passed through unmapped: the box also has /nm/work → /work
//     (runtime-start.ts), so a host path in a prompt still resolves, and a prompt that merely
//     mentions the host prefix is not rewritten.
//   - env: an allowlist, then PATH/HOME/TERM/LANG/TMPDIR set for the box. Anything that names or
//     looks like a credential rides secretEnv (0400 files read by the in-box prelude), never argv.
//   - loopback URLs (the tool bus, the egress proxy) are rewritten to the host veth IP and the port
//     machined exposes there; one that has no exposed port is dropped (it could not connect anyway).
//   - argv: every word that is not a bare flag is staged as a file, so the prompt, the MCP config
//     and the per-turn bus secret never reach the sandbox CLI's command line (it is logged).
import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { createServer, connect as netConnect, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { type BoxResult, type ExecOptions } from './box';
import { type BoxTarget } from './runtime-state';

// ── Paths ───────────────────────────────────────────────────────────────────────────────────────

export * from './runtime-box-map';
import { PathMap, UrlRewrite, rewriteStream, boxRuntimeEnv } from './runtime-box-map';

export interface BoxExecLike {
  exec(cmd: readonly string[], o?: ExecOptions): ChildProcess;
  signal(pidFile: string, signal: string): Promise<BoxResult>;
}

/** what an SDK asked the host to spawn, as the relay wrapper saw it */
export interface SpawnRequest {
  target: string;
  argv: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
}

export interface ExecPlan {
  cmd: string[];
  env: Record<string, string>;
  secretEnv: Record<string, string>;
  cwd: string;
  mkdirs: string[];
  pidFile: string;
  dropped: string[];
}

/** A running box process. `onExit` fires once, after stdout and stderr have ended and the exec has
 *  closed, so a consumer that reads both streams loses no trailing output. */
export interface BoxProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(signal?: string): void;
  onExit(cb: (code: number | null, signal: string | null) => void): void;
}

/** the CLI each target runs in the box, resolved on the box's PATH (same image, same installs) */
export const DEFAULT_BOX_BINS: Record<BoxTarget, string> = { claude: 'claude', codex: 'codex', agy: 'agy' };
/** a bare flag (`--verbose`, `-p`) stays visible in the logged command line; every other word is staged */
const BARE_FLAG = /^--?[A-Za-z][A-Za-z0-9-]*$/;
const SIGNAL_NAMES = new Set(['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT', 'SIGKILL']);

export interface SpawnerOptions {
  box: BoxExecLike;
  paths: PathMap;
  urls: UrlRewrite;
  /** the per-box bus bearer (secretEnv), null when the bus is not exposed */
  bearer?: string | null;
  /** target → the command the box runs (the runtimes' CLIs by default; the e2e shell when enabled) */
  bins?: Readonly<Record<string, string>>;
  /** host temp root: an argv dir under it is created in the box too (codex's throwaway --cd dir) */
  hostTmp?: string;
  isDir?: (p: string) => boolean;
  /** runs before each plan (exposes the egress proxy once it is up) */
  beforeSpawn?: () => Promise<void>;
  log?: (line: string) => void;
  /** TERM → KILL in the box after this, then the local `sandbox exec` after as long again */
  killGraceMs?: number;
}

const isDirSync = (p: string): boolean => { try { return statSync(p).isDirectory(); } catch { return false; } };

export class BoxRuntimeSpawner {
  private readonly bins: Record<string, string>;
  private readonly hostTmp: string;
  private readonly isDir: (p: string) => boolean;
  private readonly log: (line: string) => void;

  constructor(private readonly o: SpawnerOptions) {
    this.bins = { ...DEFAULT_BOX_BINS, ...(o.bins ?? {}) };
    this.hostTmp = (o.hostTmp ?? tmpdir()).replace(/\/+$/, '');
    this.isDir = o.isDir ?? isDirSync;
    this.log = o.log ?? ((line) => console.log(`[box-runtime] ${line}`));
  }

  /** pure: the exec a request becomes (no spawn) */
  plan(req: SpawnRequest): ExecPlan {
    const bin = Object.hasOwn(this.bins, req.target) ? this.bins[req.target] : undefined;
    if (!bin) throw new Error(`The box runs no CLI for "${req.target}".`);
    if (!Array.isArray(req.argv) || req.argv.some((a) => typeof a !== 'string')) throw new Error('The argv must be strings.');
    if (typeof req.cwd !== 'string' || !req.cwd.startsWith('/')) throw new Error('The cwd must be an absolute path.');
    const mapWord = (w: string): string => this.o.paths.textToBox(this.o.urls.rewrite(w));
    const args = req.argv.map(mapWord);
    const { env, secretEnv, dropped } = boxRuntimeEnv(req.env, { paths: this.o.paths, urls: this.o.urls, bearer: this.o.bearer ?? null });
    const mkdirs: string[] = [];
    // a cwd outside the work dir (os.tmpdir() for a tool-less turn) is made at the same path in the box
    const mapped = this.o.paths.toBox(req.cwd);
    const cwd = mapped ?? req.cwd;
    if (mapped === null) mkdirs.push(req.cwd);
    for (const a of req.argv) {
      if (a.startsWith(`${this.hostTmp}/`) && this.o.paths.toBox(a) === null && !/[\n\r]/.test(a) && this.isDir(a)) mkdirs.push(a);
    }
    const pidFile = `/tmp/nm-exec/${randomBytes(8).toString('hex')}.pid`;
    return { cmd: [bin, ...args], env, secretEnv, cwd, mkdirs: [...new Set(mkdirs)], pidFile, dropped };
  }

  async spawn(req: SpawnRequest): Promise<BoxProcess> {
    await this.o.beforeSpawn?.();
    const plan = this.plan(req);
    if (plan.dropped.length) this.log(`${req.target}: env not passed to the box: ${plan.dropped.join(', ')}`);
    const child = this.o.box.exec(plan.cmd, {
      env: plan.env,
      secretEnv: plan.secretEnv,
      stdin: 'pipe',
      cwd: plan.cwd,
      mkdirs: plan.mkdirs,
      pidFile: plan.pidFile,
      hideArg: (w) => !BARE_FLAG.test(w),
    });
    return this.wrap(child, plan.pidFile);
  }

  private wrap(child: ChildProcess, pidFile: string): BoxProcess {
    const box = this.o.box;
    const grace = this.o.killGraceMs ?? 5000;
    const stdout = rewriteStream((s) => this.o.paths.textToHost(s));
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    stdin.on('error', () => { /* a write after the process ended; never an uncaught error in PID 1 */ });
    stdout.on('error', () => {});
    stderr.on('error', () => {});
    // pipe() ends its destination on 'end' only: a source destroyed without one would hang onExit
    const relay = (src: Readable | null, dst: Writable): void => {
      if (!src) { dst.end(); return; }
      src.pipe(dst);
      src.once('close', () => { if (!dst.writableEnded) dst.end(); });
    };
    relay(child.stdout, stdout);
    relay(child.stderr, stderr);
    if (child.stdin) {
      child.stdin.on('error', () => { /* the process ended first: EPIPE */ });
      stdin.pipe(child.stdin);
    } else stdin.resume();
    let closed = false;
    let exit: { code: number | null; signal: string | null } | null = null;
    const waiters: Array<(code: number | null, signal: string | null) => void> = [];
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const ended = (s: Readable): Promise<void> => new Promise((r) => { if (s.readableEnded) r(); else { s.once('end', r); s.once('close', r); s.once('error', () => r()); } });
    const closedP = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      child.once('close', (code: number | null, signal: NodeJS.Signals | null) => resolve({ code, signal }));
      child.once('error', (err: Error) => {
        if (!stderr.writableEnded) stderr.end(`nm-box: sandbox exec failed: ${err.message}\n`);
        if (!stdout.writableEnded) stdout.end();
        resolve({ code: 127, signal: null });
      });
    });
    void Promise.all([closedP, ended(stdout), ended(stderr)]).then(([c]) => {
      closed = true;
      for (const t of timers) clearTimeout(t);
      exit = c;
      for (const w of waiters.splice(0)) w(c.code, c.signal);
    });
    let escalated = false;
    return {
      stdin,
      stdout,
      stderr,
      kill: (signal = 'SIGTERM') => {
        if (closed) return;
        const sig = SIGNAL_NAMES.has(signal) ? signal : 'SIGTERM';
        void box.signal(pidFile, sig).catch(() => {});
        if (escalated) return;
        escalated = true;
        const t1 = setTimeout(() => {
          void box.signal(pidFile, 'SIGKILL').catch(() => {});
          const t2 = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, grace);
          t2.unref?.();
          timers.push(t2);
        }, grace);
        t1.unref?.();
        timers.push(t1);
      },
      onExit: (cb) => { if (exit) cb(exit.code, exit.signal); else waiters.push(cb); },
    };
  }
}

// ── The host veth IP and loopback exposure ──────────────────────────────────────────────────────

/** The default gateway from `/proc/net/route` (read inside the box): the host side of its veth.
 *  The table is little-endian hex: `eth0 00000000 010014AC ...` is 172.20.0.1. */
export function parseDefaultGateway(table: string): string | null {
  // the header line (`Iface Destination Gateway ...`) never has a 00000000 destination
  for (const line of table.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length < 3 || f[1] !== '00000000' || !/^[0-9A-Fa-f]{8}$/.test(f[2]!)) continue;
    const n = Number.parseInt(f[2]!, 16);
    if (!n) continue;
    return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff].join('.');
  }
  return null;
}

/** A plain TCP forward from `host:<new port>` to `127.0.0.1:target`: how the egress proxy, which
 *  binds loopback, is reached from the box. Grants nothing the box lacks (it has egress already); the
 *  proxy only narrows. */
export async function forwardTcp(host: string, target: number): Promise<{ port: number; close(): Promise<void> }> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((client) => {
    const up = netConnect({ host: '127.0.0.1', port: target });
    sockets.add(client); sockets.add(up);
    const drop = (): void => { client.destroy(); up.destroy(); sockets.delete(client); sockets.delete(up); };
    client.on('error', drop); up.on('error', drop);
    client.on('close', drop); up.on('close', drop);
    client.pipe(up); up.pipe(client);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, host, () => resolve()); });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { port, close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }) };
}
