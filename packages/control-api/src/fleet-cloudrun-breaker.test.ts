// The boot guards' rules, pure (fleet-cloudrun-breaker.ts, fleet-cloudrun-retention.ts): when a boot is
// a new incarnation, a ghost (PARKED) or one too many (BOOT_LOOP); what the person reads; which
// snapshots a machine no longer needs. The postgres half lives in test/boot-breaker.pg.test.ts.
import { isSessionRunNotice } from '@neuramesh/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { bootLoopMax, bootLoopNotice, bootLoopWindowMin, bootVerdict, type BreakerRow } from './fleet-cloudrun-breaker';
import { DEPCACHE_GLOB, depcacheConfig, depcachePass, retentionConfig, staleDepcache, supersededKeys } from './fleet-cloudrun-retention';
import type { ListOptions, SnapshotStorage } from './gcs-sign';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const cfg = { max: 8, windowMin: 30 };
const row = (over: Partial<BreakerRow> = {}): BreakerRow => ({ desiredReplicas: 1, bootLoopAt: null, streak: 0, streakSince: null, ...over });
const ago = (min: number) => new Date(NOW - min * 60_000);

describe('the boot verdict', () => {
  it('a first boot, or one after the window, starts a streak of 1', () => {
    expect(bootVerdict(row(), NOW, cfg)).toEqual({ kind: 'boot', streak: 1, fresh: true });
    expect(bootVerdict(row({ streak: 7, streakSince: ago(31) }), NOW, cfg)).toEqual({ kind: 'boot', streak: 1, fresh: true });
  });

  it('boots inside the window count up to the limit; the next one trips the breaker', () => {
    expect(bootVerdict(row({ streak: 1, streakSince: ago(1) }), NOW, cfg)).toEqual({ kind: 'boot', streak: 2, fresh: false });
    expect(bootVerdict(row({ streak: 7, streakSince: ago(29) }), NOW, cfg)).toEqual({ kind: 'boot', streak: 8, fresh: false });
    expect(bootVerdict(row({ streak: 8, streakSince: ago(29) }), NOW, cfg)).toEqual({ kind: 'loop', trip: true });
  });

  it('an open breaker refuses without tripping again, even on a machine that a wake set to 1', () => {
    expect(bootVerdict(row({ bootLoopAt: ago(5), desiredReplicas: 0 }), NOW, cfg)).toEqual({ kind: 'loop', trip: false });
    expect(bootVerdict(row({ bootLoopAt: ago(5), desiredReplicas: 1 }), NOW, cfg)).toEqual({ kind: 'loop', trip: false });
  });

  it('a ghost: a parked machine is refused, and the refusal counts nothing', () => {
    expect(bootVerdict(row({ desiredReplicas: 0 }), NOW, cfg)).toEqual({ kind: 'parked' });
    expect(bootVerdict(row({ desiredReplicas: 0, streak: 8, streakSince: ago(1) }), NOW, cfg)).toEqual({ kind: 'parked' });
  });

  it('a person\'s wake steps the streak back by one: exactly one more boot passes', () => {
    // clearBreakerOnHumanWake: streak 8 → 7, the window restarts now
    expect(bootVerdict(row({ streak: 7, streakSince: ago(0) }), NOW, cfg)).toEqual({ kind: 'boot', streak: 8, fresh: false });
    expect(bootVerdict(row({ streak: 8, streakSince: ago(0) }), NOW, cfg)).toEqual({ kind: 'loop', trip: true });
  });
});

describe('the knobs', () => {
  const saved = { max: process.env['NM_BOOT_LOOP_MAX'], win: process.env['NM_BOOT_LOOP_WINDOW_MIN'] };
  afterEach(() => {
    if (saved.max === undefined) delete process.env['NM_BOOT_LOOP_MAX']; else process.env['NM_BOOT_LOOP_MAX'] = saved.max;
    if (saved.win === undefined) delete process.env['NM_BOOT_LOOP_WINDOW_MIN']; else process.env['NM_BOOT_LOOP_WINDOW_MIN'] = saved.win;
  });

  it('default to 8 boots in 30 minutes, and a bad value reads as the default', () => {
    delete process.env['NM_BOOT_LOOP_MAX']; delete process.env['NM_BOOT_LOOP_WINDOW_MIN'];
    expect([bootLoopMax(), bootLoopWindowMin()]).toEqual([8, 30]);
    process.env['NM_BOOT_LOOP_MAX'] = '0'; process.env['NM_BOOT_LOOP_WINDOW_MIN'] = 'soon';
    expect([bootLoopMax(), bootLoopWindowMin()]).toEqual([8, 30]);
    process.env['NM_BOOT_LOOP_MAX'] = '3'; process.env['NM_BOOT_LOOP_WINDOW_MIN'] = '10';
    expect([bootLoopMax(), bootLoopWindowMin()]).toEqual([3, 10]);
  });

  it('retention defaults: keep 3, 20 machines and 200 deletes a pass, spare an hour of fresh writes', () => {
    expect(retentionConfig()).toEqual({ keep: 3, machines: 20, maxDeletes: 200, minAgeMs: 3_600_000, budgetMs: 20_000 });
  });
});

describe('the notice', () => {
  it('reads as a compute notice on every client, and says what to do, in plain sentences', () => {
    const body = bootLoopNotice(8);
    expect(isSessionRunNotice(body)).toBe(true);
    expect(body).toMatch(/^I can't reply now\./);
    expect(body).toContain('8 times');
    expect(body).toContain('Send your message again');
    expect(body).not.toMatch(/[;\u2014]/);
  });
});

describe('superseded snapshots', () => {
  const k = (keys: string[], updatedMs: number | null = NOW - 3 * 3600_000) => keys.map((key) => ({ key, updatedMs }));
  const keep = { keep: 3, minAgeMs: 3600_000 };

  it('retains original full archives and immutable chunks once a manifest is authoritative', () => {
    const listed=k(['work-e1','work-e2','work-e3','work-e4','work-e5','box-e1','manifest-e6','core-e6','chunk-a']);
    expect(supersededKeys(listed,{work:'manifest-e6',box:null},keep,NOW)).toEqual([]);
  });

  it('keeps the newest 3 epochs of work and of box, each on its own', () => {
    const listed = k(['work-e1', 'work-e2', 'work-e3', 'work-e4', 'box-e1', 'box-e4', 'box-e9', 'box-e10']);
    expect(supersededKeys(listed, { work: 'work-e4', box: 'box-e4' }, keep, NOW).sort()).toEqual(['box-e1', 'work-e1']);
  });

  it('keeps the pointed-to key however old it is, and numbers sort as numbers', () => {
    const listed = k(['work-e2', 'work-e9', 'work-e10', 'work-e11', 'work-e12']);
    expect(supersededKeys(listed, { work: 'work-e2', box: null }, keep, NOW)).toEqual(['work-e9']);
  });

  it('spares a fresh write, a key of unknown age, and a key that is not ours', () => {
    const listed = [...k(['work-e1', 'work-e2', 'work-e3', 'work-e4', 'work-e5']), { key: 'work-e0', updatedMs: NOW - 60_000 }, { key: 'work-e00x', updatedMs: null }, { key: 'replica', updatedMs: 0 }, { key: 'work-e6', updatedMs: null }];
    expect(supersededKeys(listed, { work: 'work-e6', box: null }, keep, NOW).sort()).toEqual(['work-e1', 'work-e2', 'work-e3']);
  });

  it('a machine with 3 or fewer epochs loses nothing', () => {
    expect(supersededKeys(k(['work-e1', 'work-e2', 'box-e2']), { work: 'work-e2', box: 'box-e2' }, keep, NOW)).toEqual([]);
  });
});

describe('the depcache pass', () => {
  const DAY = 86_400_000;
  const obj = (ws: string, key: string) => `v1/workspaces/${ws}/depcache/${key}.tar.zst`;
  /** a fake bucket with GCS's list semantics: prefix, matchGlob (`*` stops at `/`), startOffset (inclusive), name order */
  function bucket(objects: Record<string, { updated: number; customTime?: number }>) {
    const removed: string[] = [];
    const esc = (part: string): string => part.replace(/[.+?^$()|[\]\\{}]/g, (c) => `\\${c}`);
    const glob = (g: string): RegExp => new RegExp('^' + g.split('*').map(esc).join('[^/]*') + '$');
    const storage: SnapshotStorage = {
      bucket: 'b', signer: { email: async () => 'x@y', signBlob: async () => Buffer.alloc(1) }, stat: async () => null,
      list: async (prefix: string, max: number, opts: ListOptions = {}) => Object.keys(objects).sort()
        .filter((n) => n.startsWith(prefix) && (!opts.matchGlob || glob(opts.matchGlob).test(n)) && (!opts.startOffset || n >= opts.startOffset))
        .slice(0, max)
        .map((name) => ({ name, size: 1, updated: new Date(objects[name]!.updated).toISOString(), ...(objects[name]!.customTime ? { customTime: new Date(objects[name]!.customTime!).toISOString() } : {}) })),
      remove: async (name: string) => { removed.push(name); return delete objects[name]; },
    };
    return { storage, removed, objects };
  }

  it('an object idle past the limit goes; a recent upload or a recent use keeps it; age unknown keeps it', () => {
    const listed = [
      { name: 'old', updatedMs: NOW - 40 * DAY, usedMs: null },
      { name: 'used', updatedMs: NOW - 90 * DAY, usedMs: NOW - 2 * DAY },
      { name: 'fresh', updatedMs: NOW - 5 * DAY, usedMs: null },
      { name: 'unknown', updatedMs: null, usedMs: null },
    ];
    expect(staleDepcache(listed, 30 * DAY, NOW)).toEqual(['old']);
  });

  it('defaults: 30 idle days, 1000 listed and 200 deleted a pass', () => {
    expect(depcacheConfig()).toMatchObject({ idleMs: 30 * DAY, listMax: 1000, maxDeletes: 200 });
  });

  it('lists only depcache objects, deletes the idle ones, and leaves snapshots alone', async () => {
    const b = bucket({
      [obj('w1', 'pnpm-a')]: { updated: NOW - 40 * DAY },
      [obj('w1', 'pnpm-b')]: { updated: NOW - 40 * DAY, customTime: NOW - DAY },
      [obj('w2', 'npm-c')]: { updated: NOW - 3 * DAY },
      ['v1/workspaces/w1/machines/m1/snapshots/work-e1.tar.zst']: { updated: NOW - 400 * DAY },
    });
    const out = await depcachePass(b.storage, { idleMs: 30 * DAY, listMax: 1000, maxDeletes: 200, budgetMs: 20_000 }, () => NOW, { next: '' });
    expect(out).toMatchObject({ listed: 3, deleted: 1, truncated: false, wrapped: true });
    expect(b.removed).toEqual([obj('w1', 'pnpm-a')]);
    expect(DEPCACHE_GLOB).toBe('v1/workspaces/*/depcache/*.tar.zst');
  });

  it('bounded: a pass lists at most listMax and deletes at most maxDeletes, and the next resumes where it stopped', async () => {
    const objects: Record<string, { updated: number }> = {};
    for (let i = 0; i < 10; i++) objects[obj(`w${i}`, 'k')] = { updated: NOW - 60 * DAY };
    const b = bucket(objects);
    const cursor = { next: '' };
    const cfg = { idleMs: 30 * DAY, listMax: 4, maxDeletes: 3, budgetMs: 20_000 };
    const first = await depcachePass(b.storage, cfg, () => NOW, cursor);
    expect(first).toMatchObject({ listed: 4, deleted: 3, truncated: true });
    expect(cursor.next).toBe(obj('w3', 'k'));
    for (let i = 0; i < 4; i++) await depcachePass(b.storage, cfg, () => NOW, cursor);
    expect(Object.keys(b.objects)).toEqual([]);
    expect(cursor.next).toBe('');
  });

  it('off with NM_DEPCACHE_GC_LIST_MAX=0, and without a storage that can delete', async () => {
    const b = bucket({ [obj('w1', 'x')]: { updated: 0 } });
    expect(await depcachePass(b.storage, { idleMs: DAY, listMax: 0, maxDeletes: 1, budgetMs: 1000 }, () => NOW, { next: '' })).toBeNull();
    expect(await depcachePass({ ...b.storage, remove: undefined }, { idleMs: DAY, listMax: 10, maxDeletes: 1, budgetMs: 1000 }, () => NOW, { next: '' })).toBeNull();
    expect(b.removed).toEqual([]);
  });
});
