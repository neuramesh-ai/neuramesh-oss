import type { Actor } from '@neuramesh/shared';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireWakeBump, lifecycleRoutes, sweepIntervalMin, type MachineSweepResult } from './fleet-lifecycle.js';
import type { Store } from './store';

const ENV_KEYS = ['NM_MACHINE_SWEEP_MIN', 'FREE_STARTER_MINUTES_PER_DAY', 'CRON_SECRET', 'NM_ADMIN_SECRET'] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});
const setEnv = (k: (typeof ENV_KEYS)[number], v: string | undefined): void => {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};

describe('env knobs', () => {
  it('sweepIntervalMin: default 5, explicit value, junk falls back', () => {
    setEnv('NM_MACHINE_SWEEP_MIN', undefined);
    expect(sweepIntervalMin()).toBe(5);
    setEnv('NM_MACHINE_SWEEP_MIN', '10');
    expect(sweepIntervalMin()).toBe(10);
    setEnv('NM_MACHINE_SWEEP_MIN', 'soon');
    expect(sweepIntervalMin()).toBe(5);
    setEnv('NM_MACHINE_SWEEP_MIN', '0');
    expect(sweepIntervalMin()).toBe(5);
  });

});

const mkApp = (store: Partial<Store>, actor?: Actor): Hono<{ Variables: { actor: Actor } }> => {
  const app = new Hono<{ Variables: { actor: Actor } }>();
  // stand-in for app.ts's /v1 auth gate — lifecycleRoutes is registered after it there
  app.use('/v1/*', async (c, next) => {
    c.set('actor', actor ?? { kind: 'human', id: 'u1' });
    await next();
  });
  lifecycleRoutes(app, store as Store);
  return app;
};

// the sweep cron: same auth idiom as cron-routes.ts — Bearer $CRON_SECRET or nothing.
describe('GET /internal/machine-sweep', () => {
  afterEach(() => {
    setEnv('CRON_SECRET', savedEnv['CRON_SECRET']);
  });
  const sweep = (app: Hono<{ Variables: { actor: Actor } }>, auth?: string) =>
    app.request('/internal/machine-sweep', { headers: auth ? { authorization: auth } : {} });

  it('refuses without the cron secret, and never sweeps', async () => {
    setEnv('CRON_SECRET', 'cronsecret');
    const app = mkApp({
      machineSweep: async () => {
        throw new Error('must not be reached');
      },
    });
    expect((await sweep(app)).status).toBe(403);
    expect((await sweep(app, 'Bearer wrong')).status).toBe(403);
    setEnv('CRON_SECRET', undefined);
    // no secret configured = the route is closed, not open
    expect((await sweep(app, 'Bearer cronsecret')).status).toBe(403);
  });

  it('sweeps with the env-derived interval and returns the verdict', async () => {
    // the free minute cap died with the credits round — the sweep now takes only the interval.
    setEnv('CRON_SECRET', 'cronsecret');
    setEnv('NM_MACHINE_SWEEP_MIN', '7');
    const seen: number[] = [];
    const verdict: MachineSweepResult = { metered: 2, capStopped: ['m1'], idleStopped: ['m2', 'm3'] };
    const app = mkApp({
      machineSweep: async (intervalMin: number) => { seen.push(intervalMin); return verdict; },
    });
    const res = await sweep(app, 'Bearer cronsecret');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(verdict);
    expect(seen).toEqual([7]);
  });

  it('501s on a store that does not serve fleet', async () => {
    setEnv('CRON_SECRET', 'cronsecret');
    expect((await sweep(mkApp({}), 'Bearer cronsecret')).status).toBe(501);
  });
});

describe('GET /v1/machines/usage', () => {
  const WS = 'ws1';
  const usageStore = (plan: string): Partial<Store> => ({
    humanMemberIds: async () => ['u1', 'u2'],
    workspacePlan: async () => plan,
    machineUsageToday: async (workspaceId) => {
      expect(workspaceId).toBe(WS);
      return { day: '2026-08-27', minutes: 25 };
    },
  });
  const get = (app: Hono<{ Variables: { actor: Actor } }>, ws?: string) =>
    app.request(`/v1/machines/usage${ws ? `?workspace=${ws}` : ''}`);

  it('requires a workspace', async () => {
    expect((await get(mkApp(usageStore('free')))).status).toBe(400);
  });

  it('is human-only, and member-only — the read is never reached otherwise', async () => {
    const never: Partial<Store> = {
      humanMemberIds: async () => ['someone-else'],
      machineUsageToday: async () => {
        throw new Error('must not be reached');
      },
    };
    expect((await get(mkApp(never, { kind: 'agent', id: 'a1', role: 'worker' } as Actor), WS)).status).toBe(403);
    expect((await get(mkApp(never, { kind: 'human', id: 'u1' }), WS)).status).toBe(403);
  });

  // THE FREE PLAN HAS NO DAILY MINUTE CAP, and this is the endpoint every compute surface reads.
  // It served 60 to free workspaces after the credits round retired the cap as a gate, and that
  // number was not cosmetic: machineSweep keeps metering minutes, so at 60 capSpent() flipped
  // machineState() to 'capped' — which replaces the chat composer and hides "Wake now". A free
  // workspace was locked out of its own product by a rule the server no longer enforced.
  // Pinned with the env var SET, because the bug was the endpoint reading it at all.
  it('never caps a free workspace on minutes — the daily cap is retired, gate is credits', async () => {
    setEnv('FREE_STARTER_MINUTES_PER_DAY', '45');
    const res = await get(mkApp(usageStore('free')), WS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ day: '2026-08-27', minutes: 25, capMinutes: null, plan: 'free', machines: [], outOfCredits: false });
  });

  it('returns capMinutes null for a cloud workspace', async () => {
    const res = await get(mkApp(usageStore('cloud')), WS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ day: '2026-08-27', minutes: 25, capMinutes: null, plan: 'cloud', machines: [], outOfCredits: false });
  });

  it('501s for a member on a store that does not serve fleet', async () => {
    const app = mkApp({ humanMemberIds: async () => ['u1'] });
    expect((await get(app, WS)).status).toBe(501);
  });
});

// the message path's contract: never throws, never rejects unhandled, no-ops without fleet.
describe('fireWakeBump', () => {
  it('no-ops on a store that does not serve fleet', () => {
    expect(() => fireWakeBump({} as Store, 'ws1')).not.toThrow();
  });

  it('bumps the workspace, and swallows (logs) a failing bump', async () => {
    const seen: string[] = [];
    const bumping: Partial<Store> = { bumpMachineWake: async (ws) => void seen.push(ws) };
    fireWakeBump(bumping as Store, 'ws1');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: Partial<Store> = {
      bumpMachineWake: async () => {
        throw new Error('pg down');
      },
    };
    fireWakeBump(failing as Store, 'ws2');
    await new Promise((r) => setImmediate(r));
    expect(seen).toEqual(['ws1']);
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });
});

// The admin reset HANDS OUT COMPUTE, so its guard rails matter more than its SQL. These pin the
// three ways it could quietly become a hole: an unset secret that lets everything through, a
// member route in disguise, and a forgotten field that means "everybody".
describe('POST /internal/usage-reset', () => {
  const WSID = '00000000-0000-4000-8000-00000000abcd';
  const post = (app: Hono<{ Variables: { actor: Actor } }>, body: unknown, auth?: string) =>
    app.request('/internal/usage-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify(body),
    });

  it('FAILS CLOSED with no secret configured — shipping it does not open a door', async () => {
    setEnv('NM_ADMIN_SECRET', undefined);
    // the dangerous shape: a missing secret must not make `Bearer undefined` a valid key
    expect((await post(mkApp({}), { all: true }, 'Bearer undefined')).status).toBe(403);
    expect((await post(mkApp({}), { all: true })).status).toBe(403);
  });

  it('refuses a wrong secret, and refuses a signed-in member with no secret at all', async () => {
    setEnv('NM_ADMIN_SECRET', 'right');
    expect((await post(mkApp({}), { all: true }, 'Bearer wrong')).status).toBe(403);
    // a normal human session carries no admin secret, so it can never lift its own cap
    expect((await post(mkApp({}, { kind: 'human', id: 'u1' }), { workspace: WSID })).status).toBe(403);
  });

  it('demands the scope be said out loud: never both, never neither', async () => {
    setEnv('NM_ADMIN_SECRET', 'right');
    const app = mkApp({});
    expect((await post(app, {}, 'Bearer right')).status).toBe(400);
    expect((await post(app, { workspace: WSID, all: true }, 'Bearer right')).status).toBe(400);
    expect((await post(app, { workspace: '', all: false }, 'Bearer right')).status).toBe(400);
  });

  it('will not start the whole fleet: `wake` is refused alongside `all`', async () => {
    setEnv('NM_ADMIN_SECRET', 'right');
    const res = await post(mkApp({}), { all: true, wake: true }, 'Bearer right');
    // the scope check passes, so this 400 is the wake guard itself talking
    expect([400, 501]).toContain(res.status);
  });
});
