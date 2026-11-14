// THE FLEET'S WRITER LEASE against the REAL schema (0157, fleet-lease.ts): one holder at a time, a
// renewal keeps it, a takeover waits for the expiry or a release, racing takers get exactly one winner,
// and only the holder can release. Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { releaseLease, takeLease } from '../src/fleet-lease';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const fleet = { authorization: 'Bearer test-fleet-secret', 'content-type': 'application/json' };
// a name of its own per run: the table is shared with any other lease test
const NAME = `test-${Date.now().toString(36)}`;
let savedSecret: string | undefined;

beforeAll(() => { savedSecret = process.env['FLEET_SECRET']; process.env['FLEET_SECRET'] = 'test-fleet-secret'; });
afterAll(async () => {
  if (savedSecret === undefined) delete process.env['FLEET_SECRET']; else process.env['FLEET_SECRET'] = savedSecret;
  if (sql) await sql`delete from fleet_leases where name like 'test-%'`.catch(() => {});
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('fleet writer lease on postgres (0157)', () => {
  it('the first taker holds it; the holder renews without a handoff; another taker is refused with the time left', async () => {
    const a = await takeLease(sql!, NAME, 'rev-7', 30_000);
    expect(a).toMatchObject({ held: true, holder: 'rev-7', generation: 1, acquired: true });
    expect(a.ttlMs).toBeGreaterThan(29_000);
    const renew = await takeLease(sql!, NAME, 'rev-7', 30_000);
    expect(renew).toMatchObject({ held: true, holder: 'rev-7', generation: 1, acquired: false });
    const b = await takeLease(sql!, NAME, 'rev-8', 30_000);
    expect(b).toMatchObject({ held: false, holder: 'rev-7', generation: 1, acquired: false });
    expect(b.ttlMs).toBeGreaterThan(25_000);
  });

  it('a release by the holder hands it over at once; a release by anyone else does nothing', async () => {
    expect(await releaseLease(sql!, NAME, 'rev-8')).toBe(false);
    expect((await takeLease(sql!, NAME, 'rev-8', 30_000)).held).toBe(false);
    expect(await releaseLease(sql!, NAME, 'rev-7')).toBe(true);
    const b = await takeLease(sql!, NAME, 'rev-8', 30_000);
    expect(b).toMatchObject({ held: true, holder: 'rev-8', generation: 2, acquired: true });
    // the old holder, after its release, is refused like any other taker
    expect((await takeLease(sql!, NAME, 'rev-7', 30_000)).held).toBe(false);
  });

  it('an expired lease is taken over, and the old holder cannot renew it back', async () => {
    await sql!`update fleet_leases set expires_at = now() - interval '1 second' where name = ${NAME}`;
    const c = await takeLease(sql!, NAME, 'rev-9', 30_000);
    expect(c).toMatchObject({ held: true, holder: 'rev-9', generation: 3, acquired: true });
    expect((await takeLease(sql!, NAME, 'rev-8', 30_000))).toMatchObject({ held: false, holder: 'rev-9' });
  });

  it('racing takers on a free lease: exactly one wins', async () => {
    const name = `${NAME}-race`;
    const out = await Promise.all(Array.from({ length: 8 }, (_, i) => takeLease(sql!, name, `racer-${i}`, 30_000)));
    const winners = out.filter((o) => o.held);
    expect(winners).toHaveLength(1);
    expect(out.every((o) => o.holder === winners[0]!.holder)).toBe(true);
  });

  it('the routes: the fleet secret, the defaults, the bounds', async () => {
    const post = (path: string, body: unknown, headers: Record<string, string> = fleet) => app!.request(path, { method: 'POST', headers, body: JSON.stringify(body) });
    expect((await post('/internal/fleet/lease', { holder: 'x' }, { 'content-type': 'application/json' })).status).toBe(403);
    expect((await post('/internal/fleet/lease', { name: `${NAME}-r`, holder: 'x', ttlMs: 100 })).status).toBe(400);
    const took = (await (await post('/internal/fleet/lease', { name: `${NAME}-r`, holder: 'route-1' })).json()) as { held: boolean; ttlMs: number; acquired: boolean };
    expect(took).toMatchObject({ held: true, acquired: true });
    expect(took.ttlMs).toBeGreaterThan(25_000);
    expect(took.ttlMs).toBeLessThanOrEqual(30_000);
    expect(await (await post('/internal/fleet/lease/release', { name: `${NAME}-r`, holder: 'route-1' })).json()).toEqual({ released: true });
    expect(await (await post('/internal/fleet/lease/release', { name: `${NAME}-r`, holder: 'route-1' })).json()).toEqual({ released: false });
  });
});
