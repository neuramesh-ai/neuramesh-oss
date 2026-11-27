// THE PRO TRIAL WITH NO CARD (docs/design/onboarding-2026-11/trial.md, George 2026-11-25). Every hosted
// sign-up starts on Pro. "Add a card later" in the first run, the phone's first run, and a workspace that
// never added a card (on its owner's next visit) all start a Stripe subscription in its trial with no
// payment method. The plan change itself is the card trial's: the subscription maps through
// planPatchFromEvent and applyPlanPatch, so the trial's 100 credits, the runner and the activation
// gate behave as they do for a card. Stripe cancels the subscription at the trial's end when no card
// came, and the webhook moves the workspace back to an inactive plan.
//   · POST /v1/billing/trial/start      the trial with no card, once for each person (nm_users.trial_claimed_at)
//   · POST /v1/billing/trial/card       a setup session: the form that adds a card during that trial
//   · POST /v1/billing/trial/card/sync  the card becomes the default, and the trial runs to 14 days from its start
import type { Env, Hono } from 'hono';
import type Stripe from 'stripe';
import { PRO_TRIAL_DAYS, PRO_TRIAL_DAYS_NO_CARD, type Actor } from '@neuramesh/shared';
import { billingPublishableKey, planPatchFromEvent, stripe } from './billing';
import { billingCaller, sqlOf } from './credits';
import { emailSelfAsserted } from './email-proof';
import { applyPlanPatch } from './plan-flip';
import type { Store } from './store';
import { trialOffered, trialReturnBase } from './trial';

const DAY = 86_400;
type Refusal = { error: string; code: string };

/** the new end of a trial when a card arrives: 14 days from its start, never earlier than the end it has */
export function trialEndWithCard(trialStart: number, trialEnd: number): number {
  return Math.max(trialEnd, trialStart + PRO_TRIAL_DAYS * DAY);
}

async function ownerOf(store: Store, actor: Actor, workspace: string): Promise<boolean> {
  const sql = sqlOf(store);
  if (!sql) return false;
  const [m] = await sql<{ role: string }[]>`select role from workspace_members where workspace_id = ${workspace}::uuid and user_id = ${actor.id}::uuid`;
  return m?.role === 'owner';
}

/** apply a subscription as the webhook would, and answer with what the page shows */
async function applySubscription(store: Store, workspace: string, sub: Stripe.Subscription): Promise<{ plan: string; status: string | null; trialEnd: string | null; cardOnFile: boolean } | null> {
  const mapped = planPatchFromEvent({ type: 'customer.subscription.updated', data: { object: sub } });
  if (!mapped || mapped.workspace !== workspace || (await applyPlanPatch(store, mapped)) !== 'ok') return null;
  return { plan: mapped.patch.plan ?? 'free', status: mapped.patch.subscriptionStatus ?? null,
    trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null, cardOnFile: !!mapped.patch.cardOnFile };
}

/** start the trial with no card: the claim, then Stripe, then the plan. Idempotent for the workspace. */
export async function startCardlessTrial(store: Store, actor: Actor, workspace: string): Promise<{ status: 200 | 403 | 409 | 503; body: Refusal | Record<string, unknown> }> {
  const sql = sqlOf(store);
  if (!sql) return { status: 503, body: { error: 'billing ledger unavailable', code: 'LEDGER_UNAVAILABLE' } };
  if (!(await ownerOf(store, actor, workspace))) return { status: 403, body: { error: 'only the owner starts the trial', code: 'NOT_PERMITTED' } };
  const info = await store.workspaceForBilling(workspace);
  if (!info || !trialOffered(info)) return { status: 200, body: { trial: false, plan: info?.plan ?? 'free' } };
  if (await emailSelfAsserted(store, actor.id)) return { status: 409, body: { error: 'Confirm your email to start the trial.', code: 'EMAIL_UNPROVEN' } };
  const claimed = await sql`update nm_users set trial_claimed_at = now() where id = ${actor.id}::uuid and trial_claimed_at is null returning id`;
  if (!claimed.length) return { status: 409, body: { error: 'You already used your Pro trial. Add a card to start Pro.', code: 'TRIAL_USED' } };
  try {
    const price = process.env['STRIPE_PRICE_ID'];
    if (!price) throw new Error('STRIPE_PRICE_ID unset');
    const email = (await store.userIdentity(actor.id))?.email ?? undefined;
    // the idempotency keys make a second tab, or a retry after a lost answer, find the same customer and subscription
    const customer = info.stripeCustomerId ?? (await stripe().customers.create({ ...(email ? { email } : {}), metadata: { workspace_id: workspace } },
      { idempotencyKey: `trial-cardless-customer:${workspace}` })).id;
    const sub = await stripe().subscriptions.create({
      customer, items: [{ price, quantity: Math.max(1, info.memberCount) }], trial_period_days: PRO_TRIAL_DAYS_NO_CARD,
      payment_settings: { save_default_payment_method: 'on_subscription' },
      trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      metadata: { workspace_id: workspace, trial: 'cardless' },
    }, { idempotencyKey: `trial-cardless:${workspace}` });
    const applied = await applySubscription(store, workspace, sub);
    if (!applied) return { status: 503, body: { error: 'The trial started. Your workspace updates in a moment.', code: 'ACTIVATION_PENDING' } };
    return { status: 200, body: { trial: true, ...applied } };
  } catch (e) {
    // nothing reached Stripe or the plan: the person keeps their one trial
    await sql`update nm_users set trial_claimed_at = null where id = ${actor.id}::uuid`.catch(() => {});
    console.error(`trial_cardless_failed workspace=${workspace}: ${e instanceof Error ? e.message : e}`);
    return { status: 503, body: { error: 'The trial did not start. Try again.', code: 'TRIAL_UNAVAILABLE' } };
  }
}

/** the card a trial with no card waits for: it becomes the subscription's default, and the trial runs to 14 days */
export async function attachTrialCard(store: Store, workspace: string, sessionId: string): Promise<{ plan: string; status: string | null; trialEnd: string | null; cardOnFile: boolean } | Refusal> {
  const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ['setup_intent'] });
  if (session.client_reference_id !== workspace || session.mode !== 'setup') return { error: 'not this workspace’s card', code: 'NOT_PERMITTED' };
  const intent = session.setup_intent as Stripe.SetupIntent | null;
  const pm = typeof intent?.payment_method === 'string' ? intent.payment_method : intent?.payment_method?.id;
  if (session.status !== 'complete' || !pm) return { error: 'The card is not added yet.', code: 'CARD_PENDING' };
  const sql = sqlOf(store)!;
  const [w] = await sql<{ stripe_subscription_id: string | null; stripe_customer_id: string | null }[]>`
    select stripe_subscription_id, stripe_customer_id from workspaces where id = ${workspace}::uuid`;
  if (!w?.stripe_subscription_id || !w.stripe_customer_id) return { error: 'This workspace has no trial.', code: 'NOT_FOUND' };
  const current = await stripe().subscriptions.retrieve(w.stripe_subscription_id);
  await stripe().customers.update(w.stripe_customer_id, { invoice_settings: { default_payment_method: pm } });
  const end = current.status === 'trialing' && current.trial_start && current.trial_end ? trialEndWithCard(current.trial_start, current.trial_end) : null;
  const sub = await stripe().subscriptions.update(w.stripe_subscription_id, {
    default_payment_method: pm, ...(end && end > (current.trial_end ?? 0) ? { trial_end: end, proration_behavior: 'none' as const } : {}),
  });
  return (await applySubscription(store, workspace, sub)) ?? { error: 'The card is added. Your workspace updates in a moment.', code: 'ACTIVATION_PENDING' };
}

export function cardlessTrialRoutes<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store): void {
  app.post('/v1/billing/trial/start', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { workspace?: string };
    const who = await billingCaller(store, c.get('actor'), body.workspace);
    if ('refusal' in who) return c.json(who.refusal, who.status);
    const r = await startCardlessTrial(store, c.get('actor'), who.workspace);
    return c.json(r.body, r.status);
  });

  app.post('/v1/billing/trial/card', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { workspace?: string };
    const who = await billingCaller(store, c.get('actor'), body.workspace);
    if ('refusal' in who) return c.json(who.refusal, who.status);
    const publishableKey = billingPublishableKey();
    const [w] = await sqlOf(store)!<{ stripe_customer_id: string | null; subscription_status: string | null; card_on_file: boolean }[]>`
      select stripe_customer_id, subscription_status, card_on_file from workspaces where id = ${who.workspace}::uuid`;
    if (!publishableKey || !w?.stripe_customer_id || w.subscription_status !== 'trialing' || w.card_on_file) {
      return c.json({ error: 'no trial waits for a card', code: 'NOT_FOUND' }, 404);
    }
    const session = await stripe().checkout.sessions.create({
      ui_mode: 'custom', mode: 'setup', currency: 'usd', customer: w.stripe_customer_id, client_reference_id: who.workspace,
      setup_intent_data: { metadata: { workspace_id: who.workspace, kind: 'trial_card' } },
      return_url: `${trialReturnBase(c.req.header('origin'))}/?pro_card={CHECKOUT_SESSION_ID}`,
    });
    return c.json({ session: session.id, clientSecret: session.client_secret, publishableKey });
  });

  app.post('/v1/billing/trial/card/sync', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { workspace?: string; session?: string };
    const who = await billingCaller(store, c.get('actor'), body.workspace);
    if ('refusal' in who) return c.json(who.refusal, who.status);
    if (!body.session) return c.json({ error: 'session required', code: 'INVALID_INPUT' }, 400);
    const r = await attachTrialCard(store, who.workspace, body.session);
    return 'code' in r ? c.json(r, r.code === 'NOT_PERMITTED' ? 403 : r.code === 'NOT_FOUND' ? 404 : 409) : c.json(r);
  });
}

/** the webhook's branch for a card that a page closed before its sync: a completed setup session of a trial */
export async function trialCardFromEvent(store: Store, event: { type: string; data: { object: unknown } }): Promise<void> {
  const o = event.data.object as { mode?: string; id?: string; client_reference_id?: string | null };
  if (event.type !== 'checkout.session.completed' || o.mode !== 'setup' || !o.id || !o.client_reference_id) return;
  try { await attachTrialCard(store, o.client_reference_id, o.id); }
  catch (e) { console.error(`trial_card_webhook_failed workspace=${o.client_reference_id}: ${e instanceof Error ? e.message : e}`); }
}
