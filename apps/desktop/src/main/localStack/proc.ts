// The one seam between the stack driver and the operating system: a spawn the tests replace.
import { spawn as nodeSpawn } from 'node:child_process';
import { createServer } from 'node:net';

export interface ChildLike {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on: (ev: 'close' | 'error', cb: (v: number | null | Error) => void) => unknown;
  kill?: () => void;
}
export type SpawnFn = (bin: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }) => ChildLike;

export const nodeSpawnFn: SpawnFn = (bin, args, opts) => nodeSpawn(bin, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] }) as unknown as ChildLike;

export interface RunResult { code: number; out: string; err: string }

/** run to completion, both streams captured */
export function run(spawn: SpawnFn, bin: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((res) => {
    let out = '';
    let err = '';
    let done = false;
    const finish = (r: RunResult) => { if (!done) { done = true; res(r); } };
    let p: ChildLike;
    try { p = spawn(bin, args, { cwd: opts.cwd, env: opts.env }); } catch (e) { return finish({ code: 127, out: '', err: e instanceof Error ? e.message : String(e) }); }
    p.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    p.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
    p.on('close', (code) => finish({ code: typeof code === 'number' ? code : 1, out, err }));
    p.on('error', (e) => finish({ code: 127, out, err: e instanceof Error ? e.message : String(e) }));
    if (opts.timeoutMs) setTimeout(() => { if (!done) { p.kill?.(); finish({ code: 124, out, err: `${bin} timed out after ${opts.timeoutMs}ms` }); } }, opts.timeoutMs).unref?.();
  });
}

/** run with every line of both streams handed to `onLine` as it arrives (docker pull's progress) */
export function runLines(spawn: SpawnFn, bin: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }, onLine: (line: string) => void): Promise<RunResult> {
  return new Promise((res) => {
    let err = '';
    let done = false;
    const finish = (r: RunResult) => { if (!done) { done = true; res(r); } };
    let p: ChildLike;
    try { p = spawn(bin, args, opts); } catch (e) { return finish({ code: 127, out: '', err: e instanceof Error ? e.message : String(e) }); }
    const feed = (keep: (s: string) => void) => {
      let buf = '';
      return (d: Buffer) => {
        buf += d.toString();
        const parts = buf.split(/\r?\n|\r/);
        buf = parts.pop() ?? '';
        for (const line of parts) { if (line.trim()) { keep(line); onLine(line); } }
      };
    };
    p.stdout?.on('data', feed(() => {}));
    p.stderr?.on('data', feed((l) => { err += l + '\n'; }));
    p.on('close', (code) => finish({ code: typeof code === 'number' ? code : 1, out: '', err }));
    p.on('error', (e) => finish({ code: 127, out: '', err: e instanceof Error ? e.message : String(e) }));
  });
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** poll `probe` until it answers true or the budget runs out */
export async function waitFor(probe: () => Promise<boolean>, opts: { everyMs: number; budgetMs: number; sleepImpl?: (ms: number) => Promise<void>; now?: () => number }): Promise<boolean> {
  const now = opts.now ?? Date.now;
  const zzz = opts.sleepImpl ?? sleep;
  const deadline = now() + opts.budgetMs;
  for (;;) {
    if (await probe()) return true;
    if (now() >= deadline) return false;
    await zzz(opts.everyMs);
  }
}

/** can 127.0.0.1:port be bound right now — the preflight's OS probe (a wildcard listener on
 *  another address does not count, exactly as Docker's own bind would not collide with it) */
export function portFree(port: number): Promise<boolean> {
  return new Promise((res) => {
    const srv = createServer();
    srv.once('error', () => res(false));
    srv.listen({ port, host: '127.0.0.1' }, () => srv.close(() => res(true)));
  });
}
