// INSTALLING AND STARTING THE RUNTIME (review F3): the download rows, the unpack steps, the first
// `colima start`, the DMG opened and the socket waited on. Every step reports through `emit` so
// the card's bars move; nothing here asks the person for anything.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StackEvent } from './driver';
import { COLIMA_START_ARGS, engineSockets, nmBinDir, startCommand, type EngineKind } from './engine';
import { downloadAsset, installPlan, runtimePath, unpackCommands, type DownloadFs, type Runtime } from './install';
import { run, waitFor, type SpawnFn } from './proc';

export const realFs: DownloadFs = {
  mkdirp: (d) => mkdirSync(d, { recursive: true }),
  writeFile: (p, b, mode) => { writeFileSync(p, b); if (mode) chmodSync(p, mode); },
  remove: (p) => rmSync(p, { force: true }),
  exists: (p) => existsSync(p),
  readFile: (p) => readFileSync(p),
};

export interface RuntimeDeps {
  /** the real home, for the engines' sockets */
  home: string;
  /** brainRoot(), for our binaries and downloads */
  root: string;
  env: NodeJS.ProcessEnv;
  spawn: SpawnFn;
  fetchImpl: typeof fetch;
  fs: DownloadFs;
  emit: (ev: StackEvent) => void;
  log: (line: string) => void;
  sleepImpl?: (ms: number) => Promise<void>;
}

/** the env every runtime command runs with: the app's bin dir ahead of PATH */
export const runtimeEnv = (d: Pick<RuntimeDeps, 'root' | 'env'>): NodeJS.ProcessEnv => ({ ...d.env, PATH: runtimePath(d.root, d.env['PATH']) });

/** the socket a runtime answers on once it is up */
export const socketFor = (runtime: Runtime | EngineKind, home: string): string | null =>
  engineSockets(home).find((s) => s.engine === runtime)?.path ?? null;

const ENGINE_BUDGET_MS = 10 * 60_000; // a DMG install includes the person's own clicks

/** download every item of the plan, verified, then place it */
export async function downloadRuntime(runtime: Runtime, d: RuntimeDeps): Promise<void> {
  const plan = installPlan(runtime, d.root);
  d.emit({ type: 'install.begin', runtime, items: plan.map((i) => i.name) });
  d.fs.mkdirp(nmBinDir(d.root));
  for (const item of plan) {
    d.log(`install ${item.name} ← ${item.asset.url}`);
    await downloadAsset(item, { fs: d.fs, fetchImpl: d.fetchImpl, onProgress: (bytes, total) => d.emit({ type: 'install.progress', name: item.name, bytes, total }) });
    for (const step of unpackCommands(item, d.root)) {
      const r = await run(d.spawn, step.bin, step.args, { env: runtimeEnv(d) });
      if (r.code !== 0) throw new Error(`${item.name}: ${step.bin} failed (${r.code}): ${r.err.trim().slice(0, 160)}`);
    }
  }
}

/** wait until the engine answers on its socket (`docker info` through OUR docker, DOCKER_HOST set) */
export async function waitForEngine(runtime: Runtime | EngineKind, dockerBin: string | null, d: RuntimeDeps, budgetMs = ENGINE_BUDGET_MS): Promise<boolean> {
  const sock = socketFor(runtime, d.home);
  const bin = dockerBin ?? join(nmBinDir(d.root), 'docker');
  return waitFor(async () => {
    if (sock && !d.fs.exists(sock)) return false;
    const r = await run(d.spawn, bin, ['info', '--format', '{{.OperatingSystem}}'], { env: { ...runtimeEnv(d), ...(sock ? { DOCKER_HOST: `unix://${sock}` } : {}) }, timeoutMs: 8000 });
    return r.code === 0;
  }, { everyMs: 2000, budgetMs, sleepImpl: d.sleepImpl });
}

/**
 * The whole install lane for a pick. Colima: the four downloads, then the first `colima start`
 * with the pinned VM shape (vz, 2 CPUs, 4 GB, 20 GB — no password). OrbStack and Docker Desktop:
 * their DMG, opened, and the socket waited on while the person finishes in the installer.
 */
export async function installRuntime(runtime: Runtime, d: RuntimeDeps): Promise<void> {
  await downloadRuntime(runtime, d);
  if (runtime === 'colima') {
    d.emit({ type: 'install.vm', vm: 'starting' });
    d.log(`colima ${COLIMA_START_ARGS.join(' ')}`);
    const r = await run(d.spawn, join(nmBinDir(d.root), 'colima'), [...COLIMA_START_ARGS], { env: runtimeEnv(d), timeoutMs: 15 * 60_000 });
    if (r.code !== 0) throw new Error(`colima start failed (${r.code}): ${(r.err || r.out).trim().slice(-240)}`);
    d.emit({ type: 'install.vm', vm: 'ready' });
    return;
  }
  // the DMG is open: the installer is theirs to finish, the socket is ours to wait on
  const up = await waitForEngine(runtime, null, d);
  if (!up) throw new Error(`${runtime === 'orbstack' ? 'OrbStack' : 'Docker Desktop'} did not start. Finish the install in its window, then scan again.`);
}

/** a stopped engine, started by the app (A2) — resolves once it answers */
export async function startEngine(engine: EngineKind, dockerBin: string | null, d: RuntimeDeps): Promise<boolean> {
  const cmd = startCommand(engine, d.root);
  if (!cmd) return false;
  d.emit({ type: 'engine.starting', engine });
  d.log(`engine start: ${cmd.bin} ${cmd.args.join(' ')}`);
  // `open -a` returns at once; `colima start` blocks until the VM is up, so it gets the long budget
  const r = await run(d.spawn, cmd.bin, cmd.args, { env: runtimeEnv(d), timeoutMs: engine === 'colima' ? 10 * 60_000 : 30_000 });
  if (r.code !== 0) { d.log(`engine start failed (${r.code}): ${r.err.trim().slice(0, 200)}`); return false; }
  return waitForEngine(engine, dockerBin, d, 3 * 60_000);
}

export const ENGINE_LABEL: Record<EngineKind, string> = { colima: 'Colima', orbstack: 'OrbStack', 'docker-desktop': 'Docker Desktop', other: 'Docker' };
export const RUNTIME_LABEL: Record<Runtime, string> = { colima: 'Colima', orbstack: 'OrbStack', 'docker-desktop': 'Docker Desktop' };
