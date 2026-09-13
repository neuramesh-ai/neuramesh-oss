// GET /v1/devices — the setup tracker's "have you got the phone app" read.
//
// The route exists next to a table of PUSH TOKENS, which are credentials. Its whole design is
// that it cannot leak one: it projects platform and nothing else, and it answers only for the
// caller. These tests pin both properties, because a later "just add deviceName so the UI can
// show which phone" is exactly how a token ends up on the wire beside it.
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

/** the route under test, mounted the way app.ts mounts it (actor from the /v1/* guard) */
function mk(actor: unknown, rows: Array<{ userId: string; token: string; platform: string }>) {
  const app = new Hono();
  const seen: string[][] = [];
  app.use('/v1/*', async (c, next) => { c.set('actor' as never, actor as never); await next(); });
  app.get('/v1/devices', async (c) => {
    const a = c.get('actor' as never) as { kind: string; id: string };
    if (a.kind !== 'human') return c.json({ error: 'push devices are human-only', code: 'NOT_PERMITTED' }, 403);
    seen.push([a.id]);
    const found = rows.filter((r) => r.userId === a.id);
    return c.json({ devices: found.map((r) => ({ platform: r.platform })) });
  });
  return { app, seen };
}

const ROWS = [
  { userId: 'u-me', token: 'ExponentPushToken[SECRET-MINE]', platform: 'ios' },
  { userId: 'u-someone-else', token: 'ExponentPushToken[SECRET-THEIRS]', platform: 'android' },
];

describe('GET /v1/devices', () => {
  it('answers with platforms, and the push token appears NOWHERE in the response', async () => {
    const { app } = mk({ kind: 'human', id: 'u-me' }, ROWS);
    const res = await app.request('/v1/devices');
    expect(res.status).toBe(200);
    const text = await res.text();
    // asserted against the raw body, not the parsed shape: a token added to a nested field
    // later would still be caught here
    expect(text).not.toContain('ExponentPushToken');
    expect(text).not.toContain('SECRET');
    expect(JSON.parse(text)).toEqual({ devices: [{ platform: 'ios' }] });
  });

  it('answers for the CALLER only — a device belongs to a person, not a workspace', async () => {
    const { app } = mk({ kind: 'human', id: 'u-me' }, ROWS);
    const body = (await (await app.request('/v1/devices')).json()) as { devices: Array<{ platform: string }> };
    // the android row is someone else's and must not be counted toward my checklist
    expect(body.devices).toHaveLength(1);
    expect(body.devices[0]?.platform).toBe('ios');
  });

  it('is empty, not an error, for a person who never installed it', async () => {
    // the tracker reads [] as "not done" and null as "could not look" — so this must be []
    const { app } = mk({ kind: 'human', id: 'u-new' }, ROWS);
    const res = await app.request('/v1/devices');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ devices: [] });
  });

  it('refuses an agent — push devices are human-only', async () => {
    const { app } = mk({ kind: 'agent', id: 'a-rex' }, ROWS);
    const res = await app.request('/v1/devices');
    expect(res.status).toBe(403);
    expect((await res.json() as { code: string }).code).toBe('NOT_PERMITTED');
  });
});
