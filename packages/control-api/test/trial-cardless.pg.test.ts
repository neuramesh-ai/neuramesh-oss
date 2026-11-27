// The Pro trial with no card (trial-cardless.ts, docs/design/onboarding-2026-11/trial.md) on the real schema,
// with the card requirement on as in production and Stripe faked: the trial makes the workspace Pro with
// 100 credits once, each person gets one, a card moves the trial to 14 days from its start, and a trial
// that ends with no card makes the workspace inactive again.
// run via scripts/test-pg.sh, skipped without DATABASE_URL.
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRO_TRIAL_DAYS, PRO_TRIAL_DAYS_NO_CARD, SIGNUP_GRANT_CREDITS } from '@neuramesh/shared';

const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);
const subs = new Map<string, Record<string, unknown>>();
let created = 0;
const fake = {
  customers: {
    create: vi.fn(async () => ({ id: `cus_${randomUUID().slice(0, 8)}` })),
    update: vi.fn(async (id: string) => ({ id })),
  },
  subscriptions: {
    create: vi.fn(async (p: { customer: string; trial_period_days: number; metadata: Record<string, string>; items: Array<{ quantity: number }> }) => {
      created++;
      const start = now();
      const s = { id: `sub_${randomUUID().slice(0, 8)}`, customer: p.customer, status: 'trialing', trial_start: start, trial_end: start + p.trial_period_days * DAY,
        default_payment_method: null, metadata: p.metadata, items: { data: [{ quantity: p.items[0]!.quantity, current_period_end: start + p.trial_period_days * DAY }] } };
      subs.set(s.id, s);
      return s;
    }),
    retrieve: vi.fn(async (id: string) => subs.get(id)),
    update: vi.fn(async (id: string, p: { default_payment_method?: string; trial_end?: number }) => {
      const s = { ...subs.get(id)!, ...(p.default_payment_method ? { default_payment_method: p.default_payment_method } : {}) };
      if (p.trial_end) Object.assign(s, { trial_end: p.trial_end, items: { data: [{ quantity: 1, current_period_end: p.trial_end }] } });
      subs.set(id, s);
      return s;
    }),
  },
  checkout: { sessions: { retrieve: vi.fn(async (id: string) => sessions.get(id)) } },
};
const sessions = new Map<string, Record<string, unknown>>();

vi.mock('../src/billing', async (orig) => ({ ...(await orig<typeof import('../src/billing')>()), stripe: () => fake, billingEnabled: () => true }));

const { PostgresStore } = await import('../src/pgstore');
const { executeCommand } = await import('../src/handler');
const { planPatchFromEvent } = await import('../src/billing');
const { applyPlanPatch } = await import('../src/plan-flip');
const { creditBalance } = await import('../src/credit-ledger');
const { attachTrialCard, startCardlessTrial, trialEndWithCard } = await import('../src/trial-cardless');

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const sql = DB ? postgres(DB) : null;
afterAll(async () => { await sql?.end(); await store?.close(); });
beforeEach(() => { vi.stubEnv('NM_REQUIRE_TRIAL_ACTIVATION', '1'); vi.stubEnv('NM_LOCAL', '0'); vi.stubEnv('STRIPE_PRICE_ID', 'price_pro'); });
afterEach(() => vi.unstubAllEnvs());

async function person(opts: { selfAsserted?: boolean } = {}) {
  const tag = randomUUID().slice(0, 10);
  const [u] = await sql!`insert into nm_users (clerk_user_id, email, email_self_asserted) values (${`cardless_${tag}`}, ${`${tag}@cardless.test`}, ${!!opts.selfAsserted}) returning id`;
  return { id: u!['id'] as string, kind: 'human' as const };
}
async function workspaceOf(actor: { id: string; kind: 'human' }) {
  const tag = randomUUID().slice(0, 10);
  return ((await executeCommand(store!, actor, { type: 'workspace.create', name: tag, slug: `cardless-${tag}` })) as unknown as { workspaceId: string }).workspaceId;
}
const row = async (ws: string) => (await sql!`select plan, subscription_status, card_on_file, current_period_end from workspaces where id = ${ws}::uuid`)[0]!;

describe('the trial end a card earns', () => {
  it('is 14 days from the start, never earlier than the end the trial has', () => {
    expect(trialEndWithCard(1000, 1000 + PRO_TRIAL_DAYS_NO_CARD * DAY)).toBe(1000 + PRO_TRIAL_DAYS * DAY);
    expect(trialEndWithCard(1000, 1000 + 30 * DAY)).toBe(1000 + 30 * DAY);
  });
});

describe.skipIf(!DB)('the Pro trial with no card (postgres)', () => {
  it('makes the workspace Pro for 7 days with 100 credits, with no card on file', async () => {
    const me = await person();
    const ws = await workspaceOf(me);
    expect(await store!.workspacePlan(ws)).toBe('free');
    const r = await startCardlessTrial(store!, me, ws);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ trial: true, plan: 'cloud', status: 'trialing', cardOnFile: false });
    const w = await row(ws);
    expect(w).toMatchObject({ plan: 'cloud', subscription_status: 'trialing', card_on_file: false });
    const days = (new Date(w['current_period_end'] as string).getTime() / 1000 - now()) / DAY;
    expect(Math.round(days)).toBe(PRO_TRIAL_DAYS_NO_CARD);
    expect((await creditBalance(sql!, ws)).remainingMicros).toBe(SIGNUP_GRANT_CREDITS * 10_000);
    const [ws2] = await store!.listWorkspaces(me.id);
    expect(ws2).toMatchObject({ plan: 'cloud', subscriptionStatus: 'trialing', cardOnFile: false });
  });

  it('starts once for a workspace: a second call finds the workspace already on Pro', async () => {
    const me = await person();
    const ws = await workspaceOf(me);
    await startCardlessTrial(store!, me, ws);
    const before = created;
    expect((await startCardlessTrial(store!, me, ws)).body).toMatchObject({ trial: false, plan: 'cloud' });
    expect(created).toBe(before);
    expect((await creditBalance(sql!, ws)).remainingMicros).toBe(SIGNUP_GRANT_CREDITS * 10_000);
  });

  it('gives each person one trial: a second workspace of the same person is refused', async () => {
    const me = await person();
    await startCardlessTrial(store!, me, await workspaceOf(me));
    const again = await startCardlessTrial(store!, me, await workspaceOf(me));
    expect(again).toMatchObject({ status: 409, body: { code: 'TRIAL_USED' } });
  });

  it('refuses a member who is not the owner, and an email the person never confirmed', async () => {
    const owner = await person();
    const ws = await workspaceOf(owner);
    const other = await person();
    await sql!`insert into workspace_members (workspace_id, user_id, role) values (${ws}::uuid, ${other.id}::uuid, 'member')`;
    expect(await startCardlessTrial(store!, other, ws)).toMatchObject({ status: 403, body: { code: 'NOT_PERMITTED' } });
    const unproven = await person({ selfAsserted: true });
    expect(await startCardlessTrial(store!, unproven, await workspaceOf(unproven))).toMatchObject({ status: 409, body: { code: 'EMAIL_UNPROVEN' } });
  });

  it('gives the trial back when Stripe fails, so the person can try again', async () => {
    const me = await person();
    const ws = await workspaceOf(me);
    fake.subscriptions.create.mockRejectedValueOnce(new Error('stripe down'));
    expect(await startCardlessTrial(store!, me, ws)).toMatchObject({ status: 503, body: { code: 'TRIAL_UNAVAILABLE' } });
    expect(await store!.workspacePlan(ws)).toBe('free');
    expect((await startCardlessTrial(store!, me, ws)).body).toMatchObject({ trial: true });
  });

  it('a card added during the trial becomes the default and moves the trial to 14 days from its start', async () => {
    const me = await person();
    const ws = await workspaceOf(me);
    await startCardlessTrial(store!, me, ws);
    sessions.set('cs_card', { id: 'cs_card', mode: 'setup', status: 'complete', client_reference_id: ws, setup_intent: { payment_method: 'pm_visa' } });
    const r = await attachTrialCard(store!, ws, 'cs_card');
    expect(r).toMatchObject({ plan: 'cloud', status: 'trialing', cardOnFile: true });
    const w = await row(ws);
    expect(w['card_on_file']).toBe(true);
    expect(Math.round((new Date(w['current_period_end'] as string).getTime() / 1000 - now()) / DAY)).toBe(PRO_TRIAL_DAYS);
    expect((await creditBalance(sql!, ws)).remainingMicros).toBe(SIGNUP_GRANT_CREDITS * 10_000);
    sessions.set('cs_other', { id: 'cs_other', mode: 'setup', status: 'complete', client_reference_id: 'another', setup_intent: { payment_method: 'pm_x' } });
    expect(await attachTrialCard(store!, ws, 'cs_other')).toMatchObject({ code: 'NOT_PERMITTED' });
  });

  it('a trial that ends with no card makes the workspace inactive again', async () => {
    const me = await person();
    const ws = await workspaceOf(me);
    const r = await startCardlessTrial(store!, me, ws);
    const sub = [...subs.values()].find((s) => (s['metadata'] as Record<string, string>)['workspace_id'] === ws)!;
    expect(r.status).toBe(200);
    const ended = planPatchFromEvent({ type: 'customer.subscription.deleted', data: { object: { ...sub, status: 'canceled' } } })!;
    expect(await applyPlanPatch(store!, ended)).toBe('ok');
    expect(await row(ws)).toMatchObject({ plan: 'free', subscription_status: 'canceled' });
    expect((await startCardlessTrial(store!, me, ws)).body).toMatchObject({ trial: false });
  });
});
