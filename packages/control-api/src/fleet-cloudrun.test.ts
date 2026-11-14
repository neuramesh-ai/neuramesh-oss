// The Cloud Run machine lane's rules, pure (fleet-cloudrun.ts): the epoch fence, the drain walk,
// the control a machine reads, the status body machined sends, and the bearer gates on the lane's
// routes. The postgres half lives in test/cloudrun-machines.pg.test.ts.
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { rowsToDesired, type CloudMachineRow } from './fleet';
import { controlFor, drainMove, epochVerdict, nextSize, planMaxSize, StatusSchema, type DrainRow, type StatusReport } from './fleet-cloudrun';
import { cloudRunRoutes } from './fleet-cloudrun-routes';
import { hashMachineToken } from './machine-auth';
import type { Store } from './store';

const on = { on: true, thresholdPct: 75 };
const row = (over: Partial<DrainRow> = {}): DrainRow => ({ substrate: 'cloudrun', epoch: 3, desiredReplicas: 1, drainState: null, drainReason: null, sizeClass: 'S', plan: 'cloud', ...over });
const report = (over: Partial<StatusReport> = {}): StatusReport => ({ epoch: 3, state: 'running', memPct: 10, ...over });
const snapshot = { work: 'work-e3', box: 'box-e3' };

describe('the epoch fence', () => {
  it('only the row\'s own epoch may write', () => {
    expect(epochVerdict(3, 3)).toBe('ok');
    expect(epochVerdict(3, 2)).toBe('stale');
    expect(epochVerdict(3, 4)).toBe('ahead');
  });
});

describe('size ceilings', () => {
  it('a plan grows to its ceiling and no further; an unknown plan takes the free one', () => {
    expect(planMaxSize('cloud')).toBe('XL');
    expect(planMaxSize('free')).toBe('M');
    expect(planMaxSize('mystery')).toBe('M');
    expect(nextSize('S', 'XL')).toBe('M');
    expect(nextSize('M', 'M')).toBeNull();
    expect(nextSize('XL', 'XL')).toBeNull();
  });
});

describe('the drain walk', () => {
  it('asks a running machine to drain at the threshold, only when a bigger class is allowed', () => {
    expect(drainMove(row(), report({ memPct: 74.9 }), on)).toEqual({ kind: 'none' });
    expect(drainMove(row(), report({ memPct: 75 }), on)).toEqual({ kind: 'request' });
    expect(drainMove(row({ sizeClass: 'M', plan: 'free' }), report({ memPct: 90 }), on)).toEqual({ kind: 'none' });
    expect(drainMove(row({ drainState: 'requested', drainReason: 'grow' }), report({ memPct: 90 }), on)).toEqual({ kind: 'none' });
  });

  it('a machine that says it drains on its own is recorded with its reason', () => {
    expect(drainMove(row(), report({ state: 'draining', reason: 'oom-guard' }), on)).toEqual({ kind: 'self-drain', reason: 'oom' });
    expect(drainMove(row(), report({ state: 'draining', reason: 'box-crashed' }), on)).toEqual({ kind: 'self-drain', reason: 'crash' });
  });

  it('drained to grow: the next class; at the ceiling or after a crash: the same class, a restart all the same', () => {
    expect(drainMove(row({ drainState: 'requested', drainReason: 'grow' }), report({ state: 'drained', reason: 'controller', snapshot }), on))
      .toEqual({ kind: 'resize', next: 'M', reason: 'grow', work: 'work-e3', box: 'box-e3' });
    expect(drainMove(row({ sizeClass: 'XL' }), report({ state: 'drained', reason: 'oom-guard', snapshot }), on))
      .toEqual({ kind: 'resize', next: 'XL', reason: 'oom', work: 'work-e3', box: 'box-e3' });
    // the box died: its overlay is gone, so no box key, and memory is not the reason to grow
    expect(drainMove(row(), report({ state: 'drained', reason: 'box-crashed', snapshot: { work: 'work-e3' } }), on))
      .toEqual({ kind: 'resize', next: 'S', reason: 'crash', work: 'work-e3', box: null });
  });

  it('drained for a stop parks the machine; drained for a roll restarts it at its class', () => {
    expect(drainMove(row({ drainState: 'draining', drainReason: 'idle' }), report({ state: 'drained', reason: 'controller', snapshot }), on))
      .toEqual({ kind: 'park', work: 'work-e3', box: 'box-e3' });
    expect(drainMove(row({ drainState: 'draining', drainReason: 'cap' }), report({ state: 'drained', snapshot }), on).kind).toBe('park');
    expect(drainMove(row({ drainState: 'draining', drainReason: 'roll' }), report({ state: 'drained', snapshot }), on))
      .toEqual({ kind: 'resize', next: 'S', reason: 'roll', work: 'work-e3', box: 'box-e3' });
  });

  it('drained without keys, or late after a park, moves nothing', () => {
    expect(drainMove(row({ drainState: 'requested', drainReason: 'grow' }), report({ state: 'drained' }), on)).toEqual({ kind: 'none' });
    expect(drainMove(row({ desiredReplicas: 0 }), report({ state: 'drained', snapshot }), on)).toEqual({ kind: 'none' });
  });

  it('the new incarnation reporting running settles the walk', () => {
    expect(drainMove(row({ drainState: 'resizing', drainReason: 'grow' }), report(), on)).toEqual({ kind: 'settled' });
  });

  it('does nothing behind the flag, for another substrate, or for a report from another epoch', () => {
    expect(drainMove(row(), report({ memPct: 99 }), { on: false, thresholdPct: 75 })).toEqual({ kind: 'none' });
    expect(drainMove(row({ substrate: 'volume' }), report({ memPct: 99 }), on)).toEqual({ kind: 'none' });
    expect(drainMove(row(), report({ epoch: 2, memPct: 99 }), on)).toEqual({ kind: 'none' });
  });
});

describe('the control a machine reads (flat, as machined parses it)', () => {
  it('drain while a drain is asked or under way, else run, with the keys to restore', () => {
    expect(controlFor({ epoch: 3, drainState: 'requested', work: null, box: null })).toEqual({ epoch: 3, action: 'drain', snapshot: null });
    expect(controlFor({ epoch: 3, drainState: 'draining', work: null, box: null }).action).toBe('drain');
    expect(controlFor({ epoch: 4, drainState: 'resizing', work: 'w', box: 'b' })).toEqual({ epoch: 4, action: 'run', snapshot: { work: 'w', box: 'b' } });
    expect(controlFor({ epoch: 4, drainState: null, work: 'w', box: null })).toEqual({ epoch: 4, action: 'run', snapshot: { work: 'w' } });
    // wake: desired 1 with no drain or resize. A drained instance that reads it restarts (machined)
    expect(controlFor({ epoch: 4, drainState: null, work: 'w', box: null, desired: 1 }).wake).toBe(true);
    expect(controlFor({ epoch: 4, drainState: null, work: 'w', box: null, desired: 0 }).wake).toBe(false);
    expect(controlFor({ epoch: 4, drainState: 'resizing', work: 'w', box: null, desired: 1 }).wake).toBe(false);
    expect(controlFor({ epoch: 4, drainState: 'draining', work: 'w', box: null, desired: 1 }).wake).toBe(false);
  });
});

describe('the status body machined sends', () => {
  it('takes every field of MachineStatus, nulls included', () => {
    const full = { state: 'running', epoch: 4, memPct: 61.2, usedMiB: 1253, limitMiB: 2048, cpuPct: null, throttleRatio: null, step: 12, restoreMs: 5600, bootToReadyMs: 21000 };
    expect(StatusSchema.safeParse(full).success).toBe(true);
    expect(StatusSchema.safeParse({ state: 'drained', epoch: 4, memPct: 93, usedMiB: 1900, limitMiB: 2048, cpuPct: 80, throttleRatio: 0.5, reason: 'oom-guard', snapshot: { work: 'work-e4' }, drainMs: 1200 }).success).toBe(true);
    expect(StatusSchema.safeParse({ state: 'draining', epoch: 4, memPct: 50, usedMiB: 1, limitMiB: 2, cpuPct: null, throttleRatio: null, reason: 'controller', error: 'gcs down' }).success).toBe(true);
  });

  it('takes a boot\'s restore fallback: the older key it restored, or null for a fresh work dir', () => {
    const fell = StatusSchema.safeParse({ state: 'booting', epoch: 5, restoredFrom: 'work-e2', restoreMs: 900, error: 'restore fell back to work-e2: work-e3 (tar -x exited 2)' });
    expect(fell.success && fell.data.restoredFrom).toBe('work-e2');
    const fresh = StatusSchema.safeParse({ state: 'booting', epoch: 5, restoredFrom: null });
    expect(fresh.success && fresh.data.restoredFrom).toBeNull();
    expect(StatusSchema.safeParse({ state: 'booting', epoch: 5, restoredFrom: '../w' }).success).toBe(false);
  });

  it('refuses a key that is not one safe segment, an unknown state, and a negative epoch', () => {
    expect(StatusSchema.safeParse({ epoch: 1, state: 'drained', snapshot: { work: '../w' } }).success).toBe(false);
    expect(StatusSchema.safeParse({ epoch: 1, state: 'sleeping' }).success).toBe(false);
    expect(StatusSchema.safeParse({ epoch: -1, state: 'running' }).success).toBe(false);
  });
});

describe('the desired feed', () => {
  const base: CloudMachineRow = { id: 'x', workspace_id: 'ws1', workspace_plan: 'cloud', kind: 'member', owner_user_id: 'u1', desired_replicas: 1, lifecycle: 'running', resources: {} };
  const out = (rows: Partial<CloudMachineRow>[]) => Object.fromEntries(rowsToDesired(rows.map((r, i) => ({ ...base, owner_user_id: `u${i}`, ...r }))).workspaces.flatMap((w) => w.machines).map((m) => [m.id, m]));

  it('a cloudrun row carries its class (NULL reads as S), its restart count and whether a drain finished', () => {
    const by = out([
      { id: 'c1', substrate: 'cloudrun', size_class: 'L', restarts: '7', drain_state: 'resizing' },
      { id: 'c2', substrate: 'cloudrun', size_class: null, restarts: 0 },
      { id: 'v1', substrate: 'volume', size_class: 'L', restarts: '3' },
    ]);
    expect(by['c1']).toMatchObject({ substrate: 'cloudrun', sizeClass: 'L', restartGen: 7, templateReady: true, replicas: 1 });
    expect(by['c2']).toMatchObject({ substrate: 'cloudrun', sizeClass: 'S', restartGen: 0, templateReady: false });
    expect(by['v1']).not.toHaveProperty('sizeClass');
    expect(by['v1']).not.toHaveProperty('restartGen');
  });

  it('a stop whose drain missed its deadline reads as replicas 0 at once; one still in time stays up (M12)', () => {
    const by = out([
      { id: 'late', substrate: 'cloudrun', drain_state: 'draining', drain_reason: 'idle', drain_expired: true },
      { id: 'early', substrate: 'cloudrun', drain_state: 'draining', drain_reason: 'cap', drain_expired: false },
      { id: 'roll', substrate: 'cloudrun', drain_state: 'draining', drain_reason: 'roll', drain_expired: true },
    ]);
    expect(by['late']!.replicas).toBe(0);
    expect(by['early']!.replicas).toBe(1);
    expect(by['roll']!.replicas).toBe(1);
  });
});

describe('the lane\'s routes', () => {
  const TOKEN = `nmm_${'ef'.repeat(24)}`;
  const store = {
    machineByTokenHash: async (h: string) => (h === hashMachineToken(TOKEN) ? { id: 'm1', workspace_id: 'ws1', owner_user_id: 'u1', kind: 'member', owner_clerk_id: null } : null),
  } as unknown as Store;
  const app = new Hono();
  cloudRunRoutes(app, store);
  const post = (path: string, auth: string | null, body: unknown = { epoch: 1, state: 'running' }) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });

  it('status, control and token renewal refuse a person and an unknown token before anything else', async () => {
    expect((await post('/v1/machines/status', null)).status).toBe(403);
    expect((await post('/v1/machines/status', 'Bearer clerk.jwt.here')).status).toBe(403);
    expect((await post('/v1/machines/status', `Bearer nmm_${'00'.repeat(24)}`)).status).toBe(401);
    expect((await app.request('/v1/machines/control')).status).toBe(403);
    expect((await post('/v1/machines/token', null, { epoch: 1 })).status).toBe(403);
    // a real machine on a store without postgres: refused out loud, never half-done
    expect((await post('/v1/machines/status', `Bearer ${TOKEN}`)).status).toBe(501);
    expect((await post('/v1/machines/status', `Bearer ${TOKEN}`, { epoch: 1, state: 'sleeping' })).status).toBe(400);
    expect((await post('/v1/machines/token', `Bearer ${TOKEN}`, {})).status).toBe(400);
  });

  it('the boot takes the boot credential as its bearer, and a missing or malformed one is 401 (machined stops)', async () => {
    expect((await post('/v1/machines/boot', null, {})).status).toBe(401);
    expect((await post('/v1/machines/boot', 'Bearer nmb_short', {})).status).toBe(401);
    expect((await post('/v1/machines/boot', `Bearer ${TOKEN}`, {})).status).toBe(401);
  });

  it('the operator\'s routes need the fleet secret', async () => {
    process.env['FLEET_SECRET'] = 'fs';
    expect((await post('/internal/machines/1a1a1a1a-0000-4000-8000-000000000001/boot-credential', null, {})).status).toBe(403);
    expect((await post('/internal/machines/1a1a1a1a-0000-4000-8000-000000000001/roll', 'Bearer wrong', {})).status).toBe(403);
    expect((await post('/internal/machines/not-a-uuid/roll', 'Bearer fs', {})).status).toBe(501);
    delete process.env['FLEET_SECRET'];
  });
});
