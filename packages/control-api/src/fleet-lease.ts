// THE FLEET'S WRITER LEASE (0157, packages/fleet/src/lease.ts). nm-fleet holds it for every pass that may
// write Cloud Run worker pools, so only one fleet process writes at a time, even while two revisions
// of nm-fleet overlap in a deploy. Behind the fleet secret, above the /v1 gate (fleetRoutes):
//
//   POST /internal/fleet/lease          {name?, holder, ttlMs?}  → {held, holder, ttlMs, generation, acquired}
//   POST /internal/fleet/lease/release  {name?, holder}          → {released}
//
// A take succeeds when the row is absent, when the caller already holds it (a renewal), or when the
// holder's expiry has passed. `acquired` is true when the holder changed (generation moved): the new
// holder waits out its handoff grace before it writes. `ttlMs` is the time left on the server's clock,
// so the fleet never compares its own clock with the database's. A release moves the expiry into the
// past, so the next taker gets the lease at once instead of after the TTL.
import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import { z } from 'zod';
import { sqlOf } from './credits';
import type { Store } from './store';

export const LEASE_TTL_MIN_MS = 5_000;
export const LEASE_TTL_MAX_MS = 300_000;
export const LEASE_TTL_DEFAULT_MS = 30_000;

const Name = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).default('cloudrun');
const Holder = z.string().min(1).max(200);
const TakeSchema = z.object({ name: Name, holder: Holder, ttlMs: z.number().int().min(LEASE_TTL_MIN_MS).max(LEASE_TTL_MAX_MS).default(LEASE_TTL_DEFAULT_MS) });
const ReleaseSchema = z.object({ name: Name, holder: Holder });

export interface LeaseAnswer { held: boolean; holder: string; ttlMs: number; generation: number; acquired: boolean }

interface Row { holder: string; left_ms: string | number; generation: string | number; acquired: boolean }

/** take or renew the lease. One statement: the row's lock orders racing takers, and only one wins.
 *  acquired_at is now() exactly when this statement made the caller the holder (an insert, or a
 *  takeover), so `acquired` needs no second read */
export async function takeLease(sql: postgres.Sql, name: string, holder: string, ttlMs: number): Promise<LeaseAnswer> {
  const [won] = await sql<Row[]>`
    insert into fleet_leases as l (name, holder, expires_at)
    values (${name}, ${holder}, now() + ${ttlMs}::int * interval '1 millisecond')
    on conflict (name) do update
       set holder = excluded.holder,
           expires_at = excluded.expires_at,
           acquired_at = case when l.holder = excluded.holder then l.acquired_at else now() end,
           generation = l.generation + case when l.holder = excluded.holder then 0 else 1 end
     where l.holder = excluded.holder or l.expires_at < now()
    returning l.holder, (extract(epoch from (l.expires_at - now())) * 1000)::bigint as left_ms, l.generation, (l.acquired_at = now()) as acquired`;
  if (won) return { held: true, holder: won.holder, ttlMs: Math.max(0, Number(won.left_ms)), generation: Number(won.generation), acquired: won.acquired === true };
  const [cur] = await sql<Row[]>`
    select holder, greatest(0, (extract(epoch from (expires_at - now())) * 1000))::bigint as left_ms, generation, false as acquired
      from fleet_leases where name = ${name}`;
  return { held: false, holder: cur?.holder ?? '', ttlMs: Number(cur?.left_ms ?? 0), generation: Number(cur?.generation ?? 0), acquired: false };
}

/** give it up: only the holder can, and the next taker gets it at once */
export async function releaseLease(sql: postgres.Sql, name: string, holder: string): Promise<boolean> {
  const rows = await sql`update fleet_leases set expires_at = now() - interval '1 millisecond' where name = ${name} and holder = ${holder} and expires_at >= now() returning name`;
  return rows.length > 0;
}

export function fleetLeaseRoutes<E extends Env>(app: Hono<E>, store: Store): void {
  const fleetSecretOk = (auth: string | undefined): boolean => {
    const secret = process.env['FLEET_SECRET'];
    return Boolean(secret) && auth === `Bearer ${secret}`;
  };

  app.post('/internal/fleet/lease', async (c) => {
    if (!fleetSecretOk(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'fleet not served by this store' }, 501);
    const body = TakeSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid lease request', code: 'INVALID_INPUT', issues: body.error.issues }, 400);
    const out = await takeLease(sql, body.data.name, body.data.holder, body.data.ttlMs);
    if (out.acquired) console.log(`fleet_lease_acquired name=${body.data.name} holder=${out.holder} generation=${out.generation}`);
    return c.json(out);
  });

  app.post('/internal/fleet/lease/release', async (c) => {
    if (!fleetSecretOk(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'fleet not served by this store' }, 501);
    const body = ReleaseSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid lease release', code: 'INVALID_INPUT' }, 400);
    const released = await releaseLease(sql, body.data.name, body.data.holder);
    if (released) console.log(`fleet_lease_released name=${body.data.name} holder=${body.data.holder}`);
    return c.json({ released });
  });
}
