// the card trial (George, 2026-10-03, docs/design/pro-front-door-2026-10 §the card step). a hosted
// workspace on the Pro trial adds a payment method inside hq, in its own wizard step or on the Pro
// sheet, and is Pro at once: $0 for PRO_TRIAL_DAYS, then Stripe charges the seat price. three
// small pieces:
//   · POST /v1/billing/trial mints the `custom` UI mode session the page draws its form against.
//   · POST /v1/billing/trial/sync reads that session back from Stripe after the form and applies
//     the plan the webhook would apply. the page shows "Welcome to Pro" on server truth, never on
//     the form's own word, and never waits on webhook delivery.
//   · trialReminder sends the email the form promises, 3 days before the first charge.
import type { Env, Hono } from 'hono';
import { PRO_SEAT_USD, PRO_TRIAL_DAYS, renderTrialEnding, type Actor } from '@neuramesh/shared';
import { billingPublishableKey, createTrialSession, planPatchFromEvent, trialReminderFromEvent, trialSessionState } from './billing';
import { billingCaller, sqlOf } from './credits';
import { LIFECYCLE_LINKS } from './lifecycle';
import { HQ_URL } from './mail';
import { queueAndSend } from './onauth';
import { applyPlanPatch } from './plan-flip';
import type { Store } from './store';

/** one trial a workspace: offered while it is on the trial plan and has never had a subscription.
 *  a workspace that had Pro and cancelled sees the plain price instead (hq's older sheet). */
export function trialOffered(w: { plan: string; stripeSubscriptionId: string | null } | null): boolean {
  return !!w && w.plan !== 'cloud' && !w.stripeSubscriptionId;
}

/** where a method that leaves the page brings the person back: the hq that asked (hq.neuramesh.app,
 *  or a local dev server), else hq itself. never an address the request merely names. */
export function trialReturnBase(origin: string | undefined): string {
  const hq = new URL(HQ_URL).origin;
  if (origin && (origin === hq || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) return origin;
  return hq;
}

/** "Oct 17": the date words the form, the welcome and the email share */
export const trialDate = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function trialRoutes<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store): void {
  app.post('/v1/billing/trial', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { workspace?: string };
    const actor = c.get('actor');
    const who = await billingCaller(store, actor, body.workspace);
    if ('refusal' in who) return c.json(who.refusal, who.status);
    const publishableKey = billingPublishableKey();
    if (!publishableKey) return c.json({ error: 'billing not configured', code: 'NOT_FOUND' }, 404);
    const info = await store.workspaceForBilling(who.workspace);
    if (!info || !trialOffered(info)) return c.json({ trial: false, plan: info?.plan ?? 'free' });
    const email = (await store.userIdentity(actor.id))?.email ?? null;
    const session = await createTrialSession({
      workspace: who.workspace, quantity: info.memberCount, customerId: info.stripeCustomerId, email,
      returnUrl: `${trialReturnBase(c.req.header('origin'))}/?pro_session={CHECKOUT_SESSION_ID}`,
    });
    return c.json({
      trial: true, session: session.id, clientSecret: session.clientSecret, publishableKey,
      days: PRO_TRIAL_DAYS, seatUsd: PRO_SEAT_USD, endsAt: new Date(Date.now() + PRO_TRIAL_DAYS * 86_400_000).toISOString(),
    });
  });

  app.post('/v1/billing/trial/sync', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { workspace?: string; session?: string };
    const who = await billingCaller(store, c.get('actor'), body.workspace);
    if ('refusal' in who) return c.json(who.refusal, who.status);
    if (!body.session) return c.json({ error: 'session required', code: 'INVALID_INPUT' }, 400);
    const s = await trialSessionState(body.session);
    // the session must be this workspace's, so nobody flips a workspace with another one's payment
    if (s.workspace !== who.workspace) return c.json({ error: 'not this workspace’s session', code: 'NOT_PERMITTED' }, 403);
    if (s.status !== 'complete' || !s.subscription) return c.json({ plan: 'free', status: s.status });
    // the subscription event the webhook will also deliver: one mapper, one flip, and the grant's
    // dedupe (the subscription id) keeps the second arrival from granting twice
    const mapped = planPatchFromEvent({ type: 'customer.subscription.updated', data: { object: s.subscription } });
    if (!mapped || mapped.workspace !== who.workspace) return c.json({ error: 'the subscription names another workspace', code: 'NOT_PERMITTED' }, 403);
    const applied = await applyPlanPatch(store, mapped);
    if (applied === 'unavailable') return c.json({ error: 'credit ledger unavailable', code: 'LEDGER_UNAVAILABLE' }, 503);
    if (applied === 'failed') return c.json({ error: 'credit grant failed', code: 'GRANT_FAILED' }, 500);
    const end = s.subscription['trial_end'] as number | undefined;
    return c.json({ plan: mapped.patch.plan, status: mapped.patch.subscriptionStatus, trialEnd: end ? new Date(end * 1000).toISOString() : null });
  });
}

/** the webhook's reminder branch: Stripe's `trial_will_end` → one email to the workspace owner. a
 *  failed send leaves its outbox row (queueAndSend) and never fails the webhook. */
export async function trialReminder(store: Store, event: { type: string; data: { object: unknown } }): Promise<void> {
  const r = trialReminderFromEvent(event);
  const sql = r ? sqlOf(store) : null;
  if (!r || !sql) return;
  try {
    const [owner] = await sql<{ user_id: string; name: string }[]>`
      select m.user_id, w.name from workspace_members m join workspaces w on w.id = m.workspace_id
       where m.workspace_id = ${r.workspace}::uuid and m.role = 'owner' limit 1`;
    const email = owner ? (await store.userIdentity(owner.user_id))?.email : null;
    if (!owner || !email) return;
    const rendered = renderTrialEnding({ workspace: owner.name, endsOn: trialDate(r.trialEnd), seats: r.seats, seatUsd: PRO_SEAT_USD, manageUrl: LIFECYCLE_LINKS.credits });
    await queueAndSend(store, {
      workspace: r.workspace, userId: owner.user_id, toEmail: email, template: 'trialEnding',
      kind: 'transactional', dedupeKey: `trial_ending:${r.subscriptionId}`,
    }, rendered, null);
  } catch (e) {
    console.error(`trial_reminder_failed workspace=${r.workspace}: ${e instanceof Error ? e.message : e}`);
  }
}
