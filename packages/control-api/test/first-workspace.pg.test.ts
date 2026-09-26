// The first hosted sign-in creates the workspace, against the REAL schema (source release
// 2026-09, unit U1b): onAuthArrival makes one through workspace.create, a second arrival makes
// nothing, and GET /v1/workspaces lists it with role and plan. Run via scripts/test-pg.sh —
// skipped without DATABASE_URL.
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { onAuthArrival } from '../src/onauth';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

afterAll(async () => { await sql?.end(); await store?.close(); });

describe.skipIf(!DB)('the first sign-in gives the workspace its cloud machine (postgres)', () => {
  // cloud is Pro, and it starts with a machine that bills from its 500 credits (George 2026-09-25).
  // The pg lane runs with FLEET_AUTOPROVISION=off, so this test turns the fleet on for itself.
  it('mints one runner, born awake, for the owner; a second arrival mints none', async () => {
    const prev = process.env['FLEET_AUTOPROVISION'];
    process.env['FLEET_AUTOPROVISION'] = 'on';
    try {
      const tag = Date.now().toString(36);
      const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${`clerk_machine_${tag}`}, ${`machine-${tag}@sign.test`}) returning id`;
      const userId = row!['id'] as string;
      const arrival = { userId, email: `machine-${tag}@sign.test`, emailVerified: true, isNew: true, firstName: `Kim${tag}` };
      await onAuthArrival(store!, arrival);
      await onAuthArrival(store!, { ...arrival, isNew: false });
      const [ws] = await sql!`select w.id from workspaces w join workspace_members m on m.workspace_id = w.id where m.user_id = ${userId}::uuid`;
      const machines = await sql!`select kind, owner_user_id, desired_replicas, last_wake_at, lifecycle from machines where workspace_id = ${ws!['id']}::uuid`;
      expect(machines).toHaveLength(1);
      expect(machines[0]).toMatchObject({ kind: 'runner', owner_user_id: userId, desired_replicas: 1, lifecycle: 'provisioning' });
      // born awake is a wake (#597): the first sweep must not park it
      expect(machines[0]!['last_wake_at']).not.toBeNull();
      // and the 500 credits it bills from are there
      const [credits] = await sql!`select granted_micros from workspace_credits where workspace_id = ${ws!['id']}::uuid`;
      expect(Number(credits!['granted_micros'])).toBeGreaterThan(0);
    } finally {
      if (prev === undefined) delete process.env['FLEET_AUTOPROVISION']; else process.env['FLEET_AUTOPROVISION'] = prev;
    }
  });
});

describe.skipIf(!DB)('the first sign-in creates the workspace (postgres)', () => {
  it('creates once, and the list carries role and plan', async () => {
    const tag = Date.now().toString(36);
    const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${`clerk_u1b_first_${tag}`}, ${`first-${tag}@sign.test`}) returning id`;
    const userId = row!['id'] as string;
    const arrival = { userId, email: `first-${tag}@sign.test`, emailVerified: true, isNew: true, firstName: `Dana${tag}` };
    await onAuthArrival(store!, arrival);
    await onAuthArrival(store!, { ...arrival, isNew: false });

    const res = await app!.request('/v1/workspaces', { headers: { 'x-nm-actor': JSON.stringify({ kind: 'human', id: userId }) } });
    expect(res.status).toBe(200);
    const { workspaces } = await j(res);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({ name: `Dana${tag}'s workspace`, slug: `dana${tag}`, role: 'owner', plan: 'free' });
    // the owner membership, the default project and the starter rooms came from the normal path
    const [members] = await sql!`select count(*)::int as c from workspace_members where workspace_id = ${workspaces[0].id}::uuid`;
    expect(Number(members!['c'])).toBe(1);
    const [rooms] = await sql!`select count(*)::int as c from channels where workspace_id = ${workspaces[0].id}::uuid`;
    expect(Number(rooms!['c'])).toBeGreaterThan(0);
    // the first workspace starts with 500 credits, once (the first-run doors, 2026-09-19): the
    // second arrival made no workspace, so it granted nothing either
    const [grants] = await sql!`select count(*)::int as c, coalesce(sum(micros), 0)::bigint as micros from credit_grants where workspace_id = ${workspaces[0].id}::uuid and kind = 'signup'`;
    expect(Number(grants!['c'])).toBe(1);
    expect(Number(grants!['micros'])).toBe(500 * 10_000);
  });
});
