// The Always on switch without a database: the role rule and the route's refusals that come before
// any SQL. The writes themselves run against the real schema in test/always-on.pg.test.ts.
import type { Actor } from '@neuramesh/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { alwaysOnRoutes, mayChangeAlwaysOn } from './machine-always-on.js';
import type { Store } from './store';

const ME = 'u-me';
const OTHER = 'u-other';

describe('mayChangeAlwaysOn: who may switch it', () => {
  it('a member machine: only its owner, whatever their role', () => {
    const mine = { kind: 'member', ownerUserId: ME };
    expect(mayChangeAlwaysOn(mine, ME, 'member')).toBe(true);
    expect(mayChangeAlwaysOn(mine, ME, 'owner')).toBe(true);
    // a workspace owner or admin does not switch somebody else's machine
    expect(mayChangeAlwaysOn(mine, OTHER, 'owner')).toBe(false);
    expect(mayChangeAlwaysOn(mine, OTHER, 'admin')).toBe(false);
    expect(mayChangeAlwaysOn(mine, OTHER, 'member')).toBe(false);
  });

  it('the runner: a workspace owner or admin, never a plain member', () => {
    const runner = { kind: 'runner', ownerUserId: ME };
    expect(mayChangeAlwaysOn(runner, OTHER, 'owner')).toBe(true);
    expect(mayChangeAlwaysOn(runner, OTHER, 'admin')).toBe(true);
    expect(mayChangeAlwaysOn(runner, OTHER, 'member')).toBe(false);
    // the runner's owner_user_id is who minted it, not a grant
    expect(mayChangeAlwaysOn(runner, ME, 'member')).toBe(false);
  });

  it('a local machine: nobody, and a non-member: never', () => {
    expect(mayChangeAlwaysOn({ kind: 'local', ownerUserId: ME }, ME, 'owner')).toBe(false);
    expect(mayChangeAlwaysOn({ kind: 'member', ownerUserId: ME }, ME, null)).toBe(false);
    expect(mayChangeAlwaysOn({ kind: 'runner', ownerUserId: ME }, ME, null)).toBe(false);
  });
});

const mkApp = (store: Partial<Store>, actor: Actor = { kind: 'human', id: ME }): Hono<{ Variables: { actor: Actor } }> => {
  const app = new Hono<{ Variables: { actor: Actor } }>();
  app.use('/v1/*', async (c, next) => { c.set('actor', actor); await next(); });
  alwaysOnRoutes(app, store as Store);
  return app;
};
const post = (app: Hono<{ Variables: { actor: Actor } }>, body: unknown) =>
  app.request('/v1/machines/always-on', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const WS = '00000000-0000-4000-8000-0000000a1001';
const M = '00000000-0000-4000-8000-0000000a1002';

describe('POST /v1/machines/always-on before the database', () => {
  it('names a bad body: workspace, machineId and a boolean `on`', async () => {
    const app = mkApp({});
    expect((await post(app, { machineId: M, on: true })).status).toBe(400);
    expect((await post(app, { workspace: WS, machineId: 'runner', on: true })).status).toBe(400);
    expect((await post(app, { workspace: WS, machineId: M })).status).toBe(400);
    expect((await post(app, { workspace: WS, machineId: M, on: 'yes' })).status).toBe(400);
  });

  it('is human only: an agent cannot keep a machine awake on the credit balance', async () => {
    const app = mkApp({}, { kind: 'agent', id: 'a1', role: 'orchestrator' });
    const res = await post(app, { workspace: WS, machineId: M, on: true });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_PERMITTED');
  });

  it('501s on a store with no postgres', async () => {
    expect((await post(mkApp({}), { workspace: WS, machineId: M, on: true })).status).toBe(501);
  });
});
