// The single place plan transitions are decided: Stripe lifecycle event → workspaces.plan patch.
// Pure (no Stripe client, no env), so it's driven with minimal event literals.
import { describe, expect, it } from 'vitest';
import { creditGrantFromEvent, planPatchFromEvent } from '../src/billing';

describe('planPatchFromEvent — Stripe lifecycle → workspace plan patch', () => {
  it('checkout.session.completed → cloud, carrying the customer + subscription ids (workspace via client_reference_id)', () => {
    const r = planPatchFromEvent({
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'ws_1', customer: 'cus_1', subscription: 'sub_1' } },
    });
    expect(r).toEqual({ workspace: 'ws_1', patch: { plan: 'cloud', subscriptionStatus: 'active', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' } });
  });

  it('customer.subscription.updated (active) → cloud with seats + period end (workspace via subscription metadata)', () => {
    const r = planPatchFromEvent({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { workspace_id: 'ws_1' }, items: { data: [{ quantity: 4 }] }, current_period_end: 1893456000 } },
    });
    expect(r?.workspace).toBe('ws_1');
    expect(r?.patch.plan).toBe('cloud');
    expect(r?.patch.seats).toBe(4);
    expect(r?.patch.subscriptionStatus).toBe('active');
    expect(r?.patch.currentPeriodEnd).toBe(new Date(1893456000 * 1000).toISOString());
  });

  it('reads seats + period end from the subscription ITEM (newer Stripe API moved current_period_end there)', () => {
    const r = planPatchFromEvent({
      type: 'customer.subscription.updated',
      data: { object: { id: 's', customer: 'c', status: 'active', metadata: { workspace_id: 'ws_1' }, items: { data: [{ quantity: 2, current_period_end: 1893456000 }] } } },
    });
    expect(r?.patch.seats).toBe(2);
    expect(r?.patch.currentPeriodEnd).toBe(new Date(1893456000 * 1000).toISOString());
  });

  it('past_due keeps Cloud (grace); deleted → free + canceled', () => {
    const grace = planPatchFromEvent({
      type: 'customer.subscription.updated',
      data: { object: { id: 's', customer: 'c', status: 'past_due', metadata: { workspace_id: 'ws_1' }, items: { data: [] } } },
    });
    expect(grace?.patch.plan).toBe('cloud');
    const del = planPatchFromEvent({
      type: 'customer.subscription.deleted',
      data: { object: { id: 's', customer: 'c', metadata: { workspace_id: 'ws_1' }, items: { data: [] } } },
    });
    expect(del?.patch.plan).toBe('free');
    expect(del?.patch.subscriptionStatus).toBe('canceled');
  });

  it('ignores unrelated events and events with no resolvable workspace', () => {
    expect(planPatchFromEvent({ type: 'invoice.paid', data: { object: {} } })).toBeNull();
    expect(planPatchFromEvent({ type: 'checkout.session.completed', data: { object: {} } })).toBeNull();
    expect(planPatchFromEvent({ type: 'customer.subscription.updated', data: { object: { status: 'active' } } })).toBeNull();
  });
});

// ── credit packs: the money path (2026-08-31) ────────────────────────────────────────────────
//
// This mapper had NO test at all, which is how three defects reached a green PR: it granted on
// completion rather than payment, it accepted an id-less event that the ledger cannot dedupe,
// and it ignored the async-settlement event entirely. The webhook that calls it answered Stripe
// 200 on failure, so a charge could land with no credits and no retry.
describe('creditGrantFromEvent — a paid pack becomes a grant, and nothing else does', () => {
  const paidSession = (over: Record<string, unknown> = {}) => ({
    id: 'cs_test_1', mode: 'payment', payment_status: 'paid',
    metadata: { kind: 'credit_pack', workspace_id: 'ws_1', credits: '500' },
    ...over,
  });

  it('a paid credit_pack session grants, carrying the session id as the idempotency key', () => {
    const r = creditGrantFromEvent({ type: 'checkout.session.completed', data: { object: paidSession() } });
    expect(r).toEqual({ workspace: 'ws_1', credits: 500, sessionId: 'cs_test_1' });
  });

  it('async settlement grants too — the same session id keeps the retry from double-granting', () => {
    const r = creditGrantFromEvent({ type: 'checkout.session.async_payment_succeeded', data: { object: paidSession() } });
    expect(r?.sessionId).toBe('cs_test_1');
  });

  // THE ONE THAT COSTS MONEY THE WRONG WAY: completion is not payment.
  it('an UNPAID session never grants, however complete it claims to be', () => {
    expect(creditGrantFromEvent({ type: 'checkout.session.completed', data: { object: paidSession({ payment_status: 'unpaid' }) } })).toBeNull();
    expect(creditGrantFromEvent({ type: 'checkout.session.completed', data: { object: paidSession({ payment_status: undefined }) } })).toBeNull();
  });

  // an id-less event cannot be deduped by the ledger (it only dedupes on a TRUTHY note), so a
  // redelivery would grant twice. Refusing is the safe direction.
  it('refuses a session with no id rather than granting something a replay would double', () => {
    expect(creditGrantFromEvent({ type: 'checkout.session.completed', data: { object: paidSession({ id: undefined }) } })).toBeNull();
  });

  it('ignores subscription checkouts and any non-pack payment', () => {
    expect(creditGrantFromEvent({ type: 'checkout.session.completed', data: { object: paidSession({ mode: 'subscription' }) } })).toBeNull();
    expect(creditGrantFromEvent({ type: 'checkout.session.completed', data: { object: paidSession({ metadata: { kind: 'something_else', workspace_id: 'ws_1', credits: '500' } }) } })).toBeNull();
    expect(creditGrantFromEvent({ type: 'invoice.paid', data: { object: paidSession() } })).toBeNull();
  });

  it('refuses a malformed credit count instead of granting zero or NaN', () => {
    for (const credits of ['0', '-5', 'abc', undefined]) {
      expect(creditGrantFromEvent({ type: 'checkout.session.completed', data: { object: paidSession({ metadata: { kind: 'credit_pack', workspace_id: 'ws_1', credits } }) } })).toBeNull();
    }
  });

  it('falls back to client_reference_id for the workspace, and refuses when neither names one', () => {
    const viaRef = creditGrantFromEvent({ type: 'checkout.session.completed', data: { object: paidSession({ metadata: { kind: 'credit_pack', credits: '500' }, client_reference_id: 'ws_ref' }) } });
    expect(viaRef?.workspace).toBe('ws_ref');
    expect(creditGrantFromEvent({ type: 'checkout.session.completed', data: { object: paidSession({ metadata: { kind: 'credit_pack', credits: '500' } }) } })).toBeNull();
  });

  // the two mappers must never both fire on one event: a $5 pack must not upgrade the plan.
  it('a credit pack is NOT a plan change — planPatchFromEvent refuses the same event', () => {
    const ev = { type: 'checkout.session.completed' as const, data: { object: paidSession() } };
    expect(creditGrantFromEvent(ev)).not.toBeNull();
    expect(planPatchFromEvent(ev)).toBeNull();
  });
});
