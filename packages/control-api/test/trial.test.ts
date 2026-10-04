// the card trial's routes (trial.ts) over the memory store, with Stripe mocked at the billing
// module: who gets a trial, what the session carries, where a person comes back to, and the read
// after the form, which must belong to the caller's own workspace before it flips anything.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, formatAddress } from '@neuramesh/shared';

const stripe = vi.hoisted(() => ({
  publishableKey: 'pk_test_x' as string | null,
  created: [] as Array<Record<string, unknown>>,
  state: { workspace: null as string | null, status: 'open' as string | null, subscription: null as Record<string, unknown> | null },
  applied: [] as Array<{ workspace: string; patch: Record<string, unknown> }>,
}));

vi.mock('../src/billing', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/billing')>();
  return {
    ...real,
    billingEnabled: () => true,
    billingPublishableKey: () => stripe.publishableKey,
    createTrialSession: async (input: Record<string, unknown>) => { stripe.created.push(input); return { id: 'cs_test_1', clientSecret: 'cs_test_1_secret' }; },
    trialSessionState: async () => stripe.state,
  };
});
vi.mock('../src/plan-flip', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/plan-flip')>();
  return { ...real, applyPlanPatch: async (_s: unknown, mapped: { workspace: string; patch: Record<string, unknown> }) => { stripe.applied.push(mapped); return 'ok'; } };
});

const { createApp } = await import('../src/app');
const { MemoryStore } = await import('../src/store');
const { trialDate, trialOffered, trialReturnBase } = await import('../src/trial');

let store: InstanceType<typeof MemoryStore>;
let app: ReturnType<typeof createApp>;
let workspace: string;

beforeEach(async () => {
  stripe.publishableKey = 'pk_test_x';
  stripe.created.length = 0;
  stripe.applied.length = 0;
  stripe.state = { workspace: null, status: 'open', subscription: null };
  store = new MemoryStore();
  app = createApp(store);
  const ev = createEvent({ type: 'workspace.created', source: formatAddress({ kind: 'human', id: 'u-owner' }), target: 'resource/workspace/acme', workspace: 'acme', payload: {} });
  ({ workspaceId: workspace } = await store.createWorkspace({ name: 'Acme', slug: 'acme', createdBy: 'u-owner' }, ev));
});

const post = (path: string, body: object, opts: { actor?: object; origin?: string } = {}) => app.request(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(opts.actor ?? { kind: 'human', id: 'u-owner' }), ...(opts.origin ? { origin: opts.origin } : {}) },
  body: JSON.stringify(body),
});

describe('who is offered the card trial', () => {
  it('a trial workspace that never had a subscription, and nobody else', () => {
    expect(trialOffered({ plan: 'free', stripeSubscriptionId: null })).toBe(true);
    expect(trialOffered({ plan: 'cloud', stripeSubscriptionId: null })).toBe(false);
    expect(trialOffered({ plan: 'free', stripeSubscriptionId: 'sub_old' })).toBe(false); // had Pro once
    expect(trialOffered(null)).toBe(false);
  });

  it('a workspace on Pro gets no session (a past subscription: trial.pg.test.ts)', async () => {
    await store.setWorkspacePlan(workspace, { plan: 'cloud' });
    expect(await (await post('/v1/billing/trial', { workspace })).json()).toEqual({ trial: false, plan: 'cloud' });
    expect(stripe.created).toHaveLength(0);
  });

  it('a stranger is refused before Stripe is asked anything', async () => {
    const res = await post('/v1/billing/trial', { workspace }, { actor: { kind: 'human', id: 'u-stranger' } });
    expect(res.status).toBe(403);
    expect(stripe.created).toHaveLength(0);
  });

  it('a server without the publishable key answers as unconfigured, so the step stays off', async () => {
    stripe.publishableKey = null;
    const res = await post('/v1/billing/trial', { workspace });
    expect(res.status).toBe(404);
    expect(stripe.created).toHaveLength(0);
  });
});

describe('the session the form draws against', () => {
  it('carries the workspace, its seats and a return to the hq that asked', async () => {
    const res = await post('/v1/billing/trial', { workspace }, { origin: 'https://hq.neuramesh.app' });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ trial: true, session: 'cs_test_1', clientSecret: 'cs_test_1_secret', publishableKey: 'pk_test_x', days: 14, seatUsd: 22 });
    const days = (Date.parse(String(body['endsAt'])) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    expect(stripe.created[0]).toMatchObject({ workspace, quantity: 1, customerId: null, returnUrl: 'https://hq.neuramesh.app/?pro_session={CHECKOUT_SESSION_ID}' });
  });

  it('a person comes back to hq or a local dev server, never to an address a request names', () => {
    expect(trialReturnBase('https://hq.neuramesh.app')).toBe('https://hq.neuramesh.app');
    expect(trialReturnBase('http://localhost:5202')).toBe('http://localhost:5202');
    expect(trialReturnBase('http://127.0.0.1:5202')).toBe('http://127.0.0.1:5202');
    expect(trialReturnBase('https://evil.example')).toBe('https://hq.neuramesh.app');
    expect(trialReturnBase('https://hq.neuramesh.app.evil.example')).toBe('https://hq.neuramesh.app');
    expect(trialReturnBase(undefined)).toBe('https://hq.neuramesh.app');
  });

  it('dates read as a person writes them', () => {
    expect(trialDate('2026-10-17T09:00:00.000Z')).toBe('Oct 17');
  });
});

describe('the read after the form', () => {
  const trialing = (ws: string) => ({
    id: 'sub_1', customer: 'cus_1', status: 'trialing', trial_end: 1792195200, metadata: { workspace_id: ws }, items: { data: [{ quantity: 1, current_period_end: 1792195200 }] },
  });

  it('flips the plan on Stripe’s word: a complete session with a trialing subscription', async () => {
    stripe.state = { workspace, status: 'complete', subscription: trialing(workspace) };
    const res = await post('/v1/billing/trial/sync', { workspace, session: 'cs_test_1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: 'cloud', status: 'trialing', trialEnd: new Date(1792195200 * 1000).toISOString() });
    expect(stripe.applied).toHaveLength(1);
    expect(stripe.applied[0]).toMatchObject({ workspace, patch: { plan: 'cloud', subscriptionStatus: 'trialing', stripeSubscriptionId: 'sub_1', seats: 1 } });
  });

  it('an open session changes nothing', async () => {
    stripe.state = { workspace, status: 'open', subscription: null };
    expect(await (await post('/v1/billing/trial/sync', { workspace, session: 'cs_test_1' })).json()).toEqual({ plan: 'free', status: 'open' });
    expect(stripe.applied).toHaveLength(0);
  });

  it('another workspace’s session, or a subscription that names another workspace, is refused', async () => {
    stripe.state = { workspace: 'ws-other', status: 'complete', subscription: trialing('ws-other') };
    expect((await post('/v1/billing/trial/sync', { workspace, session: 'cs_other' })).status).toBe(403);
    stripe.state = { workspace, status: 'complete', subscription: trialing('ws-other') };
    expect((await post('/v1/billing/trial/sync', { workspace, session: 'cs_mixed' })).status).toBe(403);
    expect(stripe.applied).toHaveLength(0);
  });

  it('a read with no session is a 400, and a stranger is refused', async () => {
    expect((await post('/v1/billing/trial/sync', { workspace })).status).toBe(400);
    expect((await post('/v1/billing/trial/sync', { workspace, session: 'cs_test_1' }, { actor: { kind: 'human', id: 'u-stranger' } })).status).toBe(403);
  });
});
