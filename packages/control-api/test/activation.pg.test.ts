import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { PostgresStore } from '../src/pgstore';
import { createApp } from '../src/app';
import { executeCommand } from '../src/handler';
import { applyPlanPatch } from '../src/plan-flip';
import { rowsToDesired, type CloudMachineRow } from '../src/fleet';
import { creditBalance, grantCredits } from '../src/credit-ledger';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const sql = DB ? postgres(DB) : null;
afterAll(async () => { await sql?.end(); await store?.close(); });
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => { vi.stubEnv('NM_REQUIRE_TRIAL_ACTIVATION', '1'); vi.stubEnv('NM_LOCAL', '0'); vi.stubEnv('FLEET_AUTOPROVISION', 'on'); });

async function workspace() {
  const tag = randomUUID().slice(0, 10);
  const [user] = await sql!`insert into nm_users (clerk_user_id, email) values (${`activation_${tag}`}, ${`${tag}@activation.test`}) returning id`;
  return (await executeCommand(store!, { kind: 'human', id: user!.id }, { type: 'workspace.create', name: tag, slug: `activation-${tag}` }) as unknown as { workspaceId: string }).workspaceId;
}
const activate = (workspace: string, subscriptionStatus = 'trialing') => applyPlanPatch(store!, { workspace,
  patch: { plan: 'cloud', subscriptionStatus, stripeSubscriptionId: `sub_${workspace}`, seats: 1 } });

describe.skipIf(!DB)('activation on the real database', () => {
  it('keeps setup dormant without credits before activation, then grants once across concurrent confirmations', async () => {
    const ws = await workspace();
    expect((await creditBalance(sql!, ws)).remainingMicros).toBe(0);
    expect(await sql!`select id from machines where workspace_id = ${ws}::uuid`).toHaveLength(1);
    expect(await store!.workspacePlan(ws)).toBe('free');
    expect(await activate(ws)).toBe('ok');
    await Promise.all([activate(ws), activate(ws)]);
    expect((await creditBalance(sql!, ws)).remainingMicros).toBe(500 * 10000);
    expect(await sql!`select id from machines where workspace_id = ${ws}::uuid and kind = 'runner'`).toHaveLength(1);
  });
  it('finishes signup without billing while crew metadata and cloud execution stay separate', async () => {
    const ws = await workspace();
    const [machine] = await sql!`select * from machines where workspace_id = ${ws}::uuid`;
    const [owner] = await sql!`select user_id from workspace_members where workspace_id = ${ws}::uuid and role = 'owner'`;
    await executeCommand(store!, { kind: 'human', id: owner!.user_id }, {
      type: 'agent.register', workspace: ws, machineId: machine!.id, name: 'rex', role: 'orchestrator',
      model: 'gemini-3.5-flash-lite', runtime: 'gemini', channels: ['general'],
    });
    expect((await store!.listWorkspaces(owner!.user_id)).find((w) => w.id === ws)?.onboarded).toBe(true);
    expect(rowsToDesired([{ ...machine!, workspace_plan: 'free' } as CloudMachineRow]).workspaces[0]?.machines[0]?.replicas).toBe(0);
    expect((await creditBalance(sql!, ws)).remainingMicros).toBe(0);
    const [saved] = await sql!`select plan, stripe_subscription_id from workspaces where id = ${ws}::uuid`;
    expect(saved).toMatchObject({ plan: 'free', stripe_subscription_id: null });
    await expect(executeCommand(store!, { kind: 'human', id: owner!.user_id }, {
      type: 'thread.unsettle', workspace: ws, threadId: randomUUID(),
    })).rejects.toMatchObject({ code: 'ACTIVATION_REQUIRED' });
  });
  it('requires an entitled canary workspace to create its artifact-reader task without allocating credits', async () => {
    const ws = await workspace();
    // The production canary seeds a stopped claim, unlike the signup helper's dormant claim.
    await sql!`update machines set lifecycle = 'stopped', desired_replicas = 0 where workspace_id = ${ws}::uuid`;
    const [owner] = await sql!`select user_id from workspace_members where workspace_id = ${ws}::uuid and role = 'owner'`;
    const [channel] = await sql!`select id from channels where workspace_id = ${ws}::uuid limit 1`;
    const actor = { kind: 'human' as const, id: owner!.user_id };
    const command = { type: 'task.create' as const, workspace: ws, channel: channel!.id, title: 'Brain artifact reader canary', kind: 'bug' as const };
    const request = () => createApp(store!).request('/v1/commands', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(command) });
    const denied = await request();
    expect(denied.status).toBe(402);
    expect(await denied.json()).toMatchObject({ code: 'ACTIVATION_REQUIRED' });
    // Match the isolated infrastructure fixture, without a Stripe event or a credit grant.
    await sql!`update workspaces set plan = 'cloud' where id = ${ws}::uuid`;
    const result = await request();
    expect(result.status, await result.clone().text()).toBe(200);
    expect(await result.json()).toMatchObject({ task: { title: command.title, workspace: ws } });
    expect((await creditBalance(sql!, ws)).remainingMicros).toBe(0);
    expect(await sql!`select id from machines where workspace_id = ${ws}::uuid and desired_replicas > 0`).toHaveLength(0);
  });
  it.each([50, 500])('preserves an existing %i-credit signup balance', async (credits) => {
    const ws = await workspace();
    await grantCredits(sql!, ws, credits, 'signup', 'legacy signup');
    await activate(ws);
    expect((await creditBalance(sql!, ws)).remainingMicros).toBe(credits * 10000);
  });
  it('does not activate on checkout metadata alone or double grant when the paid month starts', async () => {
    const ws = await workspace();
    await applyPlanPatch(store!, { workspace: ws, patch: { plan: 'cloud', stripeSubscriptionId: `sub_${ws}` } });
    expect(await store!.workspacePlan(ws)).toBe('free');
    expect((await creditBalance(sql!, ws)).remainingMicros).toBe(0);
    await activate(ws);
    await Promise.all([activate(ws, 'active'), activate(ws, 'active')]);
    expect((await creditBalance(sql!, ws)).remainingMicros).toBe(2000 * 10000);
  });
  it('does not regrant an existing paid subscription when the rollout switch turns on', async () => {
    const ws = await workspace();
    await grantCredits(sql!, ws, 1500, 'promo', `sub_${ws}`);
    await Promise.all([activate(ws, 'active'), activate(ws, 'active')]);
    expect((await creditBalance(sql!, ws)).remainingMicros).toBe(1500 * 10000);
  });
});
