// Stripe billing for the Cloud plan. Gated on STRIPE_SECRET_KEY — absent, every entry is a hard
// no-op (OSS/local/CI/echo never touch Stripe), mirroring analytics.ts. The plan lives on the
// WORKSPACE; this module never decides entitlements (handler.ts does) — it only (a) mints hosted
// Checkout/Portal URLs and (b) turns Stripe lifecycle events into a setWorkspacePlan patch. The
// webhook is the ONLY writer of workspaces.plan, so a client can never grant itself Cloud.
import Stripe from 'stripe';

const SECRET = process.env['STRIPE_SECRET_KEY'];
const WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET'];
const PRICE_ID = process.env['STRIPE_PRICE_ID']; // the $22/seat recurring price (per-unit → quantity = seats)
const RETURN_BASE = process.env['NM_BILLING_RETURN_URL'] ?? 'https://neuramesh.app/billing';

export function billingEnabled(): boolean {
  return !!SECRET;
}

let _stripe: Stripe | null = null;
function stripe(): Stripe {
  if (!SECRET) throw new Error('billing not configured (STRIPE_SECRET_KEY unset)');
  if (!_stripe) _stripe = new Stripe(SECRET);
  return _stripe;
}

/**
 * SEATS FOLLOW THE ROSTER (review F4b, 2026-09-12). Pro is priced per seat and the quantity used
 * to be set once, at checkout, from the member count of that moment — a workspace that then
 * invited nine people paid for one seat until somebody opened the Customer Portal by hand.
 * This pushes the live member count onto the subscription's one item, prorated. Stripe's
 * inbound quantity on the next `customer.subscription.updated` stays the writer of
 * `workspaces.seats`, so a failed push is visible as a mismatch, never a silent overwrite.
 * Behind its own function so the roster hooks (seats.ts) can be tested with Stripe mocked.
 */
export async function setSubscriptionSeats(subscriptionId: string, seats: number): Promise<void> {
  const s = stripe();
  const sub = await s.subscriptions.retrieve(subscriptionId);
  const item = sub.items.data[0];
  if (!item) throw new Error(`subscription ${subscriptionId} has no items`);
  await s.subscriptions.update(subscriptionId, { items: [{ id: item.id, quantity: seats }], proration_behavior: 'create_prorations' });
}

// Hosted Checkout for the workspace's Cloud subscription. quantity = seats. client_reference_id +
// subscription metadata both carry the workspace id so the webhook can map the event back to it.
export async function createCheckoutSession(input: { workspace: string; quantity: number; customerId: string | null }): Promise<string> {
  if (!PRICE_ID) throw new Error('billing not configured (STRIPE_PRICE_ID unset)');
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: PRICE_ID, quantity: Math.max(1, input.quantity) }],
    client_reference_id: input.workspace,
    ...(input.customerId ? { customer: input.customerId } : {}),
    subscription_data: { metadata: { workspace_id: input.workspace } },
    allow_promotion_codes: true,
    success_url: `${RETURN_BASE}/success?ws=${encodeURIComponent(input.workspace)}`,
    cancel_url: `${RETURN_BASE}/cancel`,
  });
  if (!session.url) throw new Error('stripe returned no checkout url');
  return session.url;
}

// Stripe-hosted Customer Portal: manage payment method, seats, invoices, cancel.
export async function createPortalSession(input: { customerId: string }): Promise<string> {
  const session = await stripe().billingPortal.sessions.create({ customer: input.customerId, return_url: `${RETURN_BASE}/portal-return` });
  return session.url;
}

export function constructWebhookEvent(rawBody: string, signature: string): Stripe.Event {
  if (!WEBHOOK_SECRET) throw new Error('billing not configured (STRIPE_WEBHOOK_SECRET unset)');
  return stripe().webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
}

export interface PlanPatch {
  plan?: string;
  seats?: number;
  subscriptionStatus?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: string | null;
}

// past_due keeps Cloud access (grace) until the subscription is actually canceled/unpaid.
const CLOUD_STATUSES = new Set(['active', 'trialing', 'past_due']);

// PURE: a Stripe lifecycle event → { workspace, plan patch } (or null to ignore). No env, no client,
// no I/O — this is the unit-testable core and the single place plan transitions are decided. The
// workspace id rides on client_reference_id (checkout) and subscription metadata (lifecycle).
// `object: unknown` so a real Stripe.Event (typed union) assigns here; tests pass minimal literals.
type BillingEventLike = { type: string; data: { object: unknown } };

export function planPatchFromEvent(event: BillingEventLike): { workspace: string; patch: PlanPatch } | null {
  const obj = event.data.object as Record<string, unknown>;
  const metaWorkspace = (obj['metadata'] as Record<string, unknown> | undefined)?.['workspace_id'] as string | undefined;

  if (event.type === 'checkout.session.completed') {
    // a CREDIT-PACK purchase completes through the same event with mode 'payment'. It must
    // NEVER touch the plan — without this guard, buying a $5 pack on free flipped the
    // workspace to Cloud, which is a plan grant for a hundredth of the price.
    if ((obj['mode'] as string) === 'payment') return null;
    const workspace = (obj['client_reference_id'] as string) || metaWorkspace;
    if (!workspace) return null;
    return {
      workspace,
      patch: {
        plan: 'cloud',
        subscriptionStatus: 'active',
        stripeCustomerId: (obj['customer'] as string) ?? null,
        stripeSubscriptionId: (obj['subscription'] as string) ?? null,
      },
    };
  }

  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    if (!metaWorkspace) return null;
    const status = event.type === 'customer.subscription.deleted' ? 'canceled' : (obj['status'] as string);
    const item0 = (obj['items'] as { data?: Array<{ quantity?: number; current_period_end?: number }> } | undefined)?.data?.[0];
    const quantity = item0?.quantity;
    // current_period_end moved from the subscription onto the subscription ITEM in newer Stripe API
    // versions (2025+); read the top-level first, then fall back to the item.
    const periodEnd = (obj['current_period_end'] as number | undefined) ?? item0?.current_period_end;
    return {
      workspace: metaWorkspace,
      patch: {
        plan: CLOUD_STATUSES.has(status) ? 'cloud' : 'free',
        subscriptionStatus: status,
        ...(quantity ? { seats: quantity } : {}),
        ...(periodEnd ? { currentPeriodEnd: new Date(periodEnd * 1000).toISOString() } : {}),
        stripeCustomerId: (obj['customer'] as string) ?? null,
        stripeSubscriptionId: (obj['id'] as string) ?? null,
      },
    };
  }

  return null;
}

// ── credit packs (credits round, 2026-08-31) ────────────────────────────────────────────────

/** one-time Checkout for a credit pack — any plan, free included: buying credits must never
 *  require an upgrade. metadata carries what the webhook needs to grant, and `kind` is the
 *  discriminator that keeps planPatchFromEvent's hands off it. */
export async function createCreditsCheckout(input: {
  workspace: string; credits: number; usd: number; customerId: string | null;
}): Promise<string> {
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: input.usd * 100,
        product_data: { name: `${input.credits.toLocaleString('en-US')} NeuraMesh credits` },
      },
      quantity: 1,
    }],
    client_reference_id: input.workspace,
    ...(input.customerId ? { customer: input.customerId } : {}),
    metadata: { workspace_id: input.workspace, kind: 'credit_pack', credits: String(input.credits) },
    success_url: `${RETURN_BASE}/success?ws=${encodeURIComponent(input.workspace)}&credits=${input.credits}`,
    // `/cancel`, matching the subscription checkout above and apps/web's route table. `/canceled`
    // was a guess and the web app never routed it, so abandoning a pack landed on a dead page.
    cancel_url: `${RETURN_BASE}/cancel`,
  });
  if (!session.url) throw new Error('stripe returned no checkout url');
  return session.url;
}

/** PURE: a webhook event → a credit grant to make, or null. The session id rides back as the
 *  idempotency note — Stripe redelivers, and a replay must not double-grant. */
export function creditGrantFromEvent(event: BillingEventLike): { workspace: string; credits: number; sessionId: string } | null {
  // `completed` is the card path (it arrives already paid). An async method — bank debit,
  // voucher — completes UNPAID and settles minutes or days later under
  // `async_payment_succeeded`. Both are accepted and both are then held to payment_status
  // below, so enabling such a method later cannot start handing out unpaid credits. Taking
  // both events is safe precisely because the session id dedupes the grant.
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return null;
  const obj = event.data.object as Record<string, unknown>;
  if ((obj['mode'] as string) !== 'payment') return null;
  // THE MONEY MUST HAVE SETTLED. Completion is not payment.
  if ((obj['payment_status'] as string) !== 'paid') return null;
  const meta = (obj['metadata'] as Record<string, unknown> | undefined) ?? {};
  if (meta['kind'] !== 'credit_pack') return null;
  const workspace = (meta['workspace_id'] as string) || (obj['client_reference_id'] as string);
  const credits = Number(meta['credits']);
  if (!workspace || !Number.isFinite(credits) || credits <= 0) return null;
  // the session id IS the idempotency key downstream, and the ledger only dedupes on a
  // TRUTHY note — so an id-less event must not grant at all rather than grant unguarded and
  // double up on the redelivery.
  const sessionId = String(obj['id'] ?? '');
  if (!sessionId) return null;
  return { workspace, credits, sessionId };
}
