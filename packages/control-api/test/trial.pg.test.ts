// the card trial against the REAL schema: the offer reads the workspace row, the read after the
// form and the webhook flip the plan once between them (one grant, the status `trialing`), and the
// 3-day notice queues one email to the owner however often Stripe delivers it.
// run via scripts/test-pg.sh, skipped without DATABASE_URL.
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { planPatchFromEvent } from '../src/billing';
import { executeCommand } from '../src/handler';
import { PostgresStore } from '../src/pgstore';
import { applyPlanPatch } from '../src/plan-flip';
import { trialOffered, trialReminder } from '../src/trial';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const sql = DB ? postgres(DB) : null;

afterAll(async () => { await sql?.end(); await store?.close(); });

async function owner(tag: string): Promise<{ userId: string; workspaceId: string; email: string }> {
  const email = `trial-${tag}@sign.test`;
  const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${`clerk_trial_${tag}`}, ${email}) returning id`;
  const userId = row!['id'] as string;
  const made = (await executeCommand(store!, { kind: 'human', id: userId }, { type: 'workspace.create', name: `Trial ${tag}`, slug: `trial-${tag}` })) as unknown as { workspaceId: string };
  return { userId, workspaceId: made.workspaceId, email };
}

const subscription = (workspaceId: string, id: string) => ({
  id, customer: `cus_${id}`, status: 'trialing', trial_end: 1792195200,
  metadata: { workspace_id: workspaceId }, items: { data: [{ quantity: 1, current_period_end: 1792195200 }] },
});

describe.skipIf(!DB)('the card trial (postgres)', () => {
  it('is offered to a new workspace, and not once it has had a subscription', async () => {
    const { workspaceId } = await owner(`offer-${Date.now().toString(36)}`);
    const fresh = await store!.workspaceForBilling(workspaceId);
    expect(fresh).toMatchObject({ plan: 'free', stripeSubscriptionId: null, memberCount: 1 });
    expect(trialOffered(fresh)).toBe(true);
    await store!.setWorkspacePlan(workspaceId, { plan: 'free', stripeSubscriptionId: 'sub_cancelled' });
    expect(trialOffered(await store!.workspaceForBilling(workspaceId))).toBe(false);
  });

  it('the read after the form and the webhook flip the plan once: trialing, one 1,500 grant', async () => {
    const tag = Date.now().toString(36);
    const { workspaceId } = await owner(`flip-${tag}`);
    const sub = subscription(workspaceId, `sub_flip_${tag}`);
    const mapped = planPatchFromEvent({ type: 'customer.subscription.updated', data: { object: sub } })!;
    expect(await applyPlanPatch(store!, mapped)).toBe('ok'); // the sync route
    const again = planPatchFromEvent({ type: 'customer.subscription.created', data: { object: sub } })!;
    expect(await applyPlanPatch(store!, again)).toBe('ok'); // the webhook, later
    const [w] = await sql!`select plan, subscription_status, stripe_subscription_id, current_period_end from workspaces where id = ${workspaceId}::uuid`;
    expect(w).toMatchObject({ plan: 'cloud', subscription_status: 'trialing', stripe_subscription_id: sub.id });
    expect(new Date(w!['current_period_end'] as string).toISOString()).toBe(new Date(1792195200 * 1000).toISOString());
    const [g] = await sql!`select count(*)::int as c, coalesce(sum(micros), 0)::bigint as micros from credit_grants where workspace_id = ${workspaceId}::uuid and kind = 'promo'`;
    expect(Number(g!['c'])).toBe(1);
    expect(Number(g!['micros'])).toBe(1500 * 10_000);
  });

  it('the 3-day notice queues one email to the owner, however often Stripe delivers it', async () => {
    const tag = Date.now().toString(36);
    const { workspaceId, email } = await owner(`remind-${tag}`);
    const event = { type: 'customer.subscription.trial_will_end', data: { object: subscription(workspaceId, `sub_remind_${tag}`) } };
    await trialReminder(store!, event);
    await trialReminder(store!, event); // a redelivery
    const rows = await sql!`select to_email, template, kind, subject from emails where dedupe_key = ${`trial_ending:sub_remind_${tag}`}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ to_email: email, template: 'trialEnding', kind: 'transactional' });
    expect(rows[0]!['subject']).toMatch(/^Your Pro trial ends on [A-Z][a-z]{2} \d{1,2}$/);
  });
});
