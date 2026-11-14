// The Cloud Run lifecycle the sandbox e2e (scripts/e2e-cloudrun/lifecycle.mjs) drives through its
// doors, against the REAL schema. Two gaps this file closes:
//   · the cap drain had no test on cloudrun: at zero credits a quiet runner drains with reason cap,
//     the drained report parks it, a message and the Wake button cannot raise it, and a top-up lets
//     the next sweep's rewake pass raise it again
//   · the e2e doors that drive it (e2e-routes.ts): spend-all zeroes a balance, routines-due runs the
//     cron's routine pass for ONE workspace only (another workspace's due routine stays asleep), and
//     the parks read shows every park of a workspace whatever its status
//
// Run via scripts/test-pg.sh. Skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import { Hono } from 'hono';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { creditBalance } from '../src/credit-ledger';
import { e2eRoutes } from '../src/e2e-routes';
import { cloudRunSweep } from '../src/fleet-cloudrun-sweep';
import { bumpMachineWake } from '../src/fleet-lifecycle';
import { PostgresStore } from '../src/pgstore';
import { applyPlanPatch } from '../src/plan-flip';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const doors = store ? new Hono() : null;
if (doors && store) e2eRoutes(doors, store);
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

const ENV = { FLEET_SECRET: 'test-fleet-secret', FLEET_CLOUDRUN: '1', NM_E2E_ROUTES: '1', FLEET_AUTOPROVISION: 'on' } as const;
const saved: Record<string, string | undefined> = {};
const fleet = { authorization: 'Bearer test-fleet-secret', 'content-type': 'application/json' };

let owner: Actor;
interface Ws { id: string; channel: string; runner: string }
let A: Ws; let B: Ws;
let TOKEN = '';

async function makeUser(clerkId: string, email: string): Promise<Actor> {
  const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${clerkId}, ${email})
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  return { kind: 'human', id: row!['id'] as string };
}
const send = (actor: Actor, path: string, body: unknown) => app!.request(path, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body),
});
const door = (method: string, path: string, body?: unknown) => doors!.request(path, { method, headers: fleet, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const machine = async (id: string) => (await sql!`select desired_replicas, drain_state, drain_reason, parked_at, last_wake_at, started_at, snapshot_work from machines where id = ${id}::uuid`)[0]!;
const status = (body: unknown) => app!.request('/v1/machines/status', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** a Pro workspace with its runner, the way the product makes one (the flip to Pro mints the runner) */
async function workspace(tag: string): Promise<Ws> {
  const made = await j(await send(owner, '/v1/commands', { type: 'workspace.create', name: `Lifecycle ${tag}`, slug: `lc-${tag}-${Date.now().toString(36)}` }));
  await sql!`update workspaces set plan = 'free' where id = ${made.workspaceId}::uuid`;
  expect(await applyPlanPatch(store!, { workspace: made.workspaceId, patch: { plan: 'cloud', subscriptionStatus: 'active', stripeSubscriptionId: `sub_lc_${String(made.workspaceId).slice(0, 8)}` } })).toBe('ok');
  const [r] = await sql!`select id from machines where workspace_id = ${made.workspaceId}::uuid and kind = 'runner'`;
  const runner = r!['id'] as string;
  await sql!`update machines set substrate = 'cloudrun' where id = ${runner}::uuid`;
  return { id: made.workspaceId, channel: made.channelId, runner };
}
const routine = async (ws: Ws, inMin: number) => {
  const res = await send(owner, '/v1/commands', { type: 'schedule.create', channel: ws.channel, title: `lc +${inMin}m`, prompt: 'say hello', cadence: 'once', runAt: new Date(Date.now() + inMin * 60_000).toISOString(), routine: true });
  expect(res.status).toBe(200);
};
const park = (ws: Ws) => sql!`update machines set desired_replicas = 0, started_at = null, drain_state = null, drain_reason = null, drain_deadline = null where id = ${ws.runner}::uuid`;

beforeAll(async () => {
  if (!sql) return;
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  owner = await makeUser('clerk_lc_owner', 'owner@lifecycle-doors.test');
  A = await workspace('a');
  B = await workspace('b');
  // a known balance on both, whatever the birth and the flip granted
  for (const ws of [A, B]) expect((await door('POST', `/internal/e2e/workspaces/${ws.id}/fund`, { credits: 10 })).status).toBe(200);
  const credential = ((await j(await app!.request(`/internal/machines/${A.runner}/boot-credential`, { method: 'POST', headers: fleet }))) as { credential: string }).credential;
  const boot = await app!.request('/v1/machines/boot', { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: '{}' });
  expect(boot.status).toBe(200);
  TOKEN = ((await j(boot)) as { token: string }).token;
});

afterAll(async () => {
  // park what this suite left up: a zero-balance machine left awake is what other suites' sweeps act on
  if (sql) for (const ws of [A, B]) if (ws) await sql`update machines set desired_replicas = 0, started_at = null, drain_state = null, drain_reason = null, drain_deadline = null where id = ${ws.runner}::uuid`.catch(() => {});
  if (sql) for (const ws of [A, B]) if (ws) await sql`delete from schedules where workspace_id = ${ws.id}::uuid`.catch(() => {});
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('the cloudrun cap drain and the lifecycle e2e doors', () => {

  it('spend-all is shut without the fleet secret, and zeroes both pools with it', async () => {
    expect((await doors!.request(`/internal/e2e/workspaces/${A.id}/spend-all`, { method: 'POST', headers: { authorization: 'Bearer wrong' } })).status).toBe(403);
    expect((await creditBalance(sql!, A.id)).remainingMicros).toBeGreaterThan(0);
    const res = await door('POST', `/internal/e2e/workspaces/${A.id}/spend-all`);
    expect(res.status).toBe(200);
    expect(await j(res)).toEqual({ workspaceId: A.id, remainingMicros: 0 });
    expect((await creditBalance(sql!, A.id)).remainingMicros).toBe(0);
    // a workspace with no credit row is named, not silently zeroed
    expect((await door('POST', '/internal/e2e/workspaces/00000000-0000-0000-0000-0000000000ff/spend-all')).status).toBe(404);
  });

  it('at zero the cap drain waits out 10 quiet minutes, then asks the runner to drain, and the drained report parks it', async () => {
    await sql!`update machines set desired_replicas = 1, last_active_at = now() - interval '2 minutes' where id = ${A.runner}::uuid`;
    expect((await cloudRunSweep(sql!, 2880)).capDrains).not.toContain(A.runner);
    await sql!`update machines set last_active_at = now() - interval '11 minutes' where id = ${A.runner}::uuid`;
    expect((await cloudRunSweep(sql!, 2880)).capDrains).toContain(A.runner);
    expect(await machine(A.runner)).toMatchObject({ drain_state: 'draining', drain_reason: 'cap', desired_replicas: 1 });
    const control = await j(await app!.request('/v1/machines/control', { headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(control).toMatchObject({ action: 'drain', epoch: 1 });
    expect(await j(await status({ state: 'drained', epoch: 1, reason: 'controller', snapshot: { work: 'work-e1' } }))).toMatchObject({ move: 'park' });
    const r = await machine(A.runner);
    expect(r).toMatchObject({ desired_replicas: 0, drain_state: null, snapshot_work: 'work-e1' });
    expect(r['parked_at']).not.toBeNull();
  });

  it('at zero a message stamps the wake but cannot raise the runner, the Wake button answers NO_CREDITS, and the top-up lets the sweep raise it', async () => {
    const parkedAt = new Date((await machine(A.runner))['parked_at'] as string).getTime();
    await bumpMachineWake(sql!, A.id, null); // what POST /v1/messages fires
    const m = await machine(A.runner);
    expect(m['desired_replicas']).toBe(0);
    expect(new Date(m['last_wake_at'] as string).getTime()).toBeGreaterThan(parkedAt);
    const wake = await send(owner, '/v1/machines/wake', { workspace: A.id, machineId: A.runner });
    expect(wake.status).toBe(409);
    expect(await j(wake)).toMatchObject({ code: 'NO_CREDITS' });
    expect((await cloudRunSweep(sql!, 2880)).rewoken).not.toContain(A.runner);
    const topUp = await door('POST', `/internal/e2e/workspaces/${A.id}/fund`, { credits: 50 });
    expect(topUp.status).toBe(200);
    // the balance in micros rides the answer (the Always on billing check watches it move)
    expect((await j(topUp)).remainingMicros).toBe(50 * 10_000);
    expect((await cloudRunSweep(sql!, 2880)).rewoken).toContain(A.runner);
    expect(await machine(A.runner)).toMatchObject({ desired_replicas: 1 });
  });

  it('routines-due runs the cron pass for its own workspace only: B\'s due routine stays asleep', async () => {
    await park(A); await park(B);
    await routine(A, 3);
    await routine(B, 3);
    expect((await doors!.request(`/internal/e2e/workspaces/${A.id}/routines-due`, { method: 'POST', headers: { authorization: 'Bearer wrong' } })).status).toBe(403);
    const res = await door('POST', `/internal/e2e/workspaces/${A.id}/routines-due`);
    expect(res.status).toBe(200);
    const out = await j(res);
    expect(out).toMatchObject({ considered: [A.id], woken: [A.id], capped: [], horizonMin: 10 });
    expect((await machine(A.runner))['desired_replicas']).toBe(1);
    expect((await machine(B.runner))['desired_replicas']).toBe(0);
    // A is intended up now: a second pass finds nothing to do
    expect(await j(await door('POST', `/internal/e2e/workspaces/${A.id}/routines-due`))).toMatchObject({ considered: [], woken: [] });
  });

  it('routines-due at zero credits names the workspace capped and leaves the runner asleep', async () => {
    await park(B);
    await door('POST', `/internal/e2e/workspaces/${B.id}/spend-all`);
    const out = await j(await door('POST', `/internal/e2e/workspaces/${B.id}/routines-due`));
    expect(out).toMatchObject({ considered: [B.id], woken: [], capped: [B.id] });
    expect((await machine(B.runner))['desired_replicas']).toBe(0);
  });

  it('the parks read lists every park of the workspace, any status, and only that workspace', async () => {
    const [p] = await sql!`insert into parks (workspace_id, machine_id, key, kind, request, checkpoint, wake_condition, status, expires_at, created_epoch)
      values (${A.id}::uuid, ${A.runner}::uuid, 'lc-door-test', 'approval', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'done', now() + interval '1 hour', 1) returning id`;
    const res = await door('GET', `/internal/e2e/workspaces/${A.id}/parks`);
    expect(res.status).toBe(200);
    const { parks } = await j(res);
    expect(parks.map((x: { id: string }) => x.id)).toContain(p!['id']);
    expect(parks.find((x: { id: string }) => x.id === p!['id'])).toMatchObject({ status: 'done', createdEpoch: 1, machineId: A.runner });
    expect((await j(await door('GET', `/internal/e2e/workspaces/${B.id}/parks`))).parks).toEqual([]);
    expect((await doors!.request(`/internal/e2e/workspaces/${A.id}/parks`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(403);
  });
  it('keeps a slow snapshot alive past three minutes and parks from its original drain start after acknowledgement', async () => {
    await sql!`update machines set desired_replicas = 1, started_at = now(), last_active_at = now() - interval '11 minutes',
      drain_state = null, drain_reason = null, drain_deadline = null where id = ${A.runner}::uuid`;
    await door('POST', `/internal/e2e/workspaces/${A.id}/spend-all`);
    expect((await cloudRunSweep(sql!, 2880)).capDrains).toContain(A.runner);
    // Move four minutes into the real sweep's deadline, covering turn grace,
    // queued writes and the measured176.4s large snapshot, without wall-clock sleep.
    await sql!`update machines set drain_deadline = drain_deadline - interval '4 minutes' where id = ${A.runner}::uuid`;
    const response = await app!.request('/internal/fleet-desired', { headers: fleet });
    expect(response.status).toBe(200);
    const desired = await j(response);
    expect(desired.workspaces.find((row: { id: string }) => row.id === A.id)?.machines
      .find((row: { id: string }) => row.id === A.runner)?.replicas).toBe(1);
    expect((await cloudRunSweep(sql!, 2880)).lost).not.toContain(A.runner);
    expect(await j(await status({ state: 'drained', epoch: 1, reason: 'controller', drainMs: 240_000,
      snapshot: { work: 'work-e1' } }))).toMatchObject({ move: 'park' });
    const [row] = await sql!`select desired_replicas, drain_lost_at,
      extract(epoch from (now() - parked_at)) as elapsed from machines where id = ${A.runner}::uuid`;
    expect(row!['desired_replicas']).toBe(0);
    expect(row!['drain_lost_at']).toBeNull();
    expect(Number(row!['elapsed'])).toBeGreaterThanOrEqual(240);
    expect(Number(row!['elapsed'])).toBeLessThan(250);
    await door('POST', `/internal/e2e/workspaces/${A.id}/fund`, { credits: 10 });
  });

});
