// SIGN-UP DOORS (R10 lane A): NM-010 and NM-024, against the real schema.
//
// NM-010 — /auth/clerk/signup created a Clerk user whose address Clerk marks VERIFIED, so anyone
// could sign up as an invitee's address and accept their invitation. Now the account is
// self-asserted until it opens the link mailed to the address.
// NM-024 — "first workspace" was decided by current membership only, and workspace.delete cascades
// its grants, so delete-then-create funded a fresh first workspace every time.
//
// Clerk's Backend API is stubbed at the fetch layer. Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { executeCommand } from '../src/handler';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const saved = { key: process.env['CLERK_SECRET_KEY'], pk: process.env['CLERK_PUBLISHABLE_KEY'] };
const tag = randomBytes(4).toString('hex');

beforeAll(() => {
  process.env['CLERK_SECRET_KEY'] = 'sk_test_stub';
  process.env['CLERK_PUBLISHABLE_KEY'] = `pk_test_${Buffer.from('clerk.stub.test$').toString('base64')}`;
});
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => {
  for (const [k, v] of [['CLERK_SECRET_KEY', saved.key], ['CLERK_PUBLISHABLE_KEY', saved.pk]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await sql?.end(); await store?.close();
});

const PASSWORD = 'a-strong-password-1';
/** every DELETE of a Clerk user that the server sent */
const clerkDeletes: string[] = [];

/** Clerk's Backend API for one user whose address Clerk reports VERIFIED by the strategy `admin` (what
 *  it does for a Backend-API create), with the password check and the delete */
function stubClerk(clerkId: string, email: string): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: { method?: string; body?: string }) => {
    const u = String(url);
    const user = { id: clerkId, first_name: null, email_addresses: [{ id: 'e1', email_address: email, verification: { status: 'verified', strategy: 'admin' } }], primary_email_address_id: 'e1' };
    if (u === 'https://api.clerk.com/v1/users' && init?.method === 'POST') return json(200, user);
    if (u === `https://api.clerk.com/v1/users/${clerkId}` && init?.method === 'DELETE') { clerkDeletes.push(clerkId); return json(200, { deleted: true }); }
    if (u === `https://api.clerk.com/v1/users/${clerkId}`) return json(200, user);
    if (u === `https://api.clerk.com/v1/users/${clerkId}/verify_password`) return json(200, { verified: (JSON.parse(init?.body ?? '{}') as { password?: string }).password === PASSWORD });
    if (u.startsWith('https://api.clerk.com/v1/users?email_address=')) return json(200, [user]);
    if (u === 'https://api.clerk.com/v1/sign_in_tokens') return json(200, { token: 'sit_stub' });
    if (u.startsWith('https://clerk.stub.test/v1/client/sign_ins')) return json(200, { response: { status: 'complete', created_session_id: 'sess_1' } });
    throw new Error(`unexpected fetch in test: ${u}`);
  }));
}

async function owner(name: string): Promise<{ actor: Actor; ws: string }> {
  const [u] = await sql!`insert into nm_users (clerk_user_id, email) values (${`own_${name}_${tag}`}, ${`${name}-${tag}@doors.test`}) returning id`;
  const actor: Actor = { kind: 'human', id: u!['id'] as string };
  const made = (await executeCommand(store!, actor, { type: 'workspace.create', name: `${name} ${tag}`, slug: `${name}-${tag}` })) as unknown as { workspaceId: string };
  return { actor, ws: made.workspaceId };
}
const signupGrants = async (ws: string) => Number((await sql!`select count(*)::int as n from credit_grants where workspace_id = ${ws}::uuid and kind = 'signup'`)[0]!['n']);

describe.skipIf(!DB)('NM-024: the signup credits are the person\'s, once', () => {
  it('delete the only workspace and make another: the second one is not funded', async () => {
    const { actor, ws } = await owner('farmer');
    expect(await signupGrants(ws)).toBe(1);
    await executeCommand(store!, actor, { type: 'workspace.delete', workspace: ws });
    const again = (await executeCommand(store!, actor, { type: 'workspace.create', name: `again ${tag}`, slug: `again-${tag}` })) as unknown as { workspaceId: string };
    expect(await signupGrants(again.workspaceId)).toBe(0);
  });
});

describe.skipIf(!DB)('NM-010: an in-app sign-up cannot claim an invitation sent to an address it has not proven', () => {
  const victimEmail = `invitee-${tag}@victim.test`;
  let inviteId = '';
  let ws = '';

  it('the squatter signs up as the invitee\'s address and is refused the invitation', async () => {
    const team = await owner('team');
    ws = team.ws;
    // a Pro (cloud) workspace: the trial is for one person and refuses every invitation
    await sql!`update workspaces set plan = 'cloud' where id = ${ws}::uuid`;
    const inv = (await executeCommand(store!, team.actor, { type: 'workspace.invite', workspace: ws, email: victimEmail, memberRole: 'member' })) as unknown as { inviteId: string };
    inviteId = inv.inviteId;
    stubClerk(`clerk_squat_${tag}`, victimEmail);
    const res = await app!.request('/auth/clerk/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: victimEmail, password: PASSWORD }) });
    expect(res.status).toBe(200);
    const { userId } = (await res.json()) as { userId: string };
    const accept = await app!.request('/v1/commands', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: userId }) },
      body: JSON.stringify({ type: 'workspace.accept_invite', invite: inviteId }),
    });
    expect(accept.status).toBe(403);
    const member = await sql!`select 1 from workspace_members where workspace_id = ${ws}::uuid and user_id = ${userId}::uuid`;
    expect(member).toHaveLength(0);
    // and the account it made starts with no credits either: they wait for the proof
    const own = await sql!`select w.id from workspaces w join workspace_members m on m.workspace_id = w.id where m.user_id = ${userId}::uuid and m.role = 'owner'`;
    for (const r of own) expect(await signupGrants(r['id'] as string)).toBe(0);
  });

  const squatter = async (): Promise<string> => (await sql!`select id from nm_users where clerk_user_id = ${`clerk_squat_${tag}`}`)[0]!['id'] as string;
  const as = (userId: string) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: userId }) });
  const accept = (userId: string) => app!.request('/v1/commands', { method: 'POST', headers: as(userId), body: JSON.stringify({ type: 'workspace.accept_invite', invite: inviteId }) });
  const flagged = async (userId: string): Promise<boolean> => (await sql!`select email_self_asserted from nm_users where id = ${userId}::uuid`)[0]!['email_self_asserted'] as boolean;
  const post = (token: string, password: string) => app!.request(`/auth/verify-email/${token}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password }).toString() });

  it('the refusal says what to do, and the account reads no invitation of the address', async () => {
    const userId = await squatter();
    const refused = await accept(userId);
    expect(((await refused.json()) as { error: string }).error).toContain('Confirm your email first.');
    const mine = await app!.request('/v1/invites/mine', { headers: as(userId) });
    expect(await mine.json()).toEqual({ invites: [] });
  });

  it('the link alone proves nothing: a mail scanner or the invited person can open it', async () => {
    const { emailProofToken } = await import('../src/email-proof');
    const userId = await squatter();
    stubClerk(`clerk_squat_${tag}`, victimEmail);
    const forged = await app!.request(`/auth/verify-email/${emailProofToken(userId, 'someone-else@victim.test')}`);
    expect(forged.status).toBe(400);
    const opened = await app!.request(`/auth/verify-email/${emailProofToken(userId, victimEmail)}`);
    expect(opened.status).toBe(200);
    expect(await opened.text()).toContain('name="password"');
    expect(await flagged(userId)).toBe(true);
    expect((await accept(userId)).status).toBe(403);
    // the invited person does not know the password that the squatter chose
    const wrong = await post(emailProofToken(userId, victimEmail), 'a-guess');
    expect(wrong.status).toBe(401);
    expect(await flagged(userId)).toBe(true);
    expect((await post(emailProofToken(userId, 'someone-else@victim.test'), PASSWORD)).status).toBe(400);
  });

  it('the link and the password of the account together prove it: then the invitation can be answered', async () => {
    const { emailProofToken } = await import('../src/email-proof');
    const userId = await squatter();
    stubClerk(`clerk_squat_${tag}`, victimEmail);
    const proof = await post(emailProofToken(userId, victimEmail), PASSWORD);
    expect(proof.status).toBe(200);
    expect(await flagged(userId)).toBe(false);
    const mine = (await (await app!.request('/v1/invites/mine', { headers: as(userId) })).json()) as { invites: unknown[] };
    expect(mine.invites).toHaveLength(1);
    expect((await accept(userId)).status).toBe(200);
  });
});

describe.skipIf(!DB)('NM-010: the proof flag cannot be washed', () => {
  const email = `washer-${tag}@victim.test`;
  const clerkId = `user_wash${tag}`;
  const signIn = () => app!.request('/auth/clerk/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });

  it('account.delete removes the sign-in identity too, so the old identity cannot come back with a clean row', async () => {
    stubClerk(clerkId, email);
    const res = await app!.request('/auth/clerk/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
    expect(res.status).toBe(200);
    const { userId } = (await res.json()) as { userId: string };
    const actor: Actor = { kind: 'human', id: userId };
    const [row] = await sql!`select email_self_asserted from nm_users where id = ${userId}::uuid`;
    expect(row!['email_self_asserted']).toBe(true);
    for (const w of await store!.listWorkspaces(userId)) await executeCommand(store!, actor, { type: 'workspace.delete', workspace: w.id });
    await executeCommand(store!, actor, { type: 'account.delete' });
    expect(clerkDeletes).toContain(clerkId);
    expect(await sql!`select 1 from nm_users where id = ${userId}::uuid`).toHaveLength(0);
  });

  it('a row that is made for an identity whose address the Backend API verified starts self-asserted', async () => {
    // the identity is alive at Clerk and has no row here (a delete that Clerk refused, or a sign-up whose
    // insert failed): the next sign-in makes the row, and the row must not start trusted
    stubClerk(clerkId, email);
    const { resetAuthThrottle } = await import('../src/auth-throttle');
    resetAuthThrottle();
    const first = await signIn();
    expect(first.status).toBe(200);
    const body = (await first.json()) as { userId: string; emailProof: string | null };
    const [row] = await sql!`select email_self_asserted from nm_users where id = ${body.userId}::uuid`;
    expect(row!['email_self_asserted']).toBe(true);
    // and the sign-in sends the proof link again, at most one mail each ten minutes
    expect(body.emailProof).toBe('sent');
    expect(((await (await signIn()).json()) as { emailProof: string | null }).emailProof).toBeNull();
  });
});
