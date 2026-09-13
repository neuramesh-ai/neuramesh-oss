// The credits mechanics against the REAL schema (migration 0130). Every test here is a money
// path: pool ordering, refill semantics, purchase idempotency, the never-refusing activity
// charge, park-at-zero, and the credits-gated wake. The mocked-Store unit tests exercise none
// of this SQL. Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { chargeMachineActivity, creditBalance, grantCredits, spendCredits, workspacesDueRefill } from '../src/credits';
import { bumpMachineWake, machineSweep, wakeMachines } from '../src/fleet-lifecycle';
import { creditsToMicros } from '@neuramesh/shared';

const DB = process.env['DATABASE_URL'];
const sql = DB ? postgres(DB) : null;
const WS = '00000000-0000-4000-8000-00000000cc01';
const OWNER = '00000000-0000-0000-0000-000000000001';

async function seedWorkspace(plan = 'free', seats = 1): Promise<void> {
  await sql!`insert into workspaces (id, name, slug, plan, seats, created_by)
    values (${WS}::uuid, 'credits-t', 't-cc01', ${plan}, ${seats}, ${OWNER}::uuid)
    on conflict (id) do update set plan = excluded.plan, seats = excluded.seats`;
}
async function seedMachine(agoMin: number): Promise<string> {
  const [m] = await sql!`insert into machines (workspace_id, owner_user_id, name, kind, desired_replicas, last_wake_at, idle_stop_min)
    values (${WS}::uuid, ${OWNER}::uuid, 'm-cc01', 'runner', 1, now() - make_interval(mins => ${agoMin}::int), 30)
    returning id`;
  return String(m!['id']);
}
async function wipe(): Promise<void> {
  if (!sql) return;
  await sql`delete from machines where workspace_id = ${WS}::uuid`;
  await sql`delete from machine_usage where workspace_id = ${WS}::uuid`;
  await sql`delete from credit_grants where workspace_id = ${WS}::uuid`;
  await sql`delete from workspace_credits where workspace_id = ${WS}::uuid`;
  await sql`delete from workspaces where id = ${WS}::uuid`;
}
beforeEach(wipe);
afterAll(async () => { await wipe(); await sql?.end(); });

describe.skipIf(!DB)('credit pools (real schema)', () => {
  it('a purchase lands in its own pool, and the monthly reset does not touch it', async () => {
    await seedWorkspace();
    await grantCredits(sql!, WS, 500, 'monthly', 'seed');
    await grantCredits(sql!, WS, 1000, 'purchase', 'cs_test_1');
    await spendCredits(sql!, WS, creditsToMicros(600), { inTokens: 1, outTokens: 1 });
    // 500 grant burned + 100 from purchases
    let bal = await creditBalance(sql!, WS);
    expect(bal.grantRemainingMicros).toBe(0);
    expect(bal.purchasedRemainingMicros).toBe(creditsToMicros(900));
    // the reset: grant pool back to 500, purchases untouched
    await grantCredits(sql!, WS, 500, 'monthly', 'refill');
    bal = await creditBalance(sql!, WS);
    expect(bal.grantRemainingMicros).toBe(creditsToMicros(500));
    expect(bal.purchasedRemainingMicros).toBe(creditsToMicros(900));
  });

  it('the grant pool drains FIRST — buying early never wastes a credit', async () => {
    await seedWorkspace();
    await grantCredits(sql!, WS, 100, 'monthly', 'seed');
    await grantCredits(sql!, WS, 100, 'purchase', 'cs_test_2');
    await spendCredits(sql!, WS, creditsToMicros(50), { inTokens: 1, outTokens: 1 });
    const bal = await creditBalance(sql!, WS);
    expect(bal.grantRemainingMicros).toBe(creditsToMicros(50));
    expect(bal.purchasedRemainingMicros).toBe(creditsToMicros(100));
  });

  it('a replayed purchase webhook grants once — idempotent by session id', async () => {
    await seedWorkspace();
    await grantCredits(sql!, WS, 500, 'purchase', 'cs_test_replay');
    await grantCredits(sql!, WS, 500, 'purchase', 'cs_test_replay');
    const bal = await creditBalance(sql!, WS);
    expect(bal.purchasedRemainingMicros).toBe(creditsToMicros(500));
  });

  // the plan flip's seat grant rides 'promo' keyed by the subscription id (plan-flip.ts), and
  // Stripe redelivers — so a promo WITH a note is idempotent too, in the grant pool
  it('a replayed promo grants once — idempotent by note, in the grant pool', async () => {
    await seedWorkspace('cloud', 2);
    const first = await grantCredits(sql!, WS, 3000, 'promo', 'sub_replay');
    const again = await grantCredits(sql!, WS, 3000, 'promo', 'sub_replay');
    expect(again.grantedMicros).toBe(first.grantedMicros);
    const bal = await creditBalance(sql!, WS);
    expect(bal.grantRemainingMicros).toBe(creditsToMicros(3000));
    expect(bal.purchasedRemainingMicros).toBe(0);
    const [n] = await sql!`select count(*)::int as n from credit_grants where workspace_id = ${WS}::uuid and kind = 'promo'`;
    expect(Number(n!['n'])).toBe(1);
    // a promo without a note keeps its at-most-once delivery: two grants, two rows
    await grantCredits(sql!, WS, 10, 'promo');
    await grantCredits(sql!, WS, 10, 'promo');
    expect((await creditBalance(sql!, WS)).grantRemainingMicros).toBe(creditsToMicros(3020));
  });

  it('spendCredits refuses past the combined balance', async () => {
    await seedWorkspace();
    await grantCredits(sql!, WS, 10, 'monthly', 'seed');
    const out = await spendCredits(sql!, WS, creditsToMicros(11), { inTokens: 1, outTokens: 1 });
    expect(out).toBeNull();
  });

  it('chargeMachineActivity never refuses: the work happened — pools clamp, telemetry stays true', async () => {
    await seedWorkspace();
    await grantCredits(sql!, WS, 1, 'monthly', 'seed'); // 10,000 µUSD
    // 20 active minutes = 20,000 µUSD against a 10,000 balance
    await chargeMachineActivity(sql!, WS, 20_000, 1200);
    const bal = await creditBalance(sql!, WS);
    expect(bal.remainingMicros).toBe(0);
    const [u] = await sql!`select active_seconds, machine_micros from machine_usage
      where workspace_id = ${WS}::uuid and day = (now() at time zone 'utc')::date`;
    expect(Number(u!['active_seconds'])).toBe(1200);      // the TRUE seconds
    expect(Number(u!['machine_micros'])).toBe(10_000);    // the µUSD actually collected
  });

  it('the sweep parks a zero-balance machine, but only after the run-drain grace', async () => {
    await seedWorkspace();
    await grantCredits(sql!, WS, 1, 'monthly', 'seed');
    await chargeMachineActivity(sql!, WS, 20_000, 1200); // now at zero
    const id = await seedMachine(5);
    // still working two minutes ago: NOT parked — nothing is killed mid-run
    await sql!`update machines set last_active_at = now() - interval '2 minutes' where id = ${id}`;
    let out = await machineSweep(sql!, 5);
    expect(out.capStopped).not.toContain(id);
    // quiet for 15 minutes: parked
    await sql!`update machines set last_active_at = now() - interval '15 minutes' where id = ${id}`;
    out = await machineSweep(sql!, 5);
    expect(out.capStopped).toContain(id);
  });

  it('wake refuses at zero credits and wakes with any balance — the minute cap is gone', async () => {
    await seedWorkspace();
    await seedMachine(10);
    await sql!`update machines set desired_replicas = 0 where workspace_id = ${WS}::uuid`;
    expect((await wakeMachines(sql!, WS)).capped).toBe(true);
    await grantCredits(sql!, WS, 5, 'purchase', 'cs_test_wake');
    const woke = await wakeMachines(sql!, WS);
    expect(woke.capped).toBe(false);
    expect(woke.woken).toBe(1);
  });

  it('the message-path bump also gates on credits, not minutes', async () => {
    await seedWorkspace();
    await seedMachine(10);
    await sql!`update machines set desired_replicas = 0 where workspace_id = ${WS}::uuid`;
    await bumpMachineWake(sql!, WS); // no credits row at all → stays down
    let [m] = await sql!`select desired_replicas from machines where workspace_id = ${WS}::uuid`;
    expect(Number(m!['desired_replicas'])).toBe(0);
    await grantCredits(sql!, WS, 5, 'monthly', 'seed');
    await bumpMachineWake(sql!, WS);
    [m] = await sql!`select desired_replicas from machines where workspace_id = ${WS}::uuid`;
    expect(Number(m!['desired_replicas'])).toBe(1);
  });

  it('the refill worklist carries plan and seats, so cloud refills at 1,500 × seats', async () => {
    await seedWorkspace('cloud', 3);
    await grantCredits(sql!, WS, 500, 'monthly', 'seed');
    await sql!`update workspace_credits set period_start = (date_trunc('month', now() at time zone 'utc') - interval '1 month')::date
      where workspace_id = ${WS}::uuid`;
    const due = await workspacesDueRefill(sql!);
    const mine = due.find((d) => d.workspaceId === WS);
    expect(mine).toEqual({ workspaceId: WS, plan: 'cloud', seats: 3 });
  });

  // source release (2026-09-12): nothing refills on Free. The filter is in the worklist SQL, so a
  // free row with a rolled-over period never reaches the grant loop at all.
  it('the refill worklist skips free rows, however overdue', async () => {
    await seedWorkspace('free', 1);
    await grantCredits(sql!, WS, 500, 'monthly', 'seed');
    await sql!`update workspace_credits set period_start = (date_trunc('month', now() at time zone 'utc') - interval '3 month')::date
      where workspace_id = ${WS}::uuid`;
    expect((await workspacesDueRefill(sql!)).find((d) => d.workspaceId === WS)).toBeUndefined();
    // the same row on Pro is due
    await sql!`update workspaces set plan = 'cloud' where id = ${WS}::uuid`;
    expect((await workspacesDueRefill(sql!)).find((d) => d.workspaceId === WS)).toEqual({ workspaceId: WS, plan: 'cloud', seats: 1 });
  });
});
