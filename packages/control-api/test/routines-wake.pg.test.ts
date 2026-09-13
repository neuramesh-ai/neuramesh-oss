// A routine wakes the machine that runs it (routines-wake.ts), against the REAL schema.
//
// What this locks down:
//   · a slot inside the horizon with nothing up wakes the runner — desired_replicas 0 → 1, started_at stamped
//   · a laptop beating inside the online window counts as "up": no wake
//   · a cloud machine already intended up counts as "up": no second bump
//   · a slot beyond the horizon waits; a slot already MISSED (in the past) still wakes
//   · at zero balance the bump refuses and the pass reports the workspace as capped
//   · the cron lane is CRON_SECRET-gated
//
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { grantCredits } from '../src/credit-ledger';
import { bumpMachineWake } from '../src/fleet-lifecycle';
import { PostgresStore } from '../src/pgstore';
import { applyPlanPatch } from '../src/plan-flip';
import { dueRoutineWorkspaces, wakeForDueRoutines } from '../src/routines-wake';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const bump = (s: postgres.Sql, ws: string) => bumpMachineWake(s, ws, null);

function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}
async function makeUser(clerkId: string, email: string): Promise<Actor> {
  const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${clerkId}, ${email})
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  return { kind: 'human', id: row!['id'] as string };
}

let prevFlag: string | undefined; let prevCron: string | undefined;
let owner: Actor;
let WS = ''; let CHANNEL = ''; let RUNNER = '';

const runner = async () => (await sql!`select desired_replicas, started_at from machines where id = ${RUNNER}::uuid`)[0]!;
const park = () => sql!`update machines set desired_replicas = 0, started_at = null where workspace_id = ${WS}::uuid`;
/** a one-shot routine `inMin` minutes from now, through the real command (Team plan required) */
async function routine(inMin: number, title = `routine +${inMin}m`): Promise<string> {
  const res = await send(owner, {
    type: 'schedule.create', channel: CHANNEL, title, prompt: 'say hello', cadence: 'once',
    runAt: new Date(Date.now() + inMin * 60_000).toISOString(), routine: true,
  });
  expect(res.status).toBe(200);
  return (await j(res)).scheduleId as string;
}
const clearRoutines = () => sql!`delete from schedules where workspace_id = ${WS}::uuid`;

beforeAll(async () => {
  if (!sql) return;
  prevFlag = process.env['FLEET_AUTOPROVISION']; process.env['FLEET_AUTOPROVISION'] = 'on';
  prevCron = process.env['CRON_SECRET']; process.env['CRON_SECRET'] = 'test-cron-secret';
  owner = await makeUser('clerk_rw_owner', 'owner@routines-wake.test');
  const made = await j(await send(owner, { type: 'workspace.create', name: 'Routines Wake', slug: `rw-${Date.now().toString(36)}` }));
  WS = made.workspaceId; CHANNEL = made.channelId;
  // schedules are Pro, and since the source release the runner is minted by the flip to Pro
  // (plan-flip.ts), not at create — so go to Pro the way the product does
  await sql`update workspaces set plan = 'free' where id = ${WS}::uuid`;
  expect(await applyPlanPatch(store!, { workspace: WS, patch: { plan: 'cloud', subscriptionStatus: 'active', stripeSubscriptionId: `sub_rw_${WS.slice(0, 8)}` } })).toBe('ok');
  const [r] = await sql`select id from machines where workspace_id = ${WS}::uuid and kind = 'runner'`;
  RUNNER = r!['id'] as string;
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env['FLEET_AUTOPROVISION']; else process.env['FLEET_AUTOPROVISION'] = prevFlag;
  if (prevCron === undefined) delete process.env['CRON_SECRET']; else process.env['CRON_SECRET'] = prevCron;
  // park what this suite woke — a zero-balance machine left awake is what the sweep parks, and
  // the credit-pools suite asserts on what the sweep parked
  if (sql && WS) await sql`update machines set desired_replicas = 0, started_at = null where workspace_id = ${WS}::uuid`;
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('a routine wakes its runner (routines-wake)', () => {
  it('a slot inside the horizon with nothing up wakes the runner, and only once', async () => {
    await park();
    await routine(5);
    expect(await dueRoutineWorkspaces(sql!, 10)).toContain(WS);
    const out = await wakeForDueRoutines(sql!, bump, 10);
    expect(out.woken).toContain(WS);
    expect(out.capped).not.toContain(WS);
    const after = await runner();
    expect(after['desired_replicas']).toBe(1);
    expect(after['started_at']).not.toBeNull();
    // already intended up now: the next pass leaves it alone
    expect(await dueRoutineWorkspaces(sql!, 10)).not.toContain(WS);
  });

  it('a slot beyond the horizon waits; a slot already missed still wakes', async () => {
    await clearRoutines(); await park();
    const id = await routine(120);
    expect(await dueRoutineWorkspaces(sql!, 10)).not.toContain(WS);
    // the machine slept through it: the row is in the past and still active — wake for it
    await sql!`update schedules set next_run_at = now() - interval '1 hour' where id = ${id}::uuid`;
    expect(await dueRoutineWorkspaces(sql!, 10)).toContain(WS);
    const out = await wakeForDueRoutines(sql!, bump, 10);
    expect(out.woken).toContain(WS);
    expect((await runner())['desired_replicas']).toBe(1);
  });

  it('a laptop beating inside the online window is "up": no wake', async () => {
    await clearRoutines(); await park();
    await routine(5);
    const [lap] = await sql!`insert into machines (workspace_id, owner_user_id, name, platform, kind, last_seen_at)
      values (${WS}::uuid, ${owner.id}::uuid, 'rw-laptop', 'darwin', 'local', now()) returning id`;
    expect(await dueRoutineWorkspaces(sql!, 10)).not.toContain(WS);
    // …until it stops beating
    await sql!`update machines set last_seen_at = now() - interval '10 minutes' where id = ${lap!['id']}::uuid`;
    expect(await dueRoutineWorkspaces(sql!, 10)).toContain(WS);
    await sql!`delete from machines where id = ${lap!['id']}::uuid`;
  });

  it('at zero balance the bump refuses, and the pass says so', async () => {
    await clearRoutines(); await park();
    await routine(5);
    await sql!`update workspace_credits set spent_micros = granted_micros, purchased_spent_micros = purchased_micros where workspace_id = ${WS}::uuid`;
    const out = await wakeForDueRoutines(sql!, bump, 10);
    expect(out.considered).toContain(WS);
    expect(out.capped).toContain(WS);
    expect(out.woken).not.toContain(WS);
    expect((await runner())['desired_replicas']).toBe(0);
    // funded again: the next pass wakes it
    await grantCredits(sql!, WS, 100, 'purchase', 'routines-wake top-up');
    const again = await wakeForDueRoutines(sql!, bump, 10);
    expect(again.woken).toContain(WS);
  });

  it('the cron lane is secret-gated and reports the pass', async () => {
    await clearRoutines(); await park();
    await routine(5);
    expect((await app!.request('/internal/routines-due')).status).toBe(403);
    expect((await app!.request('/internal/routines-due', { headers: { authorization: 'Bearer wrong' } })).status).toBe(403);
    const res = await app!.request('/internal/routines-due', { headers: { authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    const body = await j(res);
    expect(body.woken).toContain(WS);
    expect((await runner())['desired_replicas']).toBe(1);
  });
});
