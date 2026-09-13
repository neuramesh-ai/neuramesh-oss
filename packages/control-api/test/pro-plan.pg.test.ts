// The bill stops, and Pro is named (source release 2026-09-12, unit U1a) — against the REAL schema.
//
// What this locks down:
//   · a new workspace is born on Free with NO machine row and NO credit grant
//   · the Stripe flip `free → cloud` (checkout.session.completed through applyPlanPatch) mints
//     exactly one runner for the owner and grants CLOUD_SEAT_MONTHLY_CREDITS × seats ONCE
//   · the same event redelivered mints nothing and grants nothing; a later subscription event
//     on an already-Pro workspace writes seats and grants nothing
//   · seats follow the roster: invite accept and member removal on a Pro workspace with a
//     subscription make exactly one subscriptions.update each, with the new member count and
//     prorations; a Free workspace (a lapsed Pro with members left) makes none
//
// Stripe is MOCKED at the module boundary and STRIPE_SECRET_KEY is set before billing.ts loads,
// so billingEnabled() is true in this file only. Run via scripts/test-pg.sh — skipped without
// DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import { CLOUD_SEAT_MONTHLY_CREDITS, creditsToMicros } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { planPatchFromEvent } from '../src/billing';
import { creditBalance } from '../src/credit-ledger';
import { PostgresStore } from '../src/pgstore';
import { applyPlanPatch } from '../src/plan-flip';

const { retrieveMock, updateMock } = vi.hoisted(() => {
  process.env['STRIPE_SECRET_KEY'] = 'sk_test_u1a_mocked';
  return {
    retrieveMock: vi.fn(async (id: string) => ({ id, items: { data: [{ id: `si_${id}`, quantity: 1 }] } })),
    updateMock: vi.fn(async () => ({})),
  };
});
vi.mock('stripe', () => ({ default: class { subscriptions = { retrieve: retrieveMock, update: updateMock }; } }));

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

async function makeUser(clerkId: string, email: string): Promise<Actor> {
  const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${clerkId}, ${email})
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  return { kind: 'human', id: row!['id'] as string };
}

/** the roster hooks are fire-and-forget — wait for the Stripe call briefly */
async function until(read: () => boolean, ms = 4000): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    if (read()) return true;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

interface MachineRow { id: string; kind: string; owner_user_id: string; desired_replicas: number; lifecycle: string | null }
const machinesOf = async (ws: string): Promise<MachineRow[]> =>
  (await sql!`select id, kind, owner_user_id, desired_replicas, lifecycle from machines where workspace_id = ${ws}::uuid order by created_at`) as unknown as MachineRow[];
const live = (rows: MachineRow[]) => rows.filter((m) => m.lifecycle !== 'destroyed');
const grantsOf = (ws: string) => sql!`select kind, note, micros from credit_grants where workspace_id = ${ws}::uuid order by created_at`;
const planOf = async (ws: string) => (await sql!`select plan, seats, stripe_subscription_id from workspaces where id = ${ws}::uuid`)[0]!;

/** what Stripe sends when a Pro checkout completes (mode 'subscription'; a pack is 'payment') */
const checkoutCompleted = (ws: string, sub: string) => planPatchFromEvent({
  type: 'checkout.session.completed',
  data: { object: { mode: 'subscription', client_reference_id: ws, customer: 'cus_u1a', subscription: sub } },
})!;

let prevFlag: string | undefined;
let alice: Actor; let bob: Actor;
let WS = '';
const SUB = `sub_u1a_${Date.now().toString(36)}`;

beforeAll(async () => {
  if (!sql) return;
  prevFlag = process.env['FLEET_AUTOPROVISION'];
  process.env['FLEET_AUTOPROVISION'] = 'on'; // the harness runs with the fleet off; this suite mints
  alice = await makeUser('clerk_u1a_alice', 'alice@pro-plan.test');
  bob = await makeUser('clerk_u1a_bob', 'bob@pro-plan.test');
  const made = await j(await send(alice, { type: 'workspace.create', name: 'Pro Plan', slug: `u1a-${Date.now().toString(36)}` }));
  WS = made.workspaceId as string;
  // every test of a Free behaviour sets the plan out loud: the dev seed (97-dev-plan.sql) makes cloud
  await sql`update workspaces set plan = 'free' where id = ${WS}::uuid`;
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env['FLEET_AUTOPROVISION'];
  else process.env['FLEET_AUTOPROVISION'] = prevFlag;
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('the bill stops, and Pro is named (U1a)', () => {
  it('a new Free workspace has no machine row and no credit grant', async () => {
    await new Promise((r) => setTimeout(r, 300)); // give a hook that must NOT fire the chance to
    expect(await machinesOf(WS)).toHaveLength(0);
    expect(await grantsOf(WS)).toHaveLength(0);
    expect((await creditBalance(sql!, WS)).remainingMicros).toBe(0);
    expect((await planOf(WS))['plan']).toBe('free');
  });

  it('the checkout flip mints one runner for the owner and grants 1,500 × seats once', async () => {
    expect(await applyPlanPatch(store!, checkoutCompleted(WS, SUB))).toBe('ok');
    const row = await planOf(WS);
    expect(row['plan']).toBe('cloud');
    expect(row['stripe_subscription_id']).toBe(SUB);
    const machines = live(await machinesOf(WS));
    expect(machines).toHaveLength(1);
    expect(machines[0]!.kind).toBe('runner');
    expect(machines[0]!.owner_user_id).toBe(alice.id);
    expect(machines[0]!.desired_replicas, 'born awake: keys and the starter brain need it').toBe(1);
    const grants = await grantsOf(WS);
    expect(grants).toHaveLength(1);
    expect(grants[0]!['kind']).toBe('promo');
    expect(grants[0]!['note']).toBe(SUB);
    expect(Number(grants[0]!['micros'])).toBe(creditsToMicros(CLOUD_SEAT_MONTHLY_CREDITS * Number(row['seats'])));
    expect((await creditBalance(sql!, WS)).remainingMicros).toBe(creditsToMicros(CLOUD_SEAT_MONTHLY_CREDITS));
  });

  it('the same event redelivered mints nothing and grants nothing', async () => {
    expect(await applyPlanPatch(store!, checkoutCompleted(WS, SUB))).toBe('ok');
    expect(live(await machinesOf(WS))).toHaveLength(1);
    expect(await grantsOf(WS)).toHaveLength(1);
    expect((await creditBalance(sql!, WS)).remainingMicros).toBe(creditsToMicros(CLOUD_SEAT_MONTHLY_CREDITS));
  });

  it('a subscription event on an already-Pro workspace writes seats and grants nothing', async () => {
    const mapped = planPatchFromEvent({
      type: 'customer.subscription.updated',
      data: { object: { id: SUB, customer: 'cus_u1a', status: 'active', metadata: { workspace_id: WS }, items: { data: [{ quantity: 3 }] } } },
    })!;
    expect(await applyPlanPatch(store!, mapped)).toBe('ok');
    expect(Number((await planOf(WS))['seats'])).toBe(3);
    expect(await grantsOf(WS)).toHaveLength(1);
    expect(live(await machinesOf(WS))).toHaveLength(1);
  });

  it('a flip with no ledger to grant from answers unavailable and leaves the plan alone', async () => {
    const noSql = { workspacePlan: async () => 'free', setWorkspacePlan: vi.fn(async () => {}) } as unknown as PostgresStore;
    expect(await applyPlanPatch(noSql, checkoutCompleted('00000000-0000-4000-8000-0000000001a0', 'sub_x'))).toBe('unavailable');
    expect((noSql as unknown as { setWorkspacePlan: ReturnType<typeof vi.fn> }).setWorkspacePlan).not.toHaveBeenCalled();
  });

  it('invite accept on Pro pushes the new member count to Stripe once, prorated', async () => {
    updateMock.mockClear(); retrieveMock.mockClear();
    const inv = await j(await send(alice, { type: 'workspace.invite', workspace: WS, email: 'bob@pro-plan.test' }));
    expect(inv.inviteId).toBeTruthy();
    expect(updateMock, 'the invitation itself changes no seat: the member does not exist yet').not.toHaveBeenCalled();
    expect((await send(bob, { type: 'workspace.accept_invite', invite: inv.inviteId })).status).toBe(200);
    expect(await until(() => updateMock.mock.calls.length >= 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 200)); // and no second call trails in
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(retrieveMock).toHaveBeenCalledWith(SUB);
    expect(updateMock).toHaveBeenCalledWith(SUB, { items: [{ id: `si_${SUB}`, quantity: 2 }], proration_behavior: 'create_prorations' });
  });

  it('removing a member pushes the shrunken count once', async () => {
    updateMock.mockClear();
    expect((await send(alice, { type: 'workspace.remove_member', workspace: WS, member: bob.id })).status).toBe(200);
    expect(await until(() => updateMock.mock.calls.length >= 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith(SUB, { items: [{ id: `si_${SUB}`, quantity: 1 }], proration_behavior: 'create_prorations' });
  });

  it('a Stripe failure never fails the join', async () => {
    updateMock.mockClear();
    updateMock.mockRejectedValueOnce(new Error('stripe is down'));
    const inv = await j(await send(alice, { type: 'workspace.invite', workspace: WS, email: 'bob@pro-plan.test' }));
    expect((await send(bob, { type: 'workspace.accept_invite', invite: inv.inviteId })).status).toBe(200);
    expect(await until(() => updateMock.mock.calls.length >= 1)).toBe(true);
    const [n] = await sql!`select count(*)::int as n from workspace_members where workspace_id = ${WS}::uuid`;
    expect(Number(n!['n'])).toBe(2);
  });

  it('on Free (a lapsed Pro with members left) a removal makes no Stripe call', async () => {
    updateMock.mockClear();
    await sql!`update workspaces set plan = 'free' where id = ${WS}::uuid`;
    expect((await send(alice, { type: 'workspace.remove_member', workspace: WS, member: bob.id })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 400));
    expect(updateMock).not.toHaveBeenCalled();
  });
});
