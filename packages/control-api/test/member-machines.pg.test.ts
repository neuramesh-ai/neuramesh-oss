// Per-member cloud machines against the REAL schema (docs/design/member-machines-2026-09/plan.md),
// in the Free / Pro model (source release 2026-09-12; Individual / Team before that).
//
// What this locks down:
//   · a Free workspace is born with NO machine; the runner arrives with the Stripe flip to Pro
//     (plan-flip.ts), and on a one-person Pro the runner IS the owner's machine
//   · Free cannot invite a second person, and cannot mint a machine of its own — Pro can
//   · the FIRST invitation on Pro promotes the runner into the owner's machine (same id, same
//     volume, same token) and mints a fresh runner, before any second human exists; only once
//   · accepting provisions the joiner's machine, asleep, shared by default; exactly one live per
//     member (0133)
//   · a message wakes the runner and the SENDER's machine — never a teammate's
//   · waking by id honours the owner's grant; the relay attach read carries kind + owner
//   · leaving or being removed tombstones the machine (the feed drops it) and frees its name;
//     re-joining mints a fresh one
//   · provisioning is credits-gated and idempotent; the heartbeat publishes runtimes
//
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { creditBalance, grantCredits } from '../src/credit-ledger';
import { computeFleetDesired } from '../src/fleet';
import { bumpMachineWake } from '../src/fleet-lifecycle';
import { ensureTeamShape, memberMachineOf, provisionMemberMachine } from '../src/member-machines';
import { PostgresStore } from '../src/pgstore';
import { applyPlanPatch } from '../src/plan-flip';
import { machineWorkspace } from '../src/relay';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

/** a real nm_users row — accept_invite re-reads the address from it */
async function makeUser(clerkId: string, email: string): Promise<Actor> {
  const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${clerkId}, ${email})
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  return { kind: 'human', id: row!['id'] as string };
}

/** the provisioning hooks are fire-and-forget, like the runner mint — wait for the row briefly */
async function until<T>(read: () => Promise<T | null>, ms = 4000): Promise<T | null> {
  const t0 = Date.now();
  for (;;) {
    const v = await read();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, 50));
  }
}

interface MachineRow { id: string; kind: string; owner_user_id: string; desired_replicas: number; lifecycle: string | null; token_hash: string | null; name: string; started_at: string | null; runtimes: unknown }
const machinesOf = async (ws: string): Promise<MachineRow[]> =>
  (await sql!`select id, kind, owner_user_id, desired_replicas, lifecycle, token_hash, name, started_at, runtimes from machines where workspace_id = ${ws}::uuid order by created_at`) as unknown as MachineRow[];
const live = (rows: MachineRow[]) => rows.filter((m) => m.lifecycle !== 'destroyed');
const liveMemberOf = (rows: MachineRow[], user: string) => live(rows).find((m) => m.kind === 'member' && m.owner_user_id === user);
const liveRunner = (rows: MachineRow[]) => live(rows).find((m) => m.kind === 'runner');
/** the product's one road to Pro: the Stripe checkout event through the webhook's applier, which
 *  grants the seat credits and mints the runner (plan-flip.ts) */
const toTeam = (ws: string, sub = `sub_mm_${ws.slice(0, 8)}`) => applyPlanPatch(store!, {
  workspace: ws, patch: { plan: 'cloud', subscriptionStatus: 'active', stripeCustomerId: 'cus_mm', stripeSubscriptionId: sub },
});

/** invite + accept, returning the joiner's machine row once the hook has run */
async function join(owner: Actor, ws: string, who: Actor, email: string): Promise<MachineRow | null> {
  const inv = await j(await send(owner, { type: 'workspace.invite', workspace: ws, email }));
  expect((await send(who, { type: 'workspace.accept_invite', invite: inv.inviteId })).status).toBe(200);
  return until(async () => liveMemberOf(await machinesOf(ws), who.id) ?? null);
}

let prevFlag: string | undefined;
let alice: Actor; let bob: Actor; let cara: Actor;
let WS = '';
let originalRunner = '';

beforeAll(async () => {
  if (!sql) return;
  // the harness runs every other suite with the fleet OFF (no fleet there); this suite IS the fleet's
  prevFlag = process.env['FLEET_AUTOPROVISION'];
  process.env['FLEET_AUTOPROVISION'] = 'on';
  alice = await makeUser('clerk_mm_alice', 'alice@member-machines.test');
  bob = await makeUser('clerk_mm_bob', 'bob@member-machines.test');
  cara = await makeUser('clerk_mm_cara', 'cara@member-machines.test');
  const made = await j(await send(alice, { type: 'workspace.create', name: 'Member Machines', slug: `mm-${Date.now().toString(36)}` }));
  WS = made.workspaceId as string;
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env['FLEET_AUTOPROVISION'];
  else process.env['FLEET_AUTOPROVISION'] = prevFlag;
  // no row cleanup: the harness's postgres is ephemeral, and a raw `delete from workspaces` trips
  // the append-only events trigger (the product deletes a workspace through the store, not SQL)
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('per-member cloud machines (0133) — Individual and Team', () => {
  it('a Free workspace is born with no machine at all (the runner comes with Pro)', async () => {
    await new Promise((r) => setTimeout(r, 300)); // give a hook that must NOT fire the chance to
    await sql!`update workspaces set plan = 'free' where id = ${WS}::uuid`;
    expect(await machinesOf(WS)).toHaveLength(0);
    // sharing is ON by default (George, 2026-09-03): the owner row carries the whole-workspace grant
    const [row] = await sql!`select compute from workspace_members where workspace_id = ${WS}::uuid and user_id = ${alice.id}::uuid`;
    expect((row!['compute'] as { shares?: string[] }).shares).toEqual(['*']);
  });

  it('Free is one person: no invitation, and no machine of your own — both name Pro as the door', async () => {
    const inv = await send(alice, { type: 'workspace.invite', workspace: WS, email: 'bob@member-machines.test' });
    expect(inv.status).toBe(402);
    expect((await j(inv)).error).toMatch(/Upgrade to Pro/);
    const prov = await send(alice, { type: 'machine.provision', workspace: WS });
    expect(prov.status).toBe(402);
    expect((await j(prov)).error).toMatch(/Pro/);
    expect(live(await machinesOf(WS))).toHaveLength(0);
  });

  it('the flip to Pro mints the runner, awake: on a one-person Pro the runner IS the owner\'s machine', async () => {
    expect(await toTeam(WS)).toBe('ok');
    const rows = await machinesOf(WS);
    expect(live(rows)).toHaveLength(1);
    expect(liveRunner(rows)?.desired_replicas).toBe(1);
    expect(liveRunner(rows)?.owner_user_id).toBe(alice.id);
    originalRunner = liveRunner(rows)!.id;
  });

  it('Pro: the FIRST invitation promotes the runner into the owner\'s machine and mints a fresh runner — once', async () => {
    const inv = await j(await send(alice, { type: 'workspace.invite', workspace: WS, email: 'bob@member-machines.test' }));
    expect(inv.inviteId).toBeTruthy();
    const rows = await machinesOf(WS);
    const mine = liveMemberOf(rows, alice.id);
    expect(mine?.id, 'the machine that held the owner\'s logins is now theirs: same id, same volume').toBe(originalRunner);
    expect(mine!.name).toBe(`member-${alice.id.slice(0, 8)}`);
    expect(mine!.token_hash, 'the token — and so the Secret — survives the promotion').not.toBeNull();
    const runner = liveRunner(rows)!;
    expect(runner.id).not.toBe(originalRunner);
    expect(runner.desired_replicas, 'the fresh runner is born awake for keys and the starter brain').toBe(1);
    // a second invitation changes nothing: still one runner, still one machine for the owner
    const again = await j(await send(alice, { type: 'workspace.invite', workspace: WS, email: 'cara@member-machines.test' }));
    expect(again.inviteId).toBeTruthy();
    const after = live(await machinesOf(WS));
    expect(after.filter((m) => m.kind === 'runner')).toHaveLength(1);
    expect(after.filter((m) => m.kind === 'member' && m.owner_user_id === alice.id)).toHaveLength(1);
    expect(await ensureTeamShape(sql!, WS)).toEqual({ promoted: null, runner: runner.id });
  });

  // With FLEET_RUNNER_SUBSTRATE=claim a runner is a warm claim: no volume, no login (a login promotes
  // it first). Converting it at the first invitation left two awake claims serving one workspace and
  // a daemon that still believed it was the runner (the k3d e2e, 2026-09-25).
  it('a CLAIM runner stays the runner at the first invitation, and the owner gets a machine of their own, asleep', async () => {
    const dan = await makeUser('clerk_mm_dan', 'dan@member-machines.test');
    const erin = await makeUser('clerk_mm_erin', 'erin@member-machines.test');
    const made = await j(await send(dan, { type: 'workspace.create', name: 'Claim Team', slug: `mmc-${Date.now().toString(36)}` }));
    const ws = made.workspaceId as string;
    const prevSub = process.env['FLEET_RUNNER_SUBSTRATE'];
    process.env['FLEET_RUNNER_SUBSTRATE'] = 'claim';
    try { await toTeam(ws, `sub_mmc_${ws.slice(0, 8)}`); } finally {
      if (prevSub === undefined) delete process.env['FLEET_RUNNER_SUBSTRATE']; else process.env['FLEET_RUNNER_SUBSTRATE'] = prevSub;
    }
    const [claimRunner] = await sql!`select id, substrate from machines where workspace_id = ${ws}::uuid and kind = 'runner'`;
    expect(claimRunner!['substrate']).toBe('claim');
    const erins = await join(dan, ws, erin, 'erin@member-machines.test');
    expect(erins, 'the joiner still gets a machine of their own').not.toBeNull();
    const rows = live(await machinesOf(ws));
    const runners = rows.filter((m) => m.kind === 'runner');
    expect(runners, 'one runner, and it is the claim the workspace already had').toHaveLength(1);
    expect(runners[0]!.id).toBe(claimRunner!['id']);
    const dans = liveMemberOf(rows, dan.id);
    expect(dans, 'the owner gets a machine of their own').toBeTruthy();
    expect(dans!.id).not.toBe(claimRunner!['id']);
    expect(dans!.desired_replicas, 'born asleep, like a joiner').toBe(0);
    expect(await ensureTeamShape(sql!, ws)).toEqual({ promoted: null, runner: claimRunner!['id'] });
  });

  // R4 (George, 2026-09-25): a member's machine is a warm claim too, asleep until used. A sign-in
  // needs a disk, so its owner's shell promotes it first, and the usage read names it as theirs so
  // the browser's shell opens it and not the runner (webnm-relay.ts).
  it('R4: under the claim default a member machine is a claim, asleep; only its owner promotes it; the usage read names it', async () => {
    const fay = await makeUser('clerk_mm_fay', 'fay@member-machines.test');
    const gus = await makeUser('clerk_mm_gus', 'gus@member-machines.test');
    const made = await j(await send(fay, { type: 'workspace.create', name: 'R4 Team', slug: `mmr4-${Date.now().toString(36)}` }));
    const ws = made.workspaceId as string;
    const prevSub = process.env['FLEET_RUNNER_SUBSTRATE'];
    process.env['FLEET_RUNNER_SUBSTRATE'] = 'claim';
    let guss: MachineRow | null = null;
    try {
      await toTeam(ws, `sub_mmr4_${ws.slice(0, 8)}`);
      guss = await join(fay, ws, gus, 'gus@member-machines.test');
    } finally {
      if (prevSub === undefined) delete process.env['FLEET_RUNNER_SUBSTRATE']; else process.env['FLEET_RUNNER_SUBSTRATE'] = prevSub;
    }
    expect(guss).not.toBeNull();
    const fays = liveMemberOf(await machinesOf(ws), fay.id);
    expect(fays, 'the owner gets a machine of their own at the first invitation').toBeTruthy();
    const sub = async (id: string) => (await sql!`select substrate, desired_replicas from machines where id = ${id}::uuid`)[0]!;
    for (const id of [guss!.id, fays!.id]) expect(await sub(id)).toMatchObject({ substrate: 'claim', desired_replicas: 0 });

    // the usage read: the runner stays first for every client that reads machines[0], and each
    // caller is told which machine is theirs
    const usage = async (who: Actor) => j(await app!.request(`/v1/machines/usage?workspace=${ws}`, { headers: { 'x-nm-actor': JSON.stringify(who) } }));
    const forGus = await usage(gus);
    expect(forGus.machines[0].kind).toBe('runner');
    expect(forGus.yours).toBe(guss!.id);
    expect((await usage(fay)).yours).toBe(fays!.id);

    // a teammate cannot put a disk under someone else's machine; its owner can, and it wakes
    const byFay = await send(fay, { type: 'machine.promote', workspace: ws, machineId: guss!.id });
    expect((await j(byFay)).code).toBe('NOT_PERMITTED');
    expect(await sub(guss!.id)).toMatchObject({ substrate: 'claim' });
    expect(await j(await send(gus, { type: 'machine.promote', workspace: ws, machineId: guss!.id }))).toMatchObject({ ok: true, promoted: true });
    expect(await sub(guss!.id)).toMatchObject({ substrate: 'volume', desired_replicas: 1 });
  });

  it('accepting an invitation provisions the joiner\'s machine, asleep, shared by default, and exactly once', async () => {
    const pending = await store!.pendingInvitesForEmail('bob@member-machines.test');
    expect((await send(bob, { type: 'workspace.accept_invite', invite: pending[0]!.inviteId })).status).toBe(200);
    const bobs = await until(async () => liveMemberOf(await machinesOf(WS), bob.id) ?? null);
    expect(bobs).not.toBeNull();
    expect(bobs!.desired_replicas).toBe(0);
    const [row] = await sql!`select compute from workspace_members where workspace_id = ${WS}::uuid and user_id = ${bob.id}::uuid`;
    expect((row!['compute'] as { shares?: string[] }).shares).toEqual(['*']);
    // idempotent: provisioning again returns the same machine, mints nothing
    expect(await provisionMemberMachine(sql!, WS, bob.id)).toEqual({ id: bobs!.id, created: false });
    // the unique index is the law, not the function: a second live row cannot exist
    await expect(sql!`insert into machines (workspace_id, owner_user_id, name, platform, kind, desired_replicas)
      values (${WS}::uuid, ${bob.id}::uuid, 'dupe', 'linux', 'member', 0)`).rejects.toThrow(/machines_one_member/);
  });

  it('a message wakes the runner and the SENDER\'s machine — never a teammate\'s', async () => {
    await sql!`update machines set desired_replicas = 0, started_at = null where workspace_id = ${WS}::uuid`;
    await bumpMachineWake(sql!, WS, bob.id);
    const rows = await machinesOf(WS);
    expect(liveRunner(rows)!.desired_replicas).toBe(1);
    expect(liveMemberOf(rows, bob.id)!.desired_replicas).toBe(1);
    expect(liveMemberOf(rows, bob.id)!.started_at).not.toBeNull();
    expect(liveMemberOf(rows, alice.id)!.desired_replicas).toBe(0);
    // an agent's message (no origin) wakes the runner only
    await sql!`update machines set desired_replicas = 0, started_at = null where workspace_id = ${WS}::uuid`;
    await bumpMachineWake(sql!, WS, null);
    const after = await machinesOf(WS);
    expect(liveRunner(after)!.desired_replicas).toBe(1);
    expect(live(after).filter((m) => m.kind === 'member').every((m) => m.desired_replicas === 0)).toBe(true);
  });

  it('waking by id honours the owner\'s grant: lent → wakes, revoked → 403, the owner always, an agent for the origin', async () => {
    await sql!`update machines set desired_replicas = 0, started_at = null where workspace_id = ${WS}::uuid`;
    const alices = liveMemberOf(await machinesOf(WS), alice.id)!;
    const wake = (who: Actor) => app!.request('/v1/machines/wake', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(who) },
      body: JSON.stringify({ workspace: WS, machineId: alices.id }),
    });
    // alice lends to everyone by default — bob may wake hers
    expect((await wake(bob)).status).toBe(200);
    expect(liveMemberOf(await machinesOf(WS), alice.id)!.desired_replicas).toBe(1);
    // alice stops sharing: bob is refused, alice herself is not
    await sql!`update workspace_members set compute = jsonb_set(compute, '{shares}', '[]'::jsonb) where workspace_id = ${WS}::uuid and user_id = ${alice.id}::uuid`;
    await sql!`update machines set desired_replicas = 0 where id = ${alices.id}::uuid`;
    expect((await wake(bob)).status).toBe(403);
    expect(liveMemberOf(await machinesOf(WS), alice.id)!.desired_replicas).toBe(0);
    expect((await wake(alice)).status).toBe(200);
    // the command lane says the same thing, and an agent from elsewhere gets nowhere
    expect((await send(bob, { type: 'machine.wake', workspace: WS, machineId: alices.id })).status).toBe(403);
    const stranger: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };
    expect((await send(stranger, { type: 'machine.wake', workspace: WS, machineId: alices.id })).status).toBe(403);
    // an agent OF this workspace may wake alice's unshared machine for alice's own request — and not for bob's
    const [ag] = await sql!`insert into agents (workspace_id, name, role, model) values (${WS}::uuid, 'mm-rex', 'orchestrator', 'gemini-3.5-flash-lite') returning id`;
    const rex: Actor = { kind: 'agent', id: ag!['id'] as string, role: 'orchestrator' };
    await sql!`update machines set desired_replicas = 0 where id = ${alices.id}::uuid`;
    expect((await send(rex, { type: 'machine.wake', workspace: WS, machineId: alices.id, forUserId: bob.id })).status).toBe(403);
    expect((await send(rex, { type: 'machine.wake', workspace: WS, machineId: alices.id })).status).toBe(403);
    expect((await send(rex, { type: 'machine.wake', workspace: WS, machineId: alices.id, forUserId: alice.id })).status).toBe(200);
    expect(liveMemberOf(await machinesOf(WS), alice.id)!.desired_replicas).toBe(1);
    await sql!`update workspace_members set compute = jsonb_set(compute, '{shares}', '["*"]'::jsonb) where workspace_id = ${WS}::uuid and user_id = ${alice.id}::uuid`;
  });

  it('the relay attach read carries kind and owner, so a member machine can be its owner\'s alone', async () => {
    const rows = await machinesOf(WS);
    expect(await machineWorkspace(sql!, liveRunner(rows)!.id)).toEqual({ workspaceId: WS, kind: 'runner', ownerUserId: alice.id });
    expect(await machineWorkspace(sql!, liveMemberOf(rows, bob.id)!.id)).toEqual({ workspaceId: WS, kind: 'member', ownerUserId: bob.id });
  });

  it('the heartbeat publishes runtimes, and a beat without them leaves the last answer standing', async () => {
    const bobs = liveMemberOf(await machinesOf(WS), bob.id)!;
    expect((await send(bob, { type: 'machine.heartbeat', machineId: bobs.id, runtimes: ['claude-code'] })).status).toBe(200);
    expect(liveMemberOf(await machinesOf(WS), bob.id)!.runtimes).toEqual(['claude-code']);
    expect((await send(bob, { type: 'machine.heartbeat', machineId: bobs.id, activeSeconds: 5 })).status).toBe(200);
    expect(liveMemberOf(await machinesOf(WS), bob.id)!.runtimes).toEqual(['claude-code']);
  });

  it('leaving tombstones the machine — the feed drops it, the name is freed — and re-joining mints anew', async () => {
    const before = liveMemberOf(await machinesOf(WS), bob.id)!;
    expect((await send(bob, { type: 'workspace.leave', workspace: WS })).status).toBe(200);
    const gone = await until(async () => {
      const row = (await machinesOf(WS)).find((m) => m.id === before.id);
      return row?.lifecycle === 'destroyed' ? row : null;
    });
    expect(gone).not.toBeNull();
    expect(gone!.desired_replicas).toBe(0);
    expect(gone!.token_hash).toBeNull();
    expect(gone!.name).toContain('-gone-');
    const desired = await computeFleetDesired(sql!);
    expect(desired.workspaces.find((w) => w.id === WS)!.machines.map((m) => m.id)).not.toContain(before.id);
    // back again: a fresh machine under the freed name
    const fresh = await join(alice, WS, bob, 'bob@member-machines.test');
    expect(fresh).not.toBeNull();
    expect(fresh!.id).not.toBe(before.id);
    expect(fresh!.name).toBe(`member-${bob.id.slice(0, 8)}`);
  });

  it('an owner removing a member tombstones that member\'s machine; nobody removes the runner or a teammate\'s machine by hand', async () => {
    const pending = await store!.pendingInvitesForEmail('cara@member-machines.test');
    expect((await send(cara, { type: 'workspace.accept_invite', invite: pending[0]!.inviteId })).status).toBe(200);
    const caras = await until(async () => liveMemberOf(await machinesOf(WS), cara.id) ?? null);
    expect(caras).not.toBeNull();
    expect((await send(alice, { type: 'machine.remove', workspace: WS, machineId: caras!.id })).status).toBe(403);
    expect((await send(alice, { type: 'machine.remove', workspace: WS, machineId: liveRunner(await machinesOf(WS))!.id })).status).toBe(403);
    expect((await send(alice, { type: 'workspace.remove_member', workspace: WS, member: cara.id })).status).toBe(200);
    const gone = await until(async () => {
      const row = (await machinesOf(WS)).find((m) => m.id === caras!.id);
      return row?.lifecycle === 'destroyed' ? row : null;
    });
    expect(gone).not.toBeNull();
    expect(await memberMachineOf(sql!, WS, cara.id)).toBeNull();
  });

  it('provisioning is credits-gated: refused out loud at zero, granted once funded', async () => {
    const owner = await makeUser('clerk_mm_dana', 'dana@member-machines.test');
    const made = await j(await send(owner, { type: 'workspace.create', name: 'Broke', slug: `mm-broke-${Date.now().toString(36)}` }));
    const ws = made.workspaceId as string;
    await sql!`update workspaces set plan = 'free' where id = ${ws}::uuid`;
    expect(await toTeam(ws)).toBe('ok');
    const eve = await makeUser('clerk_mm_eve', 'eve@member-machines.test');
    // the invitation promotes the runner and mints a fresh one (awake) — park everything BEFORE
    // zeroing the balance: a zero-balance machine left awake is what the sweep parks, and the
    // credit-pools suite next door asserts on what the sweep parked
    const inv = await j(await send(owner, { type: 'workspace.invite', workspace: ws, email: 'eve@member-machines.test' }));
    await sql!`update machines set desired_replicas = 0, started_at = null where workspace_id = ${ws}::uuid`;
    await sql!`update workspace_credits set spent_micros = granted_micros where workspace_id = ${ws}::uuid`;
    expect((await creditBalance(sql!, ws)).remainingMicros).toBe(0);
    expect((await send(eve, { type: 'workspace.accept_invite', invite: inv.inviteId })).status).toBe(200);
    // the join itself succeeded; the machine was refused (nothing to wait for, and nothing appears)
    await new Promise((r) => setTimeout(r, 300));
    expect(liveMemberOf(await machinesOf(ws), eve.id)).toBeUndefined();
    const refused = await send(eve, { type: 'machine.provision', workspace: ws });
    expect(refused.status).toBe(402);
    expect((await j(refused)).code).toBe('PLAN_LIMIT');
    await grantCredits(sql!, ws, 100, 'purchase', 'test top-up');
    const ok = await j(await send(eve, { type: 'machine.provision', workspace: ws }));
    expect(ok.created).toBe(true);
    expect(liveMemberOf(await machinesOf(ws), eve.id)!.desired_replicas).toBe(0);
    // and a stranger cannot provision into a workspace they are not in
    expect((await send(bob, { type: 'machine.provision', workspace: ws })).status).toBe(403);
  });
});
