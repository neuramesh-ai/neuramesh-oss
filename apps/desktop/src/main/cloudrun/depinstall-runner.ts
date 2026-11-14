// Bounded process-group execution for dependency installs.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export interface RunSpec {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  /** polled while the install runs. true kills it */
  overBudget?: () => boolean;
}

export interface RunResult { code: number | null; killedFor: 'timeout' | 'memory' | null; tail: string; ms: number }

export type InstallRunner = (spec: RunSpec) => Promise<RunResult>;

export const MEMORY_POLL_MS = 500;

/** the real runner: its own process group, so a kill reaches every child, and only the output's tail */
export function spawnInstallRunner(spawnImpl: (file: string, args: readonly string[], o: SpawnOptions) => ChildProcess = spawn): InstallRunner {
  return (spec) => new Promise((resolve) => {
    const t0 = Date.now();
    let tail = '';
    let killedFor: RunResult['killedFor'] = null;
    let done = false;
    const child = spawnImpl(spec.file, spec.args, { cwd: spec.cwd, env: spec.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (d: Buffer): void => { tail = (tail + d.toString('utf8')).slice(-4096); };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    const kill = (why: 'timeout' | 'memory'): void => {
      if (done || killedFor) return;
      killedFor = why;
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    };
    const timer = setTimeout(() => kill('timeout'), spec.timeoutMs);
    const poll = spec.overBudget ? setInterval(() => { if (spec.overBudget!()) kill('memory'); }, MEMORY_POLL_MS) : null;
    const finish = (code: number | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      resolve({ code, killedFor, tail, ms: Date.now() - t0 });
    };
    child.once('error', (e) => { keep(Buffer.from(String(e.message))); finish(null); });
    child.once('close', (code) => finish(code));
  });
}
