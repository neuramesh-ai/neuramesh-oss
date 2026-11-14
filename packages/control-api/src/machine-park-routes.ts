import { cronAuthorized } from './cron-auth';
// The park routes (machine-parks.ts holds the rules and the SQL). Two halves:
//   machineParkRoutes  ABOVE the /v1 gate (app.ts): the machine bearer is proven by machineFromBearer,
//                      which tells a replaced Cloud Run token (409 STALE_EPOCH) from an unknown one
//                      (401); plus the expiry cron, behind CRON_SECRET
//   parkHumanRoutes    AFTER the gate: a person lists a workspace's open parks and answers one
import type { Actor } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import { z } from 'zod';
import { sqlOf } from './credits';
import { refuse } from './fleet-cloudrun';
import { machineFromBearer } from './fleet-cloudrun-boot';
import { pruneTickFacts } from './machine-facts';
import {
  approvedOf, claimableParks, claimPark, COLS, createPark, CreateParkSchema, Epoch, expireParks, finishPark, liveParkByKey,
  openParks, parkSweep, readPark, resolvePark, ResolutionSchema, toPark, Uuid, type ParkResolution, type ParkRow, type ResolutionSource,
} from './machine-parks';
import type { Store } from './store';

const ClaimSchema = z.object({ epoch: Epoch });
const DoneSchema = z.object({ epoch: Epoch, resolution: ResolutionSchema.optional() });
const MachineResolveSchema = z.object({ epoch: Epoch, resolution: ResolutionSchema });
const HumanResolveSchema = z.object({ answer: z.string().min(1).max(2_000), reason: z.string().max(500).optional() });

const asResolution = (r: z.infer<typeof ResolutionSchema>, source: ResolutionSource, by?: { kind: string; id: string }): ParkResolution => ({
  answer: r.answer, approved: r.approved ?? approvedOf(r.answer), ...(r.reason ? { reason: r.reason } : {}), source, ...(by ? { by } : {}),
});

/** the machine half and the sweep, ABOVE the /v1 gate (app.ts): the bearer check is machineFromBearer's */
export function machineParkRoutes<E extends Env>(app: Hono<E>, store: Store): void {
  const lane = async (authorization: string | undefined) => {
    const machine = await machineFromBearer(store, authorization);
    if ('error' in machine) return { refused: { error: machine.error, code: machine.code }, status: machine.status } as const;
    const sql = sqlOf(store);
    if (!sql) return { refused: { error: 'parks are not served by this store', code: 'NOT_CONFIGURED' }, status: 501 as const } as const;
    return { machine, sql } as const;
  };
  const parkId = (raw: string): string | null => (Uuid.safeParse(raw).success ? raw : null);

  app.post('/v1/machines/parks', async (c) => {
    const l = await lane(c.req.header('authorization'));
    if ('refused' in l) return c.json(l.refused, l.status);
    const body = CreateParkSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid park', code: 'INVALID_INPUT', issues: body.error.issues }, 400);
    try {
      const out = await createPark(l.sql, l.machine.id, body.data);
      if (out.created) console.log(`park_open machine=${l.machine.id} park=${out.park.id} kind=${out.park.kind} expires=${out.park.expiresAt}`);
      return c.json(out, out.created ? 201 : 200);
    } catch (e) {
      return refuse(c, e);
    }
  });

  // ?status=resolved → what this machine should claim (resolved, expired, or a dead epoch's claim);
  // ?status=open → its open parks (the busy rule); ?key= → the live park under that key, or null
  app.get('/v1/machines/parks', async (c) => {
    const l = await lane(c.req.header('authorization'));
    if ('refused' in l) return c.json(l.refused, l.status);
    const key = c.req.query('key');
    if (key !== undefined) {
      if (!key || key.length > 512) return c.json({ error: 'the key is 1 to 512 characters', code: 'INVALID_INPUT' }, 400);
      await expireParks(l.sql, l.machine.id);
      return c.json({ park: await liveParkByKey(l.sql, l.machine.id, key) });
    }
    const status = c.req.query('status') ?? 'resolved';
    if (status === 'resolved') return c.json({ parks: await claimableParks(l.sql, l.machine.id) });
    if (status === 'open') return c.json({ parks: await openParks(l.sql, l.machine.id) });
    return c.json({ error: 'status is resolved or open', code: 'INVALID_INPUT' }, 400);
  });

  app.post('/v1/machines/parks/:id/claim', async (c) => {
    const l = await lane(c.req.header('authorization'));
    if ('refused' in l) return c.json(l.refused, l.status);
    const id = parkId(c.req.param('id'));
    const body = ClaimSchema.safeParse(await c.req.json().catch(() => null));
    if (!id || !body.success) return c.json({ error: 'name the park and the epoch', code: 'INVALID_INPUT' }, 400);
    try {
      const park = await claimPark(l.sql, l.machine.id, id, body.data.epoch);
      console.log(`park_claimed machine=${l.machine.id} park=${id} epoch=${body.data.epoch}`);
      return c.json({ park });
    } catch (e) {
      return refuse(c, e);
    }
  });

  app.post('/v1/machines/parks/:id/done', async (c) => {
    const l = await lane(c.req.header('authorization'));
    if ('refused' in l) return c.json(l.refused, l.status);
    const id = parkId(c.req.param('id'));
    const body = DoneSchema.safeParse(await c.req.json().catch(() => null));
    if (!id || !body.success) return c.json({ error: 'name the park and the epoch', code: 'INVALID_INPUT' }, 400);
    try {
      const res = body.data.resolution ? asResolution(body.data.resolution, 'machine') : null;
      return c.json({ park: await finishPark(l.sql, l.machine.id, id, body.data.epoch, res) });
    } catch (e) {
      return refuse(c, e);
    }
  });

  // the machine relays an answer the person gave in ITS session (a Code tab's approval, a reply line
  // it read): the park resolves without a wake, because the machine that relays it is awake
  app.post('/v1/machines/parks/:id/resolve', async (c) => {
    const l = await lane(c.req.header('authorization'));
    if ('refused' in l) return c.json(l.refused, l.status);
    const id = parkId(c.req.param('id'));
    const body = MachineResolveSchema.safeParse(await c.req.json().catch(() => null));
    if (!id || !body.success) return c.json({ error: 'name the park, the epoch and the resolution', code: 'INVALID_INPUT' }, 400);
    try {
      const out = await resolvePark(l.sql, id, asResolution(body.data.resolution, 'machine'), { wake: false, machineId: l.machine.id, epoch: body.data.epoch });
      return c.json({ park: out.park });
    } catch (e) {
      return refuse(c, e);
    }
  });

  // the cron: `authorization: Bearer $CRON_SECRET`, the machine-sweep idiom (fleet-lifecycle.ts)
  app.get('/internal/park-sweep', async (c) => {
    if (!(await cronAuthorized(c.req.header('authorization')))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'parks are not served by this store' }, 501);
    const out = await parkSweep(sql);
    if (out.expired.length) console.log(`park-sweep: expired=[${out.expired.join(',')}] woken=${out.woken}`);
    // the sweep-tick leases are worthless after their bucket (machine-facts.ts TICK_FACT_KINDS)
    const pruned = await pruneTickFacts(sql).catch((e: unknown) => { console.warn(`park-sweep: tick facts not pruned: ${e instanceof Error ? e.message : String(e)}`); return 0; });
    return c.json({ ...out, prunedTickFacts: pruned });
  });
}

/** the human half, AFTER the /v1 gate (it reads the actor): list a workspace's open parks, answer one */
export function parkHumanRoutes<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store): void {
  app.get('/v1/parks', async (c) => {
    const workspace = c.req.query('workspace');
    if (!workspace || !Uuid.safeParse(workspace).success) return c.json({ error: 'workspace required', code: 'INVALID_INPUT' }, 400);
    const actor = c.get('actor');
    if (actor.kind !== 'human') return c.json({ error: 'parks are answered by a human', code: 'HUMAN_ONLY' }, 403);
    if (!(await store.humanMemberIds(workspace)).includes(actor.id)) return c.json({ error: 'not a member of this workspace', code: 'NOT_PERMITTED' }, 403);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'parks are not served by this store', code: 'NOT_CONFIGURED' }, 501);
    const rows = await sql<ParkRow[]>`select ${COLS(sql)} from parks p where p.workspace_id = ${workspace}::uuid and p.status = 'open' order by p.created_at asc limit 200`;
    return c.json({ parks: rows.map(toPark) });
  });

  // {answer, reason?}: resolve one open park and wake its machine if it sleeps
  app.post('/v1/parks/:id/resolve', async (c) => {
    const id = c.req.param('id');
    if (!Uuid.safeParse(id).success) return c.json({ error: 'invalid park id', code: 'INVALID_INPUT' }, 400);
    const actor = c.get('actor');
    if (actor.kind !== 'human') return c.json({ error: 'parks are answered by a human', code: 'HUMAN_ONLY' }, 403);
    const body = HumanResolveSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'give an answer', code: 'INVALID_INPUT' }, 400);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'parks are not served by this store', code: 'NOT_CONFIGURED' }, 501);
    const park = await readPark(sql, id);
    // a park in a workspace the person is not in reads as absent, never as forbidden
    if (!park || !(await store.humanMemberIds(park.workspaceId)).includes(actor.id)) return c.json({ error: 'no such park', code: 'NOT_FOUND' }, 404);
    try {
      const by = { kind: actor.kind, id: actor.id };
      const out = await resolvePark(sql, id, asResolution({ answer: body.data.answer, ...(body.data.reason ? { reason: body.data.reason } : {}) }, 'human', by));
      return c.json(out);
    } catch (e) {
      return refuse(c, e);
    }
  });
}
