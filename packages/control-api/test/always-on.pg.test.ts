// The Always on switch (machine-always-on.ts) against the REAL schema: the role rule over real
// membership rows, the column write both ways, the event, and the two stops it must never override,
// the credit cap and the crash-loop breaker. Run via scripts/test-pg.sh. Skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { bumpMachineWake, idleStopMin, machineIntent, machineSweep } from '../src/fleet-lifecycle';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = '00000000-0000-4000-8000-0000000a0a01';
const OTHER_WS = '00000000-0000-4000-8000-0000000a0a02';
// the fixtures' human: the workspace's creator and owner here
const OWNER = '00000000-0000-0000-0000-000000000001';
const ADMIN = 'c0000000-0000-4000-8000-0000000a0a11';
const MEMBER = 'c0000000-0000-4000-8000-0000000a0a12';
const human = (id: string): Actor => ({ kind: 'human', id });

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;

function flip(actor: Actor, machineId: string, on: boolean, workspace = WS) {
  return app!.request('/v1/machines/always-on', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify({ workspace, machineId, on }),
  });
}

let RUNNER = '';
let MEMBER_M = '';
let LOCAL = '';

async function machine(name: string, kind: string, owner: string, substrate = 'volume'): Promise<string> {
  const [m] = await sql!`insert into machines (workspace_id, owner_user_id, name, kind, substrate, desired_replicas, last_wake_at)
    values (${WS}::uuid, ${owner}::uuid, ${name}, ${kind}, ${substrate}, ${kind === 'local' ? 0 : 1}, now())
    returning id`;
  return String(m!['id']);
}

async function wipe(): Promise<void> {
  if (!sql) return;
  await sql`delete from machines where workspace_id in (${WS}::uuid, ${OTHER_WS}::uuid)`;
  await sql`delete from machine_usage where workspace_id = ${WS}::uuid`;
  await sql`delete from workspace_credits where workspace_id = ${WS}::uuid`;
}

beforeAll(async () => {
  if (!sql) return;
  for (const [id, slug] of [[WS, 't-ao01'], [OTHER_WS, 't-ao02']] as const) {
    await sql`insert into workspaces (id, name, slug, plan, created_by)
      values (${id}::uuid, ${'always-on ' + slug}, ${slug}, 'cloud', ${OWNER}::uuid) on conflict (id) do nothing`;
  }
  for (const [id, name] of [[ADMIN, 'ao-admin'], [MEMBER, 'ao-member']] as const) {
    await sql`insert into nm_users (id, clerk_user_id, email) values (${id}::uuid, ${id}, ${`${name}@always-on.test`}) on conflict (id) do nothing`;
  }
  for (const [id, role] of [[OWNER, 'owner'], [ADMIN, 'admin'], [MEMBER, 'member']] as const) {
    await sql`insert into workspace_members (workspace_id, user_id, role, display_name)
      values (${WS}::uuid, ${id}::uuid, ${role}, ${role}) on conflict (workspace_id, user_id) do update set role = excluded.role`;
  }
});

beforeEach(async () => {
  if (!sql) return;
  await wipe();
  RUNNER = await machine('ao-runner', 'runner', OWNER, 'cloudrun');
  MEMBER_M = await machine('ao-member-m', 'member', MEMBER, 'cloudrun');
  LOCAL = await machine('ao-laptop', 'local', OWNER);
});

afterAll(async () => {
  await wipe();
  if (sql) {
    // the switch wrote events, and events are append-only: the cascade needs the sanctioned purge
    // path (0018), the same transaction-local setting the store's workspace delete uses
    await sql.begin(async (tx) => {
      await tx`select set_config('nm.allow_event_purge', 'on', true)`;
      await tx`delete from workspaces where id in (${WS}::uuid, ${OTHER_WS}::uuid)`;
    });
  }
  await sql?.end();
  await store?.close();
});

const stored = async (id: string): Promise<number | null> => {
  const [r] = await sql!<{ idle_stop_min: number | null }[]>`select idle_stop_min from machines where id = ${id}::uuid`;
  return r!.idle_stop_min;
};
const events = async (id: string) =>
  sql!<{ type: string; source: string; payload: { on: boolean; kind: string } }[]>`
    select type, source, payload from events where workspace_id = ${WS}::uuid and target = ${`machine:${id}`} order by ts, id`;

describe.skipIf(!DB)('Always on: who may switch it', () => {
  it('the owner of a member machine switches their own, and nobody else switches it', async () => {
    expect((await flip(human(MEMBER), MEMBER_M, true)).status).toBe(200);
    // a workspace owner or admin does not switch somebody else's member machine
    expect((await flip(human(OWNER), MEMBER_M, false)).status).toBe(403);
    expect((await flip(human(ADMIN), MEMBER_M, false)).status).toBe(403);
    expect(await stored(MEMBER_M)).toBeNull();
  });

  it('the runner: a workspace owner or admin, never a plain member', async () => {
    const res = await flip(human(MEMBER), RUNNER, true);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_PERMITTED');
    expect(await stored(RUNNER)).toBe(30);
    expect((await flip(human(ADMIN), RUNNER, true)).status).toBe(200);
    expect((await flip(human(OWNER), RUNNER, false)).status).toBe(200);
  });

  it('refuses a local machine out loud, and leaves its row alone', async () => {
    const res = await flip(human(OWNER), LOCAL, true);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('LOCAL_MACHINE');
    expect(await stored(LOCAL)).toBe(30);
  });

  it('a non-member is refused, and a machine from another workspace is not found', async () => {
    const stranger = 'c0000000-0000-4000-8000-0000000a0aff';
    expect((await flip(human(stranger), RUNNER, true)).status).toBe(403);
    expect((await flip(human(OWNER), RUNNER, true, OTHER_WS)).status).toBe(403);
    await sql!`insert into workspace_members (workspace_id, user_id, role) values (${OTHER_WS}::uuid, ${OWNER}::uuid, 'owner') on conflict do nothing`;
    expect((await flip(human(OWNER), RUNNER, true, OTHER_WS)).status).toBe(404);
  });
});

describe.skipIf(!DB)('Always on: the write', () => {
  it('on stores NULL, off restores the column default, and machineIntent reports both', async () => {
    const on = await flip(human(OWNER), RUNNER, true);
    expect(await on.json()).toMatchObject({ ok: true, machineId: RUNNER, alwaysOn: true, changed: true, idleStopMin: null });
    expect(await stored(RUNNER)).toBeNull();
    expect((await machineIntent(sql!, WS)).find((m) => m.id === RUNNER)?.idleStopMin).toBeNull();

    const off = await flip(human(OWNER), RUNNER, false);
    expect(await off.json()).toMatchObject({ ok: true, alwaysOn: false, changed: true, idleStopMin: idleStopMin() });
    expect(await stored(RUNNER)).toBe(30);
    expect((await machineIntent(sql!, WS)).find((m) => m.id === RUNNER)?.idleStopMin).toBe(idleStopMin());
  });

  it('is idempotent: a repeat changes nothing and records nothing', async () => {
    await flip(human(MEMBER), MEMBER_M, true);
    const again = await flip(human(MEMBER), MEMBER_M, true);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ alwaysOn: true, changed: false });
    const offTwice = [await flip(human(MEMBER), MEMBER_M, false), await flip(human(MEMBER), MEMBER_M, false)];
    expect(await offTwice[1]!.json()).toMatchObject({ alwaysOn: false, changed: false });
    const evs = await events(MEMBER_M);
    expect(evs.map((e) => [e.type, e.payload.on])).toEqual([['machine.always_on_set', true], ['machine.always_on_set', false]]);
    expect(evs[0]!.source).toBe(`human:${MEMBER}`);
    expect(evs[0]!.payload.kind).toBe('member');
  });

  it('an Always on machine idle past the window is not idle-stopped, and off makes it stop again', async () => {
    await flip(human(OWNER), RUNNER, true);
    await sql!`update machines set last_wake_at = now() - make_interval(mins => ${idleStopMin() + 60}::int) where id = ${RUNNER}::uuid`;
    // a funded workspace, so only the idle rule could stop it
    await sql!`insert into workspace_credits (workspace_id, granted_micros) values (${WS}::uuid, 1000000000)`;
    const saved = process.env['FLEET_CLOUDRUN'];
    process.env['FLEET_CLOUDRUN'] = '1';
    try {
      let out = await machineSweep(sql!, 5, null);
      expect(out.cloudrun?.idleDrains).not.toContain(RUNNER);
      await flip(human(OWNER), RUNNER, false);
      out = await machineSweep(sql!, 5, null);
      expect(out.cloudrun?.idleDrains).toContain(RUNNER);
    } finally {
      if (saved === undefined) delete process.env['FLEET_CLOUDRUN']; else process.env['FLEET_CLOUDRUN'] = saved;
    }
  });
});

describe.skipIf(!DB)('Always on never overrides the cap or the breaker', () => {
  it('the credit cap still stops an Always on machine at a zero balance: kube and Cloud Run', async () => {
    await flip(human(OWNER), RUNNER, true);
    await flip(human(MEMBER), MEMBER_M, true);
    // the member machine on the kube path, the runner on Cloud Run
    await sql!`update machines set substrate = 'volume' where id = ${MEMBER_M}::uuid`;
    await sql!`insert into workspace_credits (workspace_id, granted_micros, spent_micros) values (${WS}::uuid, 0, 0)`;
    await sql!`update machines set last_active_at = now() - interval '15 minutes' where workspace_id = ${WS}::uuid`;
    const saved = process.env['FLEET_CLOUDRUN'];
    process.env['FLEET_CLOUDRUN'] = '1';
    try {
      const out = await machineSweep(sql!, 5, null);
      expect(out.capStopped).toContain(MEMBER_M);
      expect(out.cloudrun?.capDrains).toContain(RUNNER);
    } finally {
      if (saved === undefined) delete process.env['FLEET_CLOUDRUN']; else process.env['FLEET_CLOUDRUN'] = saved;
    }
    expect(await stored(RUNNER)).toBeNull(); // the choice survives the park, for the next funded wake
  });

  it('switching it on does not wake a machine, and an agent message does not wake a tripped breaker', async () => {
    await sql!`insert into workspace_credits (workspace_id, granted_micros) values (${WS}::uuid, 1000000000)`;
    await sql!`update machines set desired_replicas = 0, boot_loop_at = now() where id = ${RUNNER}::uuid`;
    expect((await flip(human(OWNER), RUNNER, true)).status).toBe(200);
    await bumpMachineWake(sql!, WS, null);
    const [r] = await sql!<{ desired_replicas: number; boot_loop_at: string | null }[]>`
      select desired_replicas, boot_loop_at from machines where id = ${RUNNER}::uuid`;
    expect(r!.desired_replicas).toBe(0);
    expect(r!.boot_loop_at).not.toBeNull();
  });
});
