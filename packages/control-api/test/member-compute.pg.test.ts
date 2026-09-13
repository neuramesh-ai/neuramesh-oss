// Compute choice (0118) against the REAL schema: `workspace_members.compute` is the member's own
// routing — HUMAN_ONLY, self-only by construction (the handler writes the actor's row), and every
// named id validated against the workspace so a bad pref 404s at SET time instead of silently
// mis-routing at claim time. Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };
const THIRD = 'c0000000-0000-0000-0000-0000000000c3';

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;

function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

// This suite creates its OWN machine + agent (the fixtures ship neither) — depending on a
// sibling test file's side effects is the coupling that has broken this repo before.
let MACHINE = '';
let AGENT = '';
beforeAll(async () => {
  if (!sql) return;
  const [m] = await sql`insert into machines (workspace_id, owner_user_id, name, platform, daemon_version, last_seen_at, runtimes)
    values (${WS}::uuid, ${george.id}::uuid, 'member-compute-host', 'darwin', '1', now(), '["claude-code"]'::jsonb)
    on conflict (workspace_id, name) do update set last_seen_at = now() returning id`;
  MACHINE = m!['id'] as string;
  const [a] = await sql`insert into agents (workspace_id, machine_id, name, role, model)
    values (${WS}::uuid, ${MACHINE}::uuid, 'member-compute-agent', 'developer', 'claude-sonnet-5')
    on conflict (workspace_id, name) do update set role = 'developer' returning id`;
  AGENT = a!['id'] as string;
  // A THIRD member, so "revoking one keeps everyone else" has an `else` to keep. With the two the
  // fixtures ship, that assertion passes vacuously — the control below refuses to let it.
  await sql`insert into nm_users (id, clerk_user_id, email)
    values (${THIRD}::uuid, ${THIRD}, 'third@compute.test') on conflict (id) do nothing`;
  await sql`insert into workspace_members (workspace_id, user_id, role, display_name)
    values (${WS}::uuid, ${THIRD}::uuid, 'member', 'third') on conflict do nothing`;
});

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('member.set_compute on postgres (0118)', () => {
  it('a human sets their own prefs; the jsonb round-trips on their member row', async () => {
    const res = await send(george, { type: 'member.set_compute', workspace: WS, machine: MACHINE, agents: { [AGENT]: MACHINE } });
    expect(res.status).toBe(200);
    const [row] = await sql!`select compute from workspace_members where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`;
    expect(row!['compute']).toMatchObject({ machine: MACHINE, agents: { [AGENT]: MACHINE } });
  });

  it('null machine returns the member to origin affinity — the row says so, not a missing key', async () => {
    expect((await send(george, { type: 'member.set_compute', workspace: WS, machine: null })).status).toBe(200);
    const [row] = await sql!`select compute from workspace_members where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`;
    expect(row!['compute']).toMatchObject({ machine: null, agents: {} });
  });

  it('an agent cannot set anyone\'s compute (HUMAN_ONLY), and nothing about the row moves', async () => {
    const before = (await sql!`select compute from workspace_members where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`)[0]!['compute'];
    const res = await send(rex, { type: 'member.set_compute', workspace: WS, machine: MACHINE });
    expect(res.status).toBe(403);
    expect((await res.json() as { code?: string }).code).toBe('HUMAN_ONLY');
    const after = (await sql!`select compute from workspace_members where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`)[0]!['compute'];
    expect(after).toEqual(before);
  });

  it('a machine outside the workspace 404s at set time', async () => {
    const res = await send(george, { type: 'member.set_compute', workspace: WS, machine: 'b0000000-0000-0000-0000-0000000000bb' });
    expect(res.status).toBe(404);
  });

  it('an agent id outside the workspace 404s at set time', async () => {
    const res = await send(george, { type: 'member.set_compute', workspace: WS, agents: { 'b0000000-0000-0000-0000-0000000000bb': MACHINE } });
    expect(res.status).toBe(404);
  });
});

describe.skipIf(!DB)('compute consent (0119)', () => {
  // The BACKFILL, tested as the statement it is. It cannot be observed on the fixtures: this test
  // database applies migrations and *then* seeds, so those rows never existed when 0119 ran —
  // whereas in production members exist first, which is the entire point. So the row is put into
  // its pre-0119 shape and the migration's exact UPDATE is replayed against it.
  it('the 0119 backfill lends pre-existing members to the workspace, and never clobbers a choice', async () => {
    const BACKFILL = sql!`update workspace_members
         set compute = jsonb_set(coalesce(compute, '{}'::jsonb), '{shares}', '["*"]'::jsonb, true)
       where compute -> 'shares' is null`;
    const restore = (await sql!`select compute from workspace_members where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`)[0]!['compute'];
    try {
      // a pre-0119 row: routing set, no consent key at all
      await sql!`update workspace_members set compute = '{"machine":null,"agents":{}}'::jsonb
                  where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`;
      await BACKFILL;
      const [after] = await sql!`select compute from workspace_members where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`;
      expect((after!['compute'] as { shares?: string[] }).shares).toEqual(['*']);
      // …and a member who has ALREADY chosen keeps their choice — the guard is `shares is null`,
      // so re-running the migration can never re-open a grant someone deliberately revoked
      await sql!`update workspace_members set compute = '{"machine":null,"agents":{},"shares":[]}'::jsonb
                  where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`;
      await sql!`update workspace_members
                    set compute = jsonb_set(coalesce(compute, '{}'::jsonb), '{shares}', '["*"]'::jsonb, true)
                  where compute -> 'shares' is null`;
      const [kept] = await sql!`select compute from workspace_members where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`;
      expect((kept!['compute'] as { shares?: string[] }).shares).toEqual([]);
    } finally {
      await sql!`update workspace_members set compute = ${sql!.json(restore as never)} where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`;
    }
  });

  it('shares round-trips on the member row', async () => {
    expect((await send(george, { type: 'member.set_compute', workspace: WS, shares: [george.id] })).status).toBe(200);
    const [row] = await sql!`select compute from workspace_members where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`;
    expect((row!['compute'] as { shares?: string[] }).shares).toEqual([george.id]);
  });

  it('you cannot lend to someone outside the workspace', async () => {
    const res = await send(george, { type: 'member.set_compute', workspace: WS, shares: ['b0000000-0000-0000-0000-0000000000bb'] });
    expect(res.status).toBe(404);
  });

  it('an agent cannot grant itself compute (HUMAN_ONLY covers shares too)', async () => {
    const res = await send(rex, { type: 'member.set_compute', workspace: WS, shares: ['*'] });
    expect(res.status).toBe(403);
  });
});

describe.skipIf(!DB)('member.share_compute — the server owns the set (2026-08-14)', () => {
  it('turning ON someone already covered by "*" is a no-op, not a silent revoke', async () => {
    await sql!`update workspace_members set compute = '{"shares":["*"]}'::jsonb
                where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`;
    expect((await send(george, { type: 'member.share_compute', workspace: WS, member: THIRD, on: true })).status).toBe(200);
    const [row] = await sql!`select compute from workspace_members where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`;
    // the live bug: this path deleted them, because the CLIENT expanded '*' and then removed one
    expect((row!['compute'] as { shares?: string[] }).shares).toEqual(['*']);
  });

  it('revoking from "*" expands against the REAL roster, keeping everyone else', async () => {
    await sql!`update workspace_members set compute = '{"shares":["*"]}'::jsonb
                where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`;
    const others = (await sql!`select user_id from workspace_members where workspace_id = ${WS}::uuid and user_id <> ${george.id}::uuid`).map((r) => r['user_id'] as string);
    expect(others.length).toBeGreaterThan(1); // CONTROL: with one other member this proves nothing
    expect((await send(george, { type: 'member.share_compute', workspace: WS, member: others[0]!, on: false })).status).toBe(200);
    const [row] = await sql!`select compute from workspace_members where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`;
    const shares = (row!['compute'] as { shares?: string[] }).shares ?? [];
    expect(shares).not.toContain(others[0]);
    for (const id of others.slice(1)) expect(shares).toContain(id);
  });

  it('an agent cannot lend a machine, and a stranger cannot be lent to', async () => {
    expect((await send(rex, { type: 'member.share_compute', workspace: WS, member: THIRD, on: true })).status).toBe(403);
    expect((await send(george, { type: 'member.share_compute', workspace: WS, member: 'b0000000-0000-0000-0000-0000000000bb', on: true })).status).toBe(404);
  });
});

describe.skipIf(!DB)('member.set_compute is a PARTIAL update (impact scan, 2026-08-14)', () => {
  it('sending only `machine` leaves the grants alone', async () => {
    // the live shape: the join card sends {machine, agents} and never mentions shares. Coercing
    // the omitted field to [] wiped every grant the member had given.
    expect((await send(george, { type: 'member.share_compute', workspace: WS, member: THIRD, on: true })).status).toBe(200);
    const before = (await sql!`select compute from workspace_members where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`)[0]!['compute'] as { shares?: string[] };
    expect(before.shares?.length).toBeGreaterThan(0); // CONTROL: nothing to preserve proves nothing

    expect((await send(george, { type: 'member.set_compute', workspace: WS, machine: MACHINE })).status).toBe(200);
    const after = (await sql!`select compute from workspace_members where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`)[0]!['compute'] as { machine?: string; shares?: string[] };
    expect(after.machine).toBe(MACHINE);
    expect(after.shares).toEqual(before.shares);
  });

  it('sending only `shares` leaves the chosen machine alone', async () => {
    expect((await send(george, { type: 'member.set_compute', workspace: WS, machine: MACHINE })).status).toBe(200);
    expect((await send(george, { type: 'member.set_compute', workspace: WS, shares: [] })).status).toBe(200);
    const [row] = await sql!`select compute from workspace_members where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`;
    expect((row!['compute'] as { machine?: string }).machine).toBe(MACHINE);
  });
});
