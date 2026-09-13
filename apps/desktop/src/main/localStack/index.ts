// THE LOCAL STACK DRIVER (review F3, F7, F8, F9): from "is there an engine" to "the API answers
// with the version this app expects", every step a state the first-run card draws.
//
// The order is the contract and it must READ that way: probe the engine → install or start it if
// it needs that → the stack's files (compose rendered, .env written 0600, the bearer in the
// keychain) → pull when the tag moved or an image is missing → up → health → nm-config → ready.
// The replica opened before any of this (sync/boot.ts), so a warm boot renders the shell from it
// while the two waits show as the sync mark rather than a blocking card.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Keychain } from '../keychain';
import { PROJECT_NAME, PullProgress, SERVICES, composeCommand, composeImages, isHumanBearer, mintSecrets, parseEnv, planEnv, renderEnv, type StackEnv } from './compose';
import { initialState, reduce, stackBehind, type StackEvent, type StackState } from './driver';
import { detectEngine, nmBinDir, type EngineKind, type EngineProbe } from './engine';
import { downloadRuntime, installRuntime, realFs, runtimeEnv, startEngine, type RuntimeDeps } from './runtime-install';
import type { Runtime } from './install';
import { run, runLines, waitFor, type SpawnFn } from './proc';

/** the keychain account the human bearer is filed under (service: keychain.ts KEYCHAIN_SERVICE) */
export const BEARER_ACCOUNT = 'local-human-bearer';

export interface LocalStackDeps {
  /** the real home — the engines' sockets */
  home: string;
  /** brainRoot() — our binaries, downloads and, unless NM_LOCAL_DIR says otherwise, the stack */
  root: string;
  env: NodeJS.ProcessEnv;
  /** the app's version — the image tag, and what nm-config's version is held to */
  version: string;
  /** `<root>/local` unless NM_LOCAL_DIR says otherwise (compose.ts localDir) */
  dir: string;
  /** the shipped compose file (resources/local/docker-compose.yaml) */
  composeSource: string;
  keychain: Keychain;
  spawn: SpawnFn;
  fetchImpl: typeof fetch;
  which: (bin: string) => Promise<string | null>;
  onState: (s: StackState) => void;
  log: (line: string) => void;
  sleepImpl?: (ms: number) => Promise<void>;
}

const STARTING_BUDGET_MS = 90_000;

export class LocalStack {
  state: StackState = initialState();
  private probe: EngineProbe | null = null;
  private waiters: Array<() => void> = [];
  private pickResolve: (() => void) | null = null;
  private stackEnv: StackEnv | null = null;
  bearer = '';

  constructor(private readonly d: LocalStackDeps) {}

  private emit(ev: StackEvent): void {
    this.state = reduce(this.state, ev);
    this.d.onState(this.state);
    if (this.state.phase === 'ready') { for (const w of this.waiters) w(); this.waiters = []; }
  }

  /** resolves once the stack is ready — sync/boot.ts waits on it before touching the API */
  ready(): Promise<void> {
    if (this.state.phase === 'ready') return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  private rt(): RuntimeDeps {
    const { home, root, env, spawn, fetchImpl, log, sleepImpl } = this.d;
    return { home, root, env, spawn, fetchImpl, fs: realFs, emit: (ev) => this.emit(ev), log, sleepImpl };
  }

  private async detect(): Promise<EngineProbe> {
    const dockerInfo = async (bin: string, socket: string | null) => {
      const r = await run(this.d.spawn, bin, ['info', '--format', '{{.OperatingSystem}}'], { env: { ...runtimeEnv(this.d), ...(socket ? { DOCKER_HOST: `unix://${socket}` } : {}) }, timeoutMs: 8000 });
      return r.code === 0 ? { ok: true, os: r.out.trim() } : { ok: false };
    };
    this.probe = await detectEngine({ home: this.d.home, root: this.d.root, which: this.d.which, exists: existsSync, dockerInfo });
    this.d.log(`engine=${this.probe.engine ?? 'none'} running=${this.probe.running} docker=${this.probe.dockerBin ?? 'none'} socket=${this.probe.socket ?? 'none'}`);
    return this.probe;
  }

  // ── the actions the card offers ──
  pick(runtime: Runtime): void { this.emit({ type: 'pick', runtime }); }
  /** the picker's primary: install the picked runtime (the boot loop is waiting on this) */
  install(): void { if (this.state.phase === 'no-engine') this.pickResolve?.(); }
  /** "Scan again", and the error card's "Try again" */
  rescan(): void { this.pickResolve?.(); }

  private waitForPick(): Promise<void> { return new Promise((r) => { this.pickResolve = r; }); }

  /** the whole sequence — never throws; a failure is the error state with Try again */
  async boot(): Promise<void> {
    for (;;) {
      try {
        await this.bootOnce();
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.d.log(`stack error: ${message}`);
        this.emit({ type: 'error', message });
        await this.waitForPick();
      }
    }
  }

  private async bootOnce(): Promise<void> {
    let probe = await this.detect();
    this.emit({ type: 'probed', probe });
    while (!probe.running) {
      if (!probe.engine) {
        await this.waitForPick();
        if (this.state.phase !== 'no-engine') { probe = await this.detect(); this.emit({ type: 'probed', probe }); continue; }
        await installRuntime(this.state.picked, this.rt());
      } else if (!(await startEngine(probe.engine, probe.dockerBin, this.rt()))) {
        throw new Error(`${probe.engine === 'colima' ? 'Colima' : probe.engine === 'orbstack' ? 'OrbStack' : 'Docker'} did not start.`);
      }
      probe = await this.detect();
      this.emit({ type: 'probed', probe });
    }
    // an engine with no CLI (Colima from elsewhere, a lost PATH): our own static CLI + compose
    if (!probe.dockerBin) { await downloadRuntime('colima', this.rt()); probe = await this.detect(); }
    if (!probe.dockerBin) throw new Error('No docker command found.');
    const plan = await this.prepareFiles();
    await this.pullIfNeeded(probe.dockerBin, plan);
    await this.up(probe.dockerBin);
    await this.awaitHealth(probe.dockerBin);
    const version = await this.awaitConfig();
    this.emit({ type: 'ready', version, engine: probe.engine ?? 'other' });
  }

  /** the compose file rendered, the .env written 0600, the bearer in the keychain — never in the clear on disk */
  private async prepareFiles(): Promise<{ firstRun: boolean; tagChanged: boolean }> {
    const { dir } = this.d;
    for (const sub of ['', 'pgdata', 'powersync']) mkdirSync(join(dir, sub), { recursive: true });
    copyFileSync(this.d.composeSource, join(dir, 'docker-compose.yaml'));
    let bearer = await this.d.keychain.get(BEARER_ACCOUNT);
    if (!isHumanBearer(bearer)) {
      bearer = mintSecrets().humanBearer;
      await this.d.keychain.set(BEARER_ACCOUNT, bearer);
      this.d.log('local bearer minted into the keychain');
    }
    this.bearer = bearer;
    const envPath = join(dir, '.env');
    const existing = parseEnv(existsSync(envPath) ? readFileSync(envPath, 'utf8') : null);
    const plan = planEnv({ existing, version: this.d.version, dir, bearer });
    if (plan.changed) { writeFileSync(envPath, renderEnv(plan.env), { mode: 0o600 }); chmodSync(envPath, 0o600); }
    this.stackEnv = plan.env;
    this.d.log(`stack files at ${dir} firstRun=${plan.firstRun} tagChanged=${plan.tagChanged} tag=${plan.env.NM_IMAGE_TAG}`);
    return plan;
  }

  private dockerEnv(): NodeJS.ProcessEnv {
    return { ...runtimeEnv(this.d), ...(this.probe?.socket ? { DOCKER_HOST: `unix://${this.probe.socket}` } : {}) };
  }

  /** `docker pull`, one image at a time so each row has its own bar (docker compose pull cannot attribute layers) */
  private async pullIfNeeded(dockerBin: string, plan: { firstRun: boolean; tagChanged: boolean }): Promise<void> {
    const images = composeImages(readFileSync(join(this.d.dir, 'docker-compose.yaml'), 'utf8'), this.stackEnv!);
    const missing: typeof images = [];
    for (const im of images) {
      const r = await run(this.d.spawn, dockerBin, ['image', 'inspect', im.image], { env: this.dockerEnv(), timeoutMs: 15_000 });
      if (r.code !== 0) missing.push(im);
    }
    if (!missing.length && !plan.tagChanged) return;
    const todo = plan.tagChanged && !plan.firstRun ? images.filter((im) => im.service === 'control-api' || missing.includes(im)) : images;
    const version = this.d.version;
    this.emit({ type: 'pull.begin', items: todo.map((im) => (plan.tagChanged && !plan.firstRun && im.service === 'control-api' ? `${im.label} ${version}` : im.label)), version, update: plan.tagChanged && !plan.firstRun });
    for (const im of todo) {
      const name = plan.tagChanged && !plan.firstRun && im.service === 'control-api' ? `${im.label} ${version}` : im.label;
      const progress = new PullProgress();
      this.d.log(`pull ${im.image}`);
      const r = await runLines(this.d.spawn, dockerBin, ['pull', im.image], { env: this.dockerEnv() }, (line) => {
        progress.feed(line);
        if (progress.total > 0) this.emit({ type: 'pull.progress', name, bytes: progress.bytes, total: progress.total });
      });
      if (r.code !== 0) throw new Error(`The download of ${im.label} failed: ${r.err.trim().slice(-200)}`);
      this.emit({ type: 'pull.done', name });
    }
  }

  private compose(dockerBin: string, args: string[]) {
    return composeCommand({ dockerBin, root: this.d.root, dir: this.d.dir, hasStandalone: existsSync(join(nmBinDir(this.d.root), 'docker-compose')) }, args);
  }

  private async up(dockerBin: string): Promise<void> {
    this.emit({ type: 'up', services: SERVICES.map((s) => s.label) });
    const c = this.compose(dockerBin, ['up', '-d', '--remove-orphans']);
    this.d.log(`${c.bin} ${c.args.join(' ')}`);
    const r = await run(this.d.spawn, c.bin, c.args, { cwd: c.cwd, env: this.dockerEnv(), timeoutMs: 5 * 60_000 });
    if (r.code !== 0) throw new Error(`The local stack did not start: ${(r.err || r.out).trim().slice(-240)}`);
  }

  /** each container's own healthcheck, polled — 90 s once the images exist */
  private async awaitHealth(dockerBin: string): Promise<void> {
    const pending = new Set(SERVICES.map((s) => s.service));
    const ok = await waitFor(async () => {
      for (const svc of [...pending]) {
        const r = await run(this.d.spawn, dockerBin, ['inspect', '--format', '{{.State.Health.Status}}', `${PROJECT_NAME}-${svc}-1`], { env: this.dockerEnv(), timeoutMs: 10_000 });
        if (r.code === 0 && r.out.trim() === 'healthy') { pending.delete(svc); this.emit({ type: 'health', service: SERVICES.find((s) => s.service === svc)!.label }); }
      }
      return pending.size === 0;
    }, { everyMs: 2000, budgetMs: STARTING_BUDGET_MS, sleepImpl: this.d.sleepImpl });
    if (!ok) throw new Error(`The local stack did not start in 90 seconds (${[...pending].join(', ')} not healthy).`);
  }

  /** /healthz, then nm-config: a stack behind the app is refused (F7), never a half-working shell */
  private async awaitConfig(): Promise<string> {
    const api = `http://127.0.0.1:${this.stackEnv!.NM_API_PORT}`;
    const healthy = await waitFor(async () => (await this.d.fetchImpl(`${api}/healthz`).catch(() => null))?.ok ?? false, { everyMs: 1000, budgetMs: 30_000, sleepImpl: this.d.sleepImpl });
    if (!healthy) throw new Error('The NeuraMesh API did not answer.');
    const res = await this.d.fetchImpl(`${api}/.well-known/nm-config`);
    const cfg = (await res.json().catch(() => ({}))) as { mode?: string; version?: string; schemaVersion?: string | null };
    this.d.log(`nm-config mode=${cfg.mode} version=${cfg.version} schemaVersion=${cfg.schemaVersion ?? 'null'} app=${this.d.version}`);
    if (cfg.mode !== 'local') throw new Error(`The stack at ${api} is not a local stack (mode=${cfg.mode ?? 'unknown'}).`);
    if (stackBehind(cfg.version, this.d.version)) throw new Error(`The local stack is version ${cfg.version ?? 'unknown'}. This app needs ${this.d.version}.`);
    return cfg.version!;
  }

  /** Settings › Connections › Restart: stop, then the same up → health → nm-config walk as boot.
   *  On a warm boot the `starting` state draws as the sync mark, so the shell stays up throughout. */
  async restart(): Promise<void> {
    const bin = this.probe?.dockerBin;
    if (!bin || this.state.phase !== 'ready') return;
    try {
      await this.stop();
      await this.up(bin);
      await this.awaitHealth(bin);
      const version = await this.awaitConfig();
      this.emit({ type: 'ready', version, engine: this.probe?.engine ?? 'other' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.d.log(`restart error: ${message}`);
      this.emit({ type: 'error', message });
    }
  }

  /** the facts Settings › Connections prints for This Mac: where the data lives, the two loopback ports */
  info(): { dir: string; ports: { api: number; powersync: number }; engine: EngineKind | null } {
    const env = this.stackEnv;
    return { dir: this.d.dir, ports: { api: Number(env?.NM_API_PORT) || 8788, powersync: Number(env?.NM_POWERSYNC_PORT) || 58081 }, engine: this.probe?.engine ?? null };
  }

  /** the engine's own version, asked once per ready: Colima says it in `colima version`, the
   *  others through the docker server they run. null when nothing answers — never a guess. */
  async engineVersion(): Promise<string | null> {
    const bin = this.probe?.dockerBin;
    if (!bin || !this.probe?.running) return null;
    if (this.probe.engine === 'colima') {
      const r = await run(this.d.spawn, 'colima', ['version'], { env: runtimeEnv(this.d), timeoutMs: 8000 });
      const m = /colima version\s+v?([0-9][^\s]*)/i.exec(r.out);
      if (r.code === 0 && m) return m[1]!;
    }
    const r = await run(this.d.spawn, bin, ['version', '--format', '{{.Server.Version}}'], { env: this.dockerEnv(), timeoutMs: 8000 });
    return r.code === 0 && r.out.trim() ? r.out.trim() : null;
  }

  /** `compose stop` — containers and the data folder stay; a restart is seconds. NEVER down -v. */
  async stop(): Promise<void> {
    const bin = this.probe?.dockerBin;
    if (!bin || !existsSync(join(this.d.dir, '.env'))) return;
    const c = this.compose(bin, ['stop']);
    this.d.log('compose stop');
    await run(this.d.spawn, c.bin, c.args, { cwd: c.cwd, env: this.dockerEnv(), timeoutMs: 60_000 });
  }
}
