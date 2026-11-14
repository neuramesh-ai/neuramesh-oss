import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoxManager } from './box';
import { ALIVE_EVERY, bootEpoch, boxKeyFor, CloudRunLifecycle, controlVerdict, fallbackKeys, graceFor, keyEpoch, PARK_POLL_EVERY, RESTORE_FALLBACKS, snapshotKeysFor, type BootStart, type Control, type DrainHooks, type MachineStatus } from './lifecycle';
import type { MemorySample } from './resources';
import { EpochFencedError, MachineTokenRejected, type ListedSnapshot, type Snapshots } from './snapshot';
import type { CloudRunConfig } from '../machined-config';

function cfgAt(root: string): CloudRunConfig {
  return { root, work: 'work', workDir: join(root, 'work'), brainDir: join(root, 'work', 'brain'), secretsDir: join(root, 'secrets'), guardPct: 90, graceMs: 60_000, zstdLevel: 3 };
}

const mem = (memPct: number): MemorySample => ({ usedBytes: 0, limitBytes: 2 * 1024 ** 3, usedMiB: Math.round(20.48 * memPct), limitMiB: 2048, memPct, cgroup: 1 });
const START: BootStart = { epoch: 4, snapshot: { work: 'work-e3', box: 'box-e3' } };

interface Rig {
  lc: CloudRunLifecycle;
  root: string;
  calls: string[];
  reports: MachineStatus[];
  controls: Control[];
  box: { dead: boolean; aliveAnswer: boolean };
  memPct: { value: number };
  inFlight: { value: number };
  failSaves: { value: number };
  fenceReports: { value: boolean };
  rejectReports: { value: boolean };
  exits: string[];
  clock: { t: number };
}

interface RigOptions {
  withBox?: boolean;
  saveMs?: number;
  boxSaveMs?: number;
  writeDrainMs?: number;
  /** work keys whose restore throws (a bad archive); `missing` ones restore as absent */
  badRestores?: string[];
  missingRestores?: string[];
  /** what the snapshot list answers */
  listed?: ListedSnapshot[];
  /** box.run exit codes in order (then 0); a code != 0 is a box that would not start */
  runCodes?: number[];
  boxSaveFails?: boolean;
  /** a login vault whose calls land in `calls` (vault.ts) */
  vault?: boolean;
}

function rig(opts: RigOptions = {}): Rig {
  const root = mkdtempSync(join(tmpdir(), 'nm-cloudrun-'));
  const calls: string[] = [];
  const reports: MachineStatus[] = [];
  const controls: Control[] = [{ epoch: 4, snapshot: { work: 'work-e3', box: 'box-e3' } }];
  const boxState = { dead: false, aliveAnswer: true };
  const memPct = { value: 40 };
  const inFlight = { value: 0 };
  const failSaves = { value: 0 };
  const fenceReports = { value: false };
  const rejectReports = { value: false };
  const exits: string[] = [];
  const clock = { t: 0 };
  const runCodes = [...(opts.runCodes ?? [])];
  const deathListeners: Array<(why: string) => void> = [];
  const box = {
    get dead() { return boxState.dead; },
    onDeath: (cb: (why: string) => void) => { deathListeners.push(cb); },
    run: async (importTar: string | null) => {
      calls.push(`box.run ${importTar ? 'import' : 'fresh'}`);
      const code = runCodes.shift() ?? 0;
      return { code, stdout: '', stderr: code ? 'the box died at start' : '', ms: 1 };
    },
    alive: async () => { calls.push('box.alive'); return !boxState.dead && boxState.aliveAnswer; },
  } as unknown as BoxManager;
  const snapshots = {
    restore: async (_k: string, key: string, at: string) => {
      calls.push(`restore ${key}`);
      if (opts.badRestores?.includes(key)) {
        // a failed extraction leaves a partial tree behind: the fallback must clear it
        writeFileSync(join(at, 'work', `partial-${key}`), 'x');
        throw new Error('tar -x exited 2: tar: This does not look like a tar archive');
      }
      if (opts.missingRestores?.includes(key)) return null;
      return { rawBytes: 10240, zBytes: 1, ms: 1 };
    },
    list: async () => { calls.push('list'); return opts.listed ?? []; },
    boxFetch: async (key: string) => { calls.push(`boxFetch ${key}`); return { rawBytes: 1, zBytes: 1, ms: 1 }; },
    save: async (_k: string, key: string, _root: string, paths: string[]) => {
      calls.push(`save ${key} ${paths.join(',')}`);
      clock.t += opts.saveMs ?? 0;
      if (failSaves.value > 0) { failSaves.value -= 1; throw new Error('gcs down'); }
      return { rawBytes: 1, zBytes: 1, ms: 1 };
    },
    boxSave: async (_b: unknown, key: string) => {
      calls.push(`boxSave ${key}`);
      clock.t += opts.boxSaveMs ?? 0;
      if (opts.boxSaveFails) throw new Error('sandbox tar wrote 0 bytes');
      return { rawBytes: 1, zBytes: 1, ms: 1, sandboxTarMs: 1 };
    },
  } as unknown as Snapshots;
  const lc = new CloudRunLifecycle({
    cfg: cfgAt(root),
    control: {
      read: async () => controls[0]!,
      report: async (s) => {
        if (rejectReports.value) throw new MachineTokenRejected('401');
        if (fenceReports.value) throw new EpochFencedError('stale');
        reports.push(s);
      },
    },
    snapshots,
    box: opts.withBox === false ? null : box,
    resources: { memory: () => mem(memPct.value), cpu: () => ({ limitCores: 2, cpuPct: 10, throttleRatio: 0.1 }) },
    log: () => {},
    now: () => clock.t,
    sleep: async (ms) => { clock.t += ms; },
    exit: (why) => { exits.push(why); },
    vault: opts.vault ? {
      restore: async () => { calls.push('vault.restore'); },
      start: () => { calls.push('vault.start'); },
      stop: () => { calls.push('vault.stop'); },
      flush: async () => { calls.push('vault.flush'); },
    } : null,
  });
  const hooks: DrainHooks = {
    holdTurns: () => { calls.push('holdTurns'); },
    turnsInFlight: () => inFlight.value,
    parkTurns: async () => { calls.push('parkTurns'); inFlight.value = 0; },
    flushBrains: async () => { calls.push('flushBrains'); },
    drainWrites: async () => { calls.push('drainWrites'); clock.t += opts.writeDrainMs ?? 0; },
  };
  lc.attach(hooks);
  return { lc, root, calls, reports, controls, box: boxState, memPct, inFlight, failSaves, fenceReports, rejectReports, exits, clock };
}

test('controlVerdict: drain only for this epoch while running; a newer epoch fences; an older one is stale', () => {
  assert.equal(controlVerdict({ epoch: 4, action: 'drain' }, 4, 'running'), 'drain');
  assert.equal(controlVerdict({ epoch: 3, action: 'drain' }, 4, 'running'), 'none');
  assert.equal(controlVerdict({ epoch: 5, action: 'run' }, 4, 'running'), 'fenced');
  assert.equal(controlVerdict({ epoch: 4, action: 'drain' }, 4, 'draining'), 'none');
  assert.equal(controlVerdict({ epoch: 4 }, 4, 'running'), 'none');
  // woken after the park: only a drained instance of this epoch restarts
  assert.equal(controlVerdict({ epoch: 4, action: 'run', wake: true }, 4, 'drained'), 'restart');
  assert.equal(controlVerdict({ epoch: 4, action: 'run', wake: true }, 4, 'running'), 'none');
  assert.equal(controlVerdict({ epoch: 4, action: 'run', wake: false }, 4, 'drained'), 'none');
  assert.equal(controlVerdict({ epoch: 4, action: 'run' }, 4, 'drained'), 'none');
  assert.equal(controlVerdict({ epoch: 3, action: 'run', wake: true }, 4, 'drained'), 'none');
});

test('bootEpoch: the controller must name an epoch', () => {
  assert.equal(bootEpoch({ epoch: 7 }), 7);
  assert.throws(() => bootEpoch({} as Control), /epoch/);
  assert.throws(() => bootEpoch({ epoch: 0 }), /epoch/);
});

test('snapshotKeysFor and graceFor', () => {
  assert.deepEqual(snapshotKeysFor(4, true), { work: 'work-e4', box: 'box-e4' });
  assert.deepEqual(snapshotKeysFor(4, false), { work: 'work-e4' });
  assert.equal(graceFor('controller', 60_000), 60_000);
  assert.equal(graceFor('oom-guard', 60_000), 0);
  assert.equal(graceFor('box-crashed', 60_000), 0);
});

test('boot: adopts the epoch, restores work then the box overlay, starts the box from it', async () => {
  const r = rig();
  await r.lc.boot(START);
  assert.equal(r.lc.epoch, 4);
  assert.equal(r.lc.state, 'running');
  assert.deepEqual(r.calls, ['restore work-e3', 'boxFetch box-e3', 'box.run import']);
  assert.equal(r.reports[0]!.state, 'booting');
  assert.equal(r.reports[0]!.epoch, 4);
});

test('boot: a first boot (no snapshot) starts a fresh box', async () => {
  const r = rig();
  await r.lc.boot({ epoch: 1 });
  assert.deepEqual(r.calls, ['box.run fresh']);
});

test('boot: the grant\'s guardPct replaces the configured threshold', async () => {
  const r = rig();
  await r.lc.boot({ ...START, guardPct: 80 });
  r.memPct.value = 85;
  r.lc.guardTick();
  await r.lc.drain('oom-guard');
  assert.equal(r.reports.at(-1)!.reason, 'oom-guard');
});

// ── A bad snapshot or a box that will not start is a loss to report, never a crash loop (§14) ────

test('keyEpoch, fallbackKeys and boxKeyFor: older stored epochs newest first, never empty, never newer', () => {
  assert.equal(keyEpoch('work-e12'), 12);
  assert.equal(keyEpoch('box-e12', 'box'), 12);
  assert.equal(keyEpoch('box-e12'), null);
  assert.equal(keyEpoch('work-e'), null);
  const listed: ListedSnapshot[] = [
    { key: 'work-e1', size: 900 }, { key: 'work-e2', size: 900 }, { key: 'box-e2', size: 500 }, { key: 'work-e3', size: 9 },
    { key: 'work-e5', size: 900 }, { key: 'work-e10', size: 900 }, { key: 'work-e11', size: 900 }, { key: 'depcache-x', size: 900 },
  ];
  // e11 is the named one, e3 is an empty frame: never candidates; e10 sorts above e5 by number, not by name
  assert.deepEqual(fallbackKeys('work-e11', listed), ['work-e10', 'work-e5', 'work-e2']);
  assert.equal(fallbackKeys('work-e11', listed).length, RESTORE_FALLBACKS);
  assert.deepEqual(fallbackKeys('work-e2', listed), ['work-e1']);
  assert.deepEqual(boxKeyFor('work-e2', { work: 'work-e11', box: 'box-e11' }, listed), 'box-e2');
  assert.equal(boxKeyFor('work-e5', { work: 'work-e11' }, listed), null);
  assert.equal(boxKeyFor('work-e11', { work: 'work-e11', box: 'box-e11' }, listed), 'box-e11');
});

test('boot: a named work snapshot that will not restore falls back to the newest older epoch with its overlay, and reports the loss', async () => {
  const r = rig({ badRestores: ['work-e3'], listed: [{ key: 'work-e1', size: 900 }, { key: 'work-e2', size: 900 }, { key: 'box-e2', size: 900 }, { key: 'work-e3', size: 9 }] });
  await r.lc.boot(START);
  assert.equal(r.lc.state, 'running');
  assert.deepEqual(r.calls, ['restore work-e3', 'list', 'restore work-e2', 'boxFetch box-e2', 'box.run import']);
  assert.deepEqual(r.lc.restored, { work: 'work-e2', box: 'box-e2', failed: [{ key: 'work-e3', error: 'tar -x exited 2: tar: This does not look like a tar archive' }] });
  const loss = r.reports.find((s) => s.restoredFrom !== undefined)!;
  assert.equal(loss.state, 'booting');
  assert.equal(loss.restoredFrom, 'work-e2');
  assert.match(loss.error ?? '', /work-e3 \(tar -x exited 2/);
  assert.ok(!existsSync(join(r.root, 'work', 'partial-work-e3')), 'the failed extraction left nothing behind');
});

test('boot: when no snapshot restores, the machine starts with a fresh work dir instead of exiting', async () => {
  const r = rig({ badRestores: ['work-e3', 'work-e2'], missingRestores: ['work-e1'], listed: [{ key: 'work-e1', size: 900 }, { key: 'work-e2', size: 900 }] });
  await r.lc.boot(START);
  assert.equal(r.lc.state, 'running');
  assert.equal(r.exits.length, 0);
  assert.deepEqual(r.calls, ['restore work-e3', 'list', 'restore work-e2', 'restore work-e1', 'box.run fresh']);
  assert.equal(r.lc.restored?.work, null);
  assert.equal(r.lc.restored?.failed.length, 3);
  assert.equal(r.reports.find((s) => s.restoredFrom !== undefined)?.restoredFrom, null);
  assert.deepEqual(readdirSync(join(r.root, 'work')), [], 'an empty work dir, not a partial one');
});

test('boot: a listing that fails still ends in a fresh start, and a fence during the restore stays a fence', async () => {
  const r = rig({ badRestores: ['work-e3'] });
  (r.lc as unknown as { o: { snapshots: { list: () => Promise<never> } } }).o.snapshots.list = async () => { throw new Error('HTTP 501'); };
  await r.lc.boot(START);
  assert.equal(r.lc.state, 'running');
  assert.equal(r.lc.restored?.work, null);
  const f = rig();
  (f.lc as unknown as { o: { snapshots: { restore: () => Promise<never> } } }).o.snapshots.restore = async () => { throw new MachineTokenRejected('401'); };
  await assert.rejects(f.lc.boot(START), MachineTokenRejected);
});

test('boot: a box overlay that will not import falls back to a fresh box', async () => {
  const r = rig({ runCodes: [1] });
  await r.lc.boot(START);
  assert.deepEqual(r.calls, ['restore work-e3', 'boxFetch box-e3', 'box.run import', 'box.run fresh']);
  assert.equal(r.lc.boxDown, null);
  assert.ok(r.lc.boxManager, 'the fresh box runs the agents');
});

test('boot: a box that will not start leaves the runtimes in the supervisor; the loop never drains for it', async () => {
  const r = rig({ runCodes: [1, 1] });
  await r.lc.boot(START);
  assert.equal(r.lc.state, 'running');
  assert.equal(r.lc.boxManager, null);
  assert.match(r.lc.boxDown ?? '', /sandbox run exited 1/);
  r.calls.length = 0;
  for (let i = 0; i < ALIVE_EVERY * 2; i++) await r.lc.tick();
  assert.equal(r.lc.state, 'running', 'no box-crashed drain for a box that never started');
  assert.ok(!r.calls.includes('box.alive'));
  await r.lc.drain('controller');
  assert.deepEqual(r.reports.at(-1)!.snapshot, { work: 'work-e4' }, 'the drain saves the work dir and no overlay');
});

test('drain: a box overlay that will not save still drains with the work snapshot', async () => {
  const r = rig({ boxSaveFails: true });
  await r.lc.boot(START);
  await r.lc.drain('controller');
  assert.equal(r.lc.state, 'drained');
  assert.ok(r.calls.includes('boxSave box-e4'));
  assert.deepEqual(r.reports.at(-1)!.snapshot, { work: 'work-e4' });
});

test('controller drain: hold, wait for turns, park, flush brains, drain writes, snapshot work + box, report drained', async () => {
  const r = rig();
  await r.lc.boot(START);
  r.calls.length = 0;
  r.inFlight.value = 1;
  await r.lc.drain('controller');
  assert.deepEqual(r.calls, ['holdTurns', 'parkTurns', 'flushBrains', 'drainWrites', 'box.alive', 'save work-e4 work', 'boxSave box-e4']);
  assert.ok(r.clock.t >= 60_000, 'a controller drain waits out the grace window for running turns');
  const drained = r.reports.at(-1)!;
  assert.equal(drained.state, 'drained');
  assert.equal(drained.reason, 'controller');
  assert.equal(drained.epoch, 4);
  assert.deepEqual(drained.snapshot, { work: 'work-e4', box: 'box-e4' });
  assert.equal(r.lc.state, 'drained');
});

test('controller drain retries a measured large snapshot after grace and queued-write flush', async () => {
  // The real 8.35GB rehearsal took176.4s for one file snapshot. A failed first
  // upload must still leave time for a retry after active turns and writes stop.
  const r = rig({ saveMs: 176_381, boxSaveMs: 15_000, writeDrainMs: 15_000 });
  await r.lc.boot(START);
  r.calls.length = 0;
  r.inFlight.value = 1;
  r.failSaves.value = 1;
  await r.lc.drain('controller');
  assert.equal(r.calls.filter(call => call === 'save work-e4 work').length, 2);
  assert.equal(r.lc.state, 'drained');
  assert.deepEqual(r.reports.at(-1)!.snapshot, { work: 'work-e4', box: 'box-e4' });
  assert.equal(r.reports.at(-1)!.drainMs, 443_762);
});

test('controller drain refuses another slow retry when it would consume the remaining deadline', async () => {
  const r = rig({ saveMs: 176_381, boxSaveMs: 15_000, writeDrainMs: 15_000 });
  await r.lc.boot(START);
  r.calls.length = 0;
  r.inFlight.value = 1;
  r.failSaves.value = 2;
  await assert.rejects(r.lc.drain('controller'), /could not save/);
  assert.equal(r.calls.filter(call => call === 'save work-e4 work').length, 2);
  assert.equal(r.lc.state, 'draining');
  assert.equal(r.reports.at(-1)!.state, 'draining');
  assert.ok(!r.calls.some(call => call.startsWith('boxSave')));
  assert.equal(r.clock.t, 428_762);
});

test('OOM guard: at the threshold it drains at once, with no grace window', async () => {
  const r = rig();
  await r.lc.boot(START);
  r.calls.length = 0;
  r.inFlight.value = 1;
  r.memPct.value = 93;
  r.lc.guardTick();
  await r.lc.drain('oom-guard');
  assert.equal(r.calls[0], 'holdTurns');
  assert.equal(r.calls[1], 'parkTurns');
  assert.equal(r.clock.t < 1_000, true);
  assert.equal(r.reports.at(-1)!.reason, 'oom-guard');
  assert.equal(r.reports.at(-1)!.memPct, 93);
});

test('a dead box is not snapshotted: its overlay is gone, the work dir is the state', async () => {
  const r = rig();
  await r.lc.boot(START);
  r.calls.length = 0;
  r.box.dead = true;
  await r.lc.tick();
  assert.ok(!r.calls.some((c) => c.startsWith('boxSave')));
  assert.ok(r.calls.includes('save work-e4 work'));
  const drained = r.reports.at(-1)!;
  assert.equal(drained.reason, 'box-crashed');
  assert.deepEqual(drained.snapshot, { work: 'work-e4' });
});

test('tick: follows a drain for this epoch and ignores a stale one', async () => {
  const r = rig();
  await r.lc.boot(START);
  r.controls[0] = { epoch: 3, action: 'drain' };
  await r.lc.tick();
  assert.equal(r.lc.state, 'running');
  assert.equal(r.reports.at(-1)!.state, 'running');
  r.controls[0] = { epoch: 4, action: 'drain' };
  await r.lc.tick();
  assert.equal(r.lc.state, 'drained');
});

test('a drained instance woken before the pool scaled to 0 exits one time, so Cloud Run starts a fresh boot', async () => {
  const r = rig();
  await r.lc.boot(START);
  r.controls[0] = { epoch: 4, action: 'drain' };
  await r.lc.tick();
  assert.equal(r.lc.state, 'drained');
  // parked: desired 0, no wake. The instance waits for nm-fleet to scale the pool to 0
  r.controls[0] = { epoch: 4, action: 'run', wake: false };
  await r.lc.tick();
  assert.equal(r.exits.length, 0);
  // a message (or a prewake) sets desired 1 before nm-fleet acted: the instance leaves
  r.controls[0] = { epoch: 4, action: 'run', wake: true };
  await r.lc.tick();
  await r.lc.tick();
  assert.equal(r.exits.length, 1);
  assert.match(r.exits[0]!, /woken after its drain/);
});

test('a running instance ignores wake: it is the normal awake state', async () => {
  const r = rig();
  await r.lc.boot(START);
  r.controls[0] = { epoch: 4, action: 'run', wake: true };
  await r.lc.tick();
  assert.equal(r.lc.state, 'running');
  assert.equal(r.exits.length, 0);
});

test('epoch fencing: a newer epoch in control stops this process from acting or writing', async () => {
  const r = rig();
  await r.lc.boot(START);
  const before = r.reports.length;
  r.controls[0] = { epoch: 5, action: 'drain' };
  await r.lc.tick();
  assert.equal(r.lc.fenced, true);
  assert.ok(r.calls.includes('holdTurns'));
  const reportsAfterFence = r.reports.length;
  await r.lc.drain('controller');
  await r.lc.tick();
  assert.equal(r.reports.length, reportsAfterFence);
  assert.ok(reportsAfterFence <= before + 1);
  assert.ok(!r.calls.some((c) => c.startsWith('save')));
});

test('epoch fencing: a 409 on the drained report fences instead of claiming the drain', async () => {
  const r = rig();
  await r.lc.boot(START);
  r.fenceReports.value = true;
  await r.lc.drain('controller');
  assert.equal(r.lc.fenced, true);
  assert.notEqual(r.lc.state, 'drained');
});

test('no drained without a snapshot: three failed saves report the error and reject', async () => {
  const r = rig();
  await r.lc.boot(START);
  r.failSaves.value = 3;
  await assert.rejects(r.lc.drain('controller'), /could not save/);
  assert.equal(r.lc.state, 'draining');
  assert.equal(r.reports.at(-1)!.state, 'draining');
  assert.match(r.reports.at(-1)!.error ?? '', /gcs down/);
});

test('finalFlush (SIGTERM): flushes brains and writes, takes no snapshot', async () => {
  const r = rig();
  await r.lc.boot(START);
  r.calls.length = 0;
  await r.lc.finalFlush(1_000);
  assert.deepEqual(r.calls.sort(), ['drainWrites', 'flushBrains', 'holdTurns']);
});

test('a 401 after boot with no newer epoch exits the process, so Cloud Run restarts it into a fresh boot', async () => {
  const r = rig();
  await r.lc.boot(START);
  r.rejectReports.value = true;
  await r.lc.tick();
  assert.equal(r.exits.length, 1);
  assert.equal(r.lc.fenced, false);
});

test('a 401 while control names a newer epoch fences instead: a restart would only fence the newer boot', async () => {
  const r = rig();
  await r.lc.boot(START);
  r.rejectReports.value = true;
  r.controls[0] = { epoch: 5 };
  await r.lc.tick();
  assert.equal(r.exits.length, 0);
  assert.equal(r.lc.fenced, true);
});

test('a 401 during a drain is the same verdict, never a claimed drain', async () => {
  const r = rig();
  await r.lc.boot(START);
  r.rejectReports.value = true;
  await r.lc.drain('controller');
  assert.equal(r.exits.length, 1);
  assert.notEqual(r.lc.state, 'drained');
});

// ── Durable parks (parks.ts): the busy rule and the resume poll ride the loop ────────────────────
test('parks: the loop claims resolved parks every PARK_POLL_EVERY loops; a soon-expiring park is busy; a fence there fences', async () => {
  const r = rig();
  await r.lc.boot(START);
  assert.equal(r.lc.parksBusy, false, 'no parks attached: nothing is busy for them');
  let polls = 0;
  let busy = false;
  let fenceNext = false;
  r.lc.attachParks({
    busySoon: () => busy,
    resumeResolved: async () => { polls += 1; if (fenceNext) throw new EpochFencedError('a newer epoch claimed'); return 0; },
  });
  for (let i = 0; i < PARK_POLL_EVERY; i++) await r.lc.tick();
  assert.equal(polls, 1, 'one claim pass per 30 s, not per 2 s loop');
  assert.equal(r.lc.parksBusy, false);
  busy = true;
  assert.equal(r.lc.parksBusy, true, 'a park expiring within 5 minutes holds the machine');
  fenceNext = true;
  for (let i = 0; i < PARK_POLL_EVERY; i++) await r.lc.tick();
  assert.equal(polls, 2);
  assert.equal(r.lc.fenced, true, 'a claim refused as stale fences the process');
});

test('parks: a failed claim pass is logged and the loop carries on reporting', async () => {
  const r = rig();
  await r.lc.boot(START);
  r.lc.attachParks({ busySoon: () => false, resumeResolved: async () => { throw new Error('HTTP 503'); } });
  const before = r.reports.length;
  for (let i = 0; i < PARK_POLL_EVERY; i++) await r.lc.tick();
  assert.equal(r.lc.fenced, false);
  assert.equal(r.reports.length - before, PARK_POLL_EVERY, 'every loop still reported its status');
});

test('the login vault: restored before the box starts, polled once running, flushed after the brains and before the snapshot', async () => {
  const r = rig({ vault: true });
  await r.lc.boot(START);
  const boot = r.calls.slice();
  assert.ok(boot.indexOf('vault.restore') > boot.indexOf('restore work-e3'), 'after the work restore');
  assert.ok(boot.indexOf('vault.restore') < boot.indexOf('box.run import'), 'before the box binds the login dirs');
  assert.equal(boot.at(-1), 'vault.start');
  r.calls.length = 0;
  await r.lc.drain('controller');
  assert.ok(r.calls.indexOf('vault.flush') > r.calls.indexOf('flushBrains'));
  assert.ok(r.calls.indexOf('vault.flush') > r.calls.indexOf('parkTurns'), 'after the terminals close');
  assert.ok(r.calls.indexOf('vault.flush') < r.calls.indexOf('save work-e4 work'), 'before the snapshot');
  assert.ok(r.calls.includes('vault.stop'));
});

test('the login vault stops when the machine is fenced, and a machine without one boots as before', async () => {
  const r = rig({ vault: true });
  await r.lc.boot(START);
  r.lc.fence('control names a newer epoch');
  assert.ok(r.calls.includes('vault.stop'));
  const plain = rig();
  await plain.lc.boot(START);
  assert.ok(!plain.calls.some((c) => c.startsWith('vault.')));
});

test('restored is not interactive-ready until the authenticated relay acknowledges registration', async () => {
  const r=rig(); await r.lc.boot(START);
  assert.equal(r.lc.status().interactiveReady,false);
  await r.lc.setInteractiveReady(true);
  assert.equal(r.reports.at(-1)?.interactiveReady,true);
  await r.lc.setInteractiveReady(false);
  assert.equal(r.reports.at(-1)?.interactiveReady,false);
  r.lc.stop();
});
