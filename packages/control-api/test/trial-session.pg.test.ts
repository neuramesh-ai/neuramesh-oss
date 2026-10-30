import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, describe, expect, it, vi } from 'vitest';

const stripe = vi.hoisted(() => ({ created: 0, status: 'open', keys: [] as string[] }));
vi.mock('../src/billing', () => ({
  createTrialSession: async (_input: unknown, key: string) => {
    stripe.keys.push(key);
    return { id: `cs_${++stripe.created}`, clientSecret: 'test_secret' };
  },
  readTrialSession: async (id: string) => ({ id, clientSecret: 'test_secret', status: stripe.status, subscription: null }),
}));
const { workspaceTrialSession } = await import('../src/trial-session');
const sql = process.env['DATABASE_URL'] ? postgres(process.env['DATABASE_URL']) : null;
afterAll(async () => { await sql?.end(); });

describe.skipIf(!sql)('durable trial checkout', () => {
  it('shares one checkout across concurrent tabs and restart, replaces only expiration, and retains completion', async () => {
    const workspace = randomUUID();
    const [user] = await sql!`insert into nm_users (clerk_user_id, email) values (${`session-${workspace}`}, ${`${workspace}@activation.test`}) returning id`;
    await sql!`insert into workspaces (id, name, slug, created_by) values (${workspace}, 'Trial session test', ${`trial-session-${workspace}`}, ${user!.id})`;
    const input = { workspace, quantity: 1, customerId: null, email: null, returnUrl: 'http://localhost:5304/' };
    const [a, b] = await Promise.all([workspaceTrialSession(sql!, input), workspaceTrialSession(sql!, input)]);
    expect(a.id).toBe(b.id);
    expect(stripe.created).toBe(1);
    expect((await workspaceTrialSession(sql!, input)).id).toBe(a.id);
    stripe.status = 'expired';
    const replacement = await workspaceTrialSession(sql!, input);
    expect(replacement.id).not.toBe(a.id);
    expect(stripe.keys[1]).toBe(`trial:${workspace}:${a.id}`);
    stripe.status = 'complete';
    expect((await workspaceTrialSession(sql!, input)).status).toBe('complete');
    expect(stripe.created).toBe(2);
  });
});
