// The machine owns its drain and its epoch fence.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BoxManager } from './box';
import type { CpuSample, MemorySample } from './resources';
import { EpochFencedError, MachineTokenRejected, type Snapshots } from './snapshot';
import { restoreWorkSnapshot, startRestoredBox } from './lifecycle-restore';
import { createLazyWork, type LazyWork } from './lazy-work';
import { useHydration } from '../harness/hydration';
import { PARK_POLL_EVERY, GUARD_MS, LOOP_MS, DRAIN_BUDGET_MS, ALIVE_EVERY, bootEpoch, controlVerdict, snapshotKeysFor, graceFor,
  type MachineState, type DrainReason, type DrainHooks, type ParkHooks, type RestoreOutcome, type LifecycleOptions, type BootStart, type MachineStatus } from './lifecycle-contract';

export class CloudRunLifecycle {
  private stateValue: MachineState = 'booting';
  private epochValue = 0;
  private fencedValue = false;
  private hooks: DrainHooks | null = null;
  private parks: ParkHooks | null = null;
  /** set when this process leaves to restart (restartAfterWake): no further loop pass acts */
  private leaving = false;
  private interactiveReady = false;
  private lazy: LazyWork | null = null;
  private guard: ReturnType<typeof setInterval> | null = null;
  private loop: ReturnType<typeof setTimeout> | null = null;
  private ticks = 0;
  private draining: Promise<void> | null = null;
  private lastMem: MemorySample | null = null;
  private lastCpu: CpuSample | null = null;
  private guardPct: number;
  private boxDownWhy: string | null = null;
  private restoredValue: RestoreOutcome | null = null;
  private readonly log: NonNullable<LifecycleOptions['log']>;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly o: LifecycleOptions) {
    this.log = o.log ?? ((event, fields) => console.log(JSON.stringify({ component: 'nm-cloudrun', event, ...fields })));
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.guardPct = o.cfg.guardPct;
    o.box?.onDeath((why) => { if (this.stateValue === 'running' && this.box) void this.drain('box-crashed').catch((e: unknown) => this.log('drain-error', { error: String(e) })); else this.log('box-died', { why, state: this.stateValue }); });
  }

  /** the snapshot client, for the readers that are not the lifecycle's own: the repository bundle
   *  clone and the dependency cache (cloudrun/depcache.ts). They sign through the same bearer. */
  get snapshots(): Snapshots { return this.o.snapshots; }

  get state(): MachineState { return this.stateValue; }
  get epoch(): number { return this.epochValue; }
  get fenced(): boolean { return this.fencedValue; }
  /** the agent box, for the box runtimes (runtime-start.ts); null while it could not start */
  get boxManager(): BoxManager | null { return this.box; }
  /** why the box could not start this incarnation (the runtimes stay in the supervisor), else null */
  get boxDown(): string | null { return this.boxDownWhy; }
  /** what the boot restored (null before boot, or when the controller named no snapshot) */
  get restored(): RestoreOutcome | null { return this.restoredValue; }
  /** a draining or drained machine starts no new work */
  get accepting(): boolean { return this.stateValue === 'running' && !this.fencedValue; }

  /** The relay acknowledges registration only after its authenticated hello is installed. */
  async setInteractiveReady(ready: boolean): Promise<void> {
    this.interactiveReady = ready;
    if (this.stateValue === 'running' && !this.fencedValue) await this.report(this.status());
    if (ready) this.lazy?.startBackground();
  }

  /** the box the loop and the drain act on: none while it is down */
  private get box(): BoxManager | null { return this.boxDownWhy ? null : this.o.box; }

  /** Restore before opening the replica. Legacy archives may fall back with a loss report.
   * A missing or corrupt manifest core fails closed: the boot breaker holds the machine,
   * keeping the authoritative snapshot instead of allowing a stale or empty replacement. */
  async boot(start: BootStart): Promise<void> {
    const t0 = this.now();
    this.epochValue = bootEpoch(start);
    if (start.guardPct) this.guardPct = start.guardPct;
    this.lastMem = this.o.resources.memory();
    await this.report({ ...this.status(), state: 'booting' });
    mkdirSync(this.o.cfg.workDir, { recursive: true });
    const makeLazy = () => createLazyWork(this.o.cfg, this.epochValue, this.o.snapshots, () => !this.fencedValue && this.stateValue !== 'draining' && this.stateValue !== 'drained', this.log);
    const restored = start.snapshot?.work ? await restoreWorkSnapshot(start.snapshot, this.o, this.log, async key => {
      const lazy = makeLazy(); await lazy.restore(key);
      if (this.o.cfg.lazyRestoreEager) await lazy.ensure(this.o.cfg.workDir);
      this.lazy = lazy;
    }) : null;
    if (!this.lazy && this.o.cfg.lazySnapshots) this.lazy = makeLazy();
    if (this.lazy) useHydration(this.lazy);
    this.restoredValue = restored;
    const restoreMs = this.now() - t0;
    if (restored?.failed.length) {
      const lost = `restore fell back to ${restored.work ?? 'a fresh work dir'}: ${restored.failed.map((f) => `${f.key} (${f.error})`).join('; ')}`;
      this.log('restore-fallback', { epoch: this.epochValue, wanted: start.snapshot?.work, from: restored.work, failed: restored.failed });
      await this.report({ ...this.status(), state: 'booting', restoredFrom: restored.work, restoreMs, error: lost.slice(0, 2000) });
    }
    // the logins go back into the home BEFORE the box starts: the box binds the login dirs at start,
    // and the first runtime probe then sees the person signed in. A failed read is no failed boot
    // (vault.ts): only a fence or a refused token throws, as restoreWork's do
    if (this.o.vault) await this.o.vault.restore();
    if (this.o.box) this.boxDownWhy = (await startRestoredBox(this.o, this.epochValue, restored ? restored.box : null, this.log)) ?? this.boxDownWhy;
    this.stateValue = 'running';
    this.o.vault?.start();
    this.log('ready', { epoch: this.epochValue, restored: restored ? { work: restored.work, box: restored.box } : null, boxDown: this.boxDownWhy, guardPct: this.guardPct, restoreMs, bootMs: this.now() - t0 });
  }

  /** the daemon's hooks exist only after the agent host and the relay start */
  attach(hooks: DrainHooks): void { this.hooks = hooks; }
  attachParks(parks: ParkHooks): void { this.parks = parks; }
  /** the busy rule's park half: machined's beat reports busy while this holds */
  get parksBusy(): boolean { return this.parks?.busySoon() ?? false; }

  start(): void {
    if (this.guard) return;
    this.guard = setInterval(() => this.guardTick(), GUARD_MS);
    const next = (): void => { this.loop = setTimeout(() => { void this.tick().finally(() => { if (this.loop) next(); }); }, LOOP_MS); };
    next();
  }

  stop(): void {
    this.lazy?.stop();
    if (this.guard) clearInterval(this.guard);
    if (this.loop) clearTimeout(this.loop);
    this.guard = null;
    this.loop = null;
  }

  status(): MachineStatus {
    const m = this.lastMem;
    return {
      state: this.stateValue, epoch: this.epochValue, interactiveReady: this.interactiveReady,
      memPct: m?.memPct ?? 0, usedMiB: m?.usedMiB ?? 0, limitMiB: m?.limitMiB ?? 0,
      cpuPct: this.lastCpu?.cpuPct ?? null, throttleRatio: this.lastCpu?.throttleRatio ?? null,
    };
  }

  /** memory can grow 3.8 GiB in one second (measured): this runs every 250 ms, apart from the loop */
  guardTick(): void {
    if (this.stateValue !== 'running' || this.fencedValue) return;
    const m = this.o.resources.memory();
    this.lastMem = m;
    if (m.memPct >= this.guardPct) {
      this.log('oom-guard', { epoch: this.epochValue, memPct: m.memPct, usedMiB: m.usedMiB, limitMiB: m.limitMiB });
      void this.drain('oom-guard').catch((e: unknown) => this.log('drain-error', { error: String(e) }));
    }
  }

  /** one 2 s loop pass: sample, check the box, report, follow control */
  async tick(): Promise<void> {
    if (this.fencedValue || this.leaving) return;
    try {
      this.lastMem = this.o.resources.memory();
      this.lastCpu = this.o.resources.cpu();
      this.ticks += 1;
      if (this.stateValue === 'running' && this.box && (this.box.dead || (this.ticks % ALIVE_EVERY === 0 && !(await this.box.alive())))) {
        this.log('box-crashed', { epoch: this.epochValue });
        await this.drain('box-crashed');
        return;
      }
      if (this.stateValue === 'running' && this.parks && this.ticks % PARK_POLL_EVERY === 0) {
        await this.parks.resumeResolved().catch((e: unknown) => {
          if (e instanceof EpochFencedError || e instanceof MachineTokenRejected) throw e;
          this.log('park-poll-error', { error: String(e) });
        });
      }
      if (this.stateValue === 'running' || this.stateValue === 'completed') await this.report(this.status());
      const verdict = controlVerdict(await this.o.control.read(), this.epochValue, this.stateValue);
      if (verdict === 'fenced') this.fence('control names a newer epoch');
      else if (verdict === 'drain') await this.drain('controller');
      else if (verdict === 'restart') this.restartAfterWake();
    } catch (e) {
      if (e instanceof EpochFencedError) this.fence(e.message);
      else if (e instanceof MachineTokenRejected) await this.tokenRejected(e.message);
      else this.log('loop-error', { error: String(e) });
    }
  }

  /** Stop new turns, park running ones, flush the brain outbox and the queued writes, snapshot the
   *  work dir and the box overlay (if the box lives), report `drained`. One drain per incarnation. */
  drain(reason: DrainReason): Promise<void> {
    if (this.draining) return this.draining;
    if (this.stateValue === 'drained' || this.fencedValue) return Promise.resolve();
    this.draining = this.runDrain(reason).catch(async (e: unknown) => {
      if (e instanceof EpochFencedError) { this.fence(e.message); return; }
      if (e instanceof MachineTokenRejected) { await this.tokenRejected(e.message); return; }
      throw e;
    });
    return this.draining;
  }

  private async runDrain(reason: DrainReason): Promise<void> {
    const hooks = this.hooks;
    this.stateValue = 'draining';
    const t0 = this.now();
    this.log('drain-start', { ...this.status(), reason });
    if (hooks) {
      hooks.holdTurns();
      const grace = graceFor(reason, this.o.cfg.graceMs);
      await this.waitFor(() => hooks.turnsInFlight() === 0, grace);
      await hooks.parkTurns().catch((e: unknown) => this.log('park-error', { error: String(e) }));
      await this.waitFor(() => hooks.turnsInFlight() === 0, 5_000);
      await hooks.flushBrains().catch((e: unknown) => this.log('brain-flush-error', { error: String(e) }));
      await hooks.drainWrites(15_000).catch((e: unknown) => this.log('write-drain-error', { error: String(e) }));
    }
    // a login made in the last poll window lands before the stop. The terminals are closed (parkTurns),
    // so nothing writes a login after this. The agent hands a fence to fence() itself
    if (this.o.vault) {
      await this.o.vault.flush().catch((e: unknown) => this.log('vault-flush-error', { error: String(e) }));
      this.o.vault.stop();
    }
    await this.lazy?.pause();
    const stopMs = this.now() - t0;
    let lastError = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      const attemptAt = this.now();
      try {
        // an OOM-killed box has lost its overlay: save it only while the box lives
        const liveBox = this.box;
        const boxAlive = !!liveBox && !liveBox.dead && (await liveBox.alive());
        const work = this.lazy ? await this.lazy.save() : await this.o.snapshots.save('snapshot', `work-e${this.epochValue}`, this.o.cfg.root, [this.o.cfg.work]);
        // the work dir is the state; a box overlay that will not save is lost like a dead box's,
        // and never costs the drain its work snapshot
        let box: Awaited<ReturnType<Snapshots['boxSave']>> | null = null;
        if (boxAlive && liveBox) {
          try {
            box = await this.o.snapshots.boxSave(liveBox, `box-e${this.epochValue}`, join(this.o.cfg.root, `.box-save-e${this.epochValue}.tar`));
          } catch (e) {
            if (e instanceof EpochFencedError || e instanceof MachineTokenRejected) throw e;
            this.log('box-snapshot-error', { epoch: this.epochValue, error: String(e) });
          }
        }
        const keys = { ...snapshotKeysFor(this.epochValue, box !== null), ...('key' in work ? { work: work.key } : {}) };
        const drained: MachineStatus = { ...this.status(), state: 'drained', reason, snapshot: keys, drainMs: this.now() - t0 };
        await this.report(drained);
        this.stateValue = 'drained';
        this.log('drained', { ...drained, stopMs, work, box });
        return;
      } catch (e) {
        if (e instanceof EpochFencedError || e instanceof MachineTokenRejected) throw e;
        lastError = String(e);
        this.log('snapshot-error', { attempt, error: lastError });
        // Leave at least the observed attempt time plus30s for box save/report
        // and controller polling. A large failed upload must not admit a retry
        // based on the old assumption that every save fits inside30s.
        const retryReserveMs = Math.max(30_000, this.now() - attemptAt + 30_000);
        if (attempt === 3 || this.now() - t0 >= DRAIN_BUDGET_MS - retryReserveMs) break;
        await this.sleep(1_000 * attempt);
      }
    }
    // no `drained` without a snapshot: the controller sees the error and decides
    await this.report({ ...this.status(), state: 'draining', reason, error: lastError }).catch(() => {});
    throw new Error(`The drain could not save the work snapshot: ${lastError}`);
  }

  /** SIGTERM: the drain already ran or never will. Flush what is cheap and leave. */
  async finalFlush(budgetMs = 5_000): Promise<void> {
    this.stop();
    if (this.stateValue === 'drained' || !this.hooks) { this.o.vault?.stop(); return; }
    this.hooks.holdTurns();
    await Promise.race([
      Promise.allSettled([this.hooks.flushBrains(), this.hooks.drainWrites(budgetMs), ...(this.o.vault && !this.fencedValue ? [this.o.vault.flush()] : [])]),
      this.sleep(budgetMs),
    ]);
    this.o.vault?.stop();
  }

  /** woken after its drain (controlVerdict 'restart'): leave, so Cloud Run starts a fresh boot */
  private restartAfterWake(): void {
    this.leaving = true;
    this.stop();
    this.o.vault?.stop();
    this.log('woken-after-drain', { epoch: this.epochValue });
    const exit: (why: string) => void = this.o.exit ?? (() => process.exit(1));
    exit('woken after its drain: a fresh boot restores the snapshot');
  }

  /** stop acting: a newer epoch owns this machine (control, a 409, or a refused token renewal) */
  fence(why: string): void {
    if (this.fencedValue) return;
    this.fencedValue = true;
    this.hooks?.holdTurns();
    this.stop();
    this.o.vault?.stop();
    this.log('fenced', { epoch: this.epochValue, why });
  }

  /** A 401 after boot. Control stays readable with a replaced token: if it names a newer epoch,
   *  another boot owns the machine, so this process fences and stays quiet (a restart would boot
   *  again and fence that one). Otherwise the token expired or is unknown: exit, and Cloud Run
   *  restarts the container into a fresh boot and a new epoch. */
  async tokenRejected(why: string): Promise<void> {
    if (this.fencedValue) return;
    let newer = false;
    try { newer = controlVerdict(await this.o.control.read(), this.epochValue, this.stateValue) === 'fenced'; } catch { /* unreadable: restart */ }
    if (newer) { this.fence(`${why}; control names a newer epoch`); return; }
    this.stop();
    this.log('token-rejected', { epoch: this.epochValue, why });
    const exit: (why: string) => void = this.o.exit ?? (() => process.exit(1));
    exit(why);
  }

  private async report(status: MachineStatus): Promise<void> {
    if (this.fencedValue) return;
    await this.o.control.report(status);
  }

  private async waitFor(done: () => boolean, ms: number): Promise<void> {
    const until = this.now() + ms;
    while (!done() && this.now() < until) await this.sleep(Math.min(200, Math.max(1, until - this.now())));
  }
}
