// ALWAYS ON IS BILLED AS ACTIVE (machine-beat.ts, 0176), against the REAL schema. Every check here is
// a money path: an Always on machine pays for its idle awake seconds at the active price, a normal one
// does not, nothing is charged twice, a machine that is down pays nothing, the cap still parks it, and
// switching off ends the idle charge. Run via scripts/test-pg.sh. Skipped without DATABASE_URL.
import { priceActiveSeconds } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { chargeMachineActivity, creditBalance, grantCredits } from '../src/credit-ledger';
import { machineSweep } from '../src/fleet-lifecycle';
import { setAlwaysOn } from '../src/machine-always-on';
import { ALWAYS_ON_MAX_WINDOW_S } from '../src/machine-beat';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const sql = DB ? postgres(DB) : null;
const store = DB ? new PostgresStore(DB) : null;
const WS = '00000000-0000-4000-8000-0000000b1101';
// the fixtures' human: the workspace's creator, and the owner every machine here beats as
const OWNER = '00000000-0000-0000-0000-000000000001';
const BEAT_S = 30;

let M = '';

async function wipe(): Promise<void> {
  if (!sql) return;
  await sql`delete from machines where workspace_id = ${WS}::uuid`;
  await sql`delete from machine_usage where workspace_id = ${WS}::uuid`;
  await sql`delete from credit_grants where workspace_id = ${WS}::uuid`;
  await sql`delete from workspace_credits where workspace_id = ${WS}::uuid`;
}

beforeEach(async () => {
  if (!sql) return;
  await wipe();
  await sql`insert into workspaces (id, name, slug, plan, created_by)
    values (${WS}::uuid, 'always-on billing', 't-aob1', 'cloud', ${OWNER}::uuid) on conflict (id) do nothing`;
  await grantCredits(sql, WS, 1000, 'purchase', `cs_aob_${Date.now()}`);
  // an awake Cloud Run runner that started an hour ago, Always on (idle_stop_min NULL)
  const [m] = await sql`insert into machines (workspace_id, owner_user_id, name, kind, substrate, desired_replicas, started_at, last_wake_at, idle_stop_min)
    values (${WS}::uuid, ${OWNER}::uuid, 'aob-runner', 'runner', 'cloudrun', 1, now() - interval '1 hour', now() - interval '1 hour', null)
    returning id`;
  M = String(m!['id']);
});

afterAll(async () => {
  await wipe();
  if (sql) {
    await sql.begin(async (tx) => {
      await tx`select set_config('nm.allow_event_purge', 'on', true)`;
      await tx`delete from workspaces where id = ${WS}::uuid`;
    });
  }
  await sql?.end();
  await store?.close();
});

/** what the machine meter took since the test began */
const spent = async (): Promise<number> => creditsPurchased() - (await creditBalance(sql!, WS)).remainingMicros;
// the purchase above: 1,000 credits, the whole balance
const creditsPurchased = (): number => 1000 * 10_000;
const usage = async () => {
  const [u] = await sql!<{ active_seconds: number; always_on_seconds: number; machine_micros: string }[]>`
    select active_seconds, always_on_seconds, machine_micros from machine_usage
     where workspace_id = ${WS}::uuid and day = (now() at time zone 'utc')::date`;
  return { active: Number(u?.active_seconds ?? 0), alwaysOn: Number(u?.always_on_seconds ?? 0), micros: Number(u?.machine_micros ?? 0) };
};

/** one machined beat, `ago` seconds after the last metered one */
async function beat(activeSeconds = 0, ago = BEAT_S): Promise<void> {
  await sql!`update machines set billed_through = now() - make_interval(secs => ${ago}::int) where id = ${M}::uuid`;
  expect(await store!.heartbeatMachine(M, OWNER, { activeSeconds, busy: activeSeconds > 0 })).toBe(true);
}

describe.skipIf(!DB)('Always on is billed as active (0176)', () => {
  it('an Always on machine idle for 5 minutes is charged 5 minutes at the active price', async () => {
    for (let i = 0; i < 10; i++) await beat(0);
    expect(await spent()).toBe(priceActiveSeconds(300));
    expect(await usage()).toEqual({ active: 0, alwaysOn: 300, micros: priceActiveSeconds(300) });
  });

  it('a normal machine idle for 5 minutes is charged nothing', async () => {
    await sql!`update machines set idle_stop_min = 30 where id = ${M}::uuid`;
    for (let i = 0; i < 10; i++) await beat(0);
    expect(await spent()).toBe(0);
    // and its active seconds still bill as before
    await beat(12);
    expect(await spent()).toBe(priceActiveSeconds(12));
    expect((await usage()).alwaysOn).toBe(0);
  });

  it('no double charge: active seconds inside the window are charged once', async () => {
    await beat(20); // 20 s of work in a 30 s window: 30 s billed, not 50
    expect(await spent()).toBe(priceActiveSeconds(30));
    await beat(30); // a busy beat: the window, once
    expect(await spent()).toBe(priceActiveSeconds(60));
    expect(await usage()).toEqual({ active: 50, alwaysOn: 10, micros: priceActiveSeconds(60) });
  });

  it('a machine that is down is not charged: no beat, no charge, and a beat after a gap bills at most the cap', async () => {
    // ten minutes with no beat (down): the sweep never charges Always on time
    await sql!`update machines set billed_through = now() - interval '10 minutes' where id = ${M}::uuid`;
    await machineSweep(sql!, 5, null);
    expect(await spent()).toBe(0);
    // it comes back: the first beat bills at most ALWAYS_ON_MAX_WINDOW_S, never the gap
    expect(await store!.heartbeatMachine(M, OWNER, { activeSeconds: 0, busy: false })).toBe(true);
    expect(await spent()).toBe(priceActiveSeconds(ALWAYS_ON_MAX_WINDOW_S));
  });

  it('a parked machine (desired 0) is not charged for idle time, and a run is billed only from its start', async () => {
    await sql!`update machines set desired_replicas = 0, started_at = null where id = ${M}::uuid`;
    await beat(0); // a beat from an instance that is shutting down
    expect(await spent()).toBe(0);
    // woken 10 s ago, last metered beat 30 s ago (before the start): 10 s billed
    await sql!`update machines set desired_replicas = 1, started_at = now() - interval '10 seconds' where id = ${M}::uuid`;
    await beat(0);
    expect(await spent()).toBe(priceActiveSeconds(10));
  });

  it('the cap still parks an Always on machine at zero: the charge clamps, and the sweep drains it', async () => {
    // spend all but 100 µUSD, then an idle beat costs 500: the pools clamp at zero, never below
    await chargeMachineActivity(sql!, WS, creditsPurchased() - 100, 0);
    await sql!`update machines set last_active_at = now() - interval '15 minutes' where id = ${M}::uuid`;
    await beat(0);
    expect((await creditBalance(sql!, WS)).remainingMicros).toBe(0);
    expect((await usage()).micros).toBe(creditsPurchased()); // what was collected, not what was asked
    const saved = process.env['FLEET_CLOUDRUN'];
    process.env['FLEET_CLOUDRUN'] = '1';
    try {
      const out = await machineSweep(sql!, 5, null);
      expect(out.cloudrun?.capDrains).toContain(M);
    } finally {
      if (saved === undefined) delete process.env['FLEET_CLOUDRUN']; else process.env['FLEET_CLOUDRUN'] = saved;
    }
  });

  it('switching off stops the idle charge, and switching on starts the window at the switch', async () => {
    const actor = { kind: 'human' as const, id: OWNER };
    await beat(0);
    expect(await spent()).toBe(priceActiveSeconds(BEAT_S));
    await setAlwaysOn(sql!, M, false, actor);
    for (let i = 0; i < 4; i++) await beat(0);
    expect(await spent()).toBe(priceActiveSeconds(BEAT_S)); // nothing more while off
    // on again, 5 minutes after the last beat: the first beat bills from the switch, not from the old beat
    await sql!`update machines set billed_through = now() - interval '5 minutes' where id = ${M}::uuid`;
    await setAlwaysOn(sql!, M, true, actor);
    expect(await store!.heartbeatMachine(M, OWNER, { activeSeconds: 0, busy: false })).toBe(true);
    expect(await spent()).toBe(priceActiveSeconds(BEAT_S));
  });

  it('a beat the actor may not send charges nothing', async () => {
    const stranger = 'c0000000-0000-4000-8000-0000000b11ff';
    await sql!`update machines set billed_through = now() - interval '30 seconds' where id = ${M}::uuid`;
    expect(await store!.heartbeatMachine(M, stranger, { activeSeconds: 0, busy: false })).toBe(false);
    expect(await spent()).toBe(0);
  });
});
