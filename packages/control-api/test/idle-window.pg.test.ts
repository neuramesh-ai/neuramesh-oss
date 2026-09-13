// The plan's idle window, against the REAL schema. This SQL is the whole feature — a `case` on
// w.plan inside make_interval — and the mocked-Store unit tests never execute a query, so without
// this file the rule is only asserted by reading it.
//
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { machineSweep, idleStopMin, machineIntent } from '../src/fleet-lifecycle';

const DB = process.env['DATABASE_URL'];
const sql = DB ? postgres(DB) : null;
const WS_FREE = '00000000-0000-4000-8000-00000000ff01';
const WS_CLOUD = '00000000-0000-4000-8000-00000000ff02';
// the fixtures' human — workspaces.created_by is NOT NULL
const OWNER = '00000000-0000-0000-0000-000000000001';

/** a workspace + one machine that last woke `agoMin` ago */
async function seed(wsId: string, plan: string, agoMin: number, idleStopMin: number | null): Promise<string> {
  await sql!`insert into workspaces (id, name, slug, plan, created_by)
    values (${wsId}::uuid, ${'t-' + plan}, ${'t-' + wsId.slice(-4)}, ${plan}, ${OWNER}::uuid)
    on conflict (id) do update set plan = excluded.plan`;
  const [m] = await sql!`insert into machines
      (workspace_id, owner_user_id, name, kind, desired_replicas, last_wake_at, idle_stop_min)
    values (${wsId}::uuid, ${OWNER}::uuid, ${'m-' + wsId.slice(-4)}, 'runner', 1,
            now() - make_interval(mins => ${agoMin}::int), ${idleStopMin})
    on conflict do nothing returning id`;
  if (m) return String(m['id']);
  const [e] = await sql!`select id from machines where workspace_id = ${wsId}::uuid limit 1`;
  await sql!`update machines set desired_replicas = 1, idle_stop_min = ${idleStopMin},
    last_wake_at = now() - make_interval(mins => ${agoMin}::int) where id = ${e!['id']}`;
  return String(e!['id']);
}

const cleanup = async (): Promise<void> => {
  if (!sql) return;
  await sql`delete from machines where workspace_id in (${WS_FREE}::uuid, ${WS_CLOUD}::uuid)`;
  await sql`delete from machine_usage where workspace_id in (${WS_FREE}::uuid, ${WS_CLOUD}::uuid)`;
  await sql`delete from workspaces where id in (${WS_FREE}::uuid, ${WS_CLOUD}::uuid)`;
};

afterAll(async () => { await cleanup(); await sql?.end(); });

describe.skipIf(!DB)('the idle window is 48h, every plan (credits era)', () => {
  it('leaves a FREE machine idle 45 minutes running — the old 30-minute stop is gone', async () => {
    await cleanup();
    const id = await seed(WS_FREE, 'free', 45, 30);
    const out = await machineSweep(sql!, 5);
    expect(out.idleStopped).not.toContain(id);
  });

  it('leaves a CLOUD machine idle 13 hours running — the 12-hour window is superseded', async () => {
    await cleanup();
    const id = await seed(WS_CLOUD, 'cloud', 13 * 60, 30);
    const out = await machineSweep(sql!, 5);
    expect(out.idleStopped).not.toContain(id);
  });

  it('stops EITHER plan past 48 idle hours', async () => {
    await cleanup();
    const free = await seed(WS_FREE, 'free', idleStopMin() + 60, 30);
    const cloud = await seed(WS_CLOUD, 'cloud', idleStopMin() + 60, 30);
    const out = await machineSweep(sql!, 5);
    expect(out.idleStopped).toContain(free);
    expect(out.idleStopped).toContain(cloud);
  });

  it('recent WORK defends a machine even with ancient messages (the task_b4c522e3 hole)', async () => {
    await cleanup();
    const id = await seed(WS_FREE, 'free', idleStopMin() + 60, 30);
    await sql!`update machines set last_active_at = now() - interval '1 hour' where id = ${id}`;
    const out = await machineSweep(sql!, 5);
    expect(out.idleStopped).not.toContain(id);
  });

  it('NULL still means never auto-stop, on either plan', async () => {
    // the escape hatch a dedicated always-on machine will use — it must outrank the plan rule
    await cleanup();
    const free = await seed(WS_FREE, 'free', 60 * 24 * 7, null);
    const cloud = await seed(WS_CLOUD, 'cloud', 60 * 24 * 7, null);
    const out = await machineSweep(sql!, 5);
    expect(out.idleStopped).not.toContain(free);
    expect(out.idleStopped).not.toContain(cloud);
  });

  it('machineIntent reports the EFFECTIVE window, so no surface re-derives the rule', async () => {
    await cleanup();
    await seed(WS_CLOUD, 'cloud', 5, 30);
    const [m] = await machineIntent(sql!, WS_CLOUD);
    expect(m?.idleStopMin).toBe(idleStopMin());
  });
});
