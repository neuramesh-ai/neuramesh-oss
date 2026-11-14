// The park and fact routes' pure rules and refusals (machine-parks.ts, machine-facts.ts). The SQL itself
// runs against the real schema in test/machine-parks-facts.pg.test.ts.
import type { Actor } from '@neuramesh/shared';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { hashMachineToken } from './machine-auth';
import { machineFactRoutes } from './machine-facts';
import { machineParkRoutes, parkHumanRoutes } from './machine-park-routes';
import { approvedOf, CreateParkSchema, parkTtlMs, PARK_TTL_MAX_MS, PARK_TTL_MIN_MS, timeoutResolution } from './machine-parks';
import type { Store } from './store';

const TOKEN = `nmm_${'cd'.repeat(24)}`;
// a store without postgres: the routes must refuse out loud, never pretend
const store = {
  machineByTokenHash: async (hash: string) => (hash === hashMachineToken(TOKEN) ? { id: 'm1', workspace_id: 'w1', owner_user_id: 'u1', kind: 'member', owner_clerk_id: null } : null),
  humanMemberIds: async () => ['u1'],
} as unknown as Store;

function mkApp() {
  const app = new Hono<{ Variables: { actor: Actor } }>();
  machineFactRoutes(app, store);
  machineParkRoutes(app, store);
  app.use('/v1/*', async (c, next) => { c.set('actor', { kind: 'human', id: 'u1' }); await next(); });
  parkHumanRoutes(app, store);
  return app;
}
const auth = (token = TOKEN) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

describe('park rules', () => {
  const saved = process.env['NM_PARK_TTL_HOURS'];
  afterEach(() => { if (saved === undefined) delete process.env['NM_PARK_TTL_HOURS']; else process.env['NM_PARK_TTL_HOURS'] = saved; });

  it('the TTL: 24 h by default, NM_PARK_TTL_HOURS moves it, a request is clamped to [1 min, 7 days]', () => {
    delete process.env['NM_PARK_TTL_HOURS'];
    expect(parkTtlMs()).toBe(86_400_000);
    expect(parkTtlMs(5_000)).toBe(PARK_TTL_MIN_MS);
    expect(parkTtlMs(30 * 86_400_000)).toBe(PARK_TTL_MAX_MS);
    expect(parkTtlMs(600_000)).toBe(600_000);
    process.env['NM_PARK_TTL_HOURS'] = '2';
    expect(parkTtlMs()).toBe(7_200_000);
    process.env['NM_PARK_TTL_HOURS'] = 'never';
    expect(parkTtlMs()).toBe(86_400_000);
  });

  it('only an explicit Approve approves; an expiry is a timeout denial', () => {
    expect(approvedOf('Approve')).toBe(true);
    expect(approvedOf(' approve ')).toBe(true);
    expect(approvedOf('Deny')).toBe(false);
    expect(approvedOf('Approve with changes')).toBe(false);
    expect(approvedOf(null)).toBe(false);
    expect(timeoutResolution()).toEqual({ answer: null, approved: false, reason: 'timeout', source: 'expiry' });
  });

  it('a park names its epoch, a known kind and uuid references', () => {
    const ok = { epoch: 3, key: 'k', kind: 'approval' };
    expect(CreateParkSchema.safeParse(ok).success).toBe(true);
    expect(CreateParkSchema.safeParse({ ...ok, epoch: undefined }).success).toBe(false);
    expect(CreateParkSchema.safeParse({ ...ok, kind: 'forever' }).success).toBe(false);
    expect(CreateParkSchema.safeParse({ ...ok, taskId: 'not-a-uuid' }).success).toBe(false);
    expect(CreateParkSchema.safeParse({ ...ok, key: '' }).success).toBe(false);
  });
});

describe('park and fact routes without postgres', () => {
  it('a person is never the machine caller; an unknown token is 401', async () => {
    const app = mkApp();
    const human = { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: 'u1' }) };
    expect((await app.request('/v1/machines/facts', { method: 'POST', headers: human, body: '{}' })).status).toBe(403);
    expect((await app.request('/v1/machines/parks', { method: 'POST', headers: human, body: '{}' })).status).toBe(403);
    expect((await app.request('/v1/machines/parks?status=resolved', { headers: auth(`nmm_${'ee'.repeat(24)}`) })).status).toBe(401);
  });

  it('a store without postgres refuses out loud (501), never a silent success', async () => {
    const app = mkApp();
    expect((await app.request('/v1/machines/facts', { method: 'POST', headers: auth(), body: JSON.stringify({ epoch: 1, kind: 'merged', subject: 's' }) })).status).toBe(501);
    expect((await app.request('/v1/machines/parks?status=resolved', { headers: auth() })).status).toBe(501);
    expect((await app.request('/v1/parks/0f0f0f0f-0000-4000-8000-000000000001/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer: 'Approve' }) })).status).toBe(501);
  });

  it('the cron needs its secret', async () => {
    const app = mkApp();
    expect((await app.request('/internal/park-sweep')).status).toBe(403);
  });
});
