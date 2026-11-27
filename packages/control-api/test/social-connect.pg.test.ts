// SOCIAL CONNECT IS A SIGNED-IN ACT (R10 lane A, NM-011). Before: GET /connect/:provider/start was
// public and took `workspace` and `actor` from the query, sealing them into a state with no expiry,
// so anyone who knew a room's ids could bind THEIR OWN X account into it (the room's posts then
// publish to the attacker), and the callback reflected the handle into HTML unescaped.
//
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { seal } from '../src/connector-crypto';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const ENV = { NM_CONNECTOR_KEY: 'test-connector-key-r10', X_CLIENT_ID: 'x-client', X_CLIENT_SECRET: 'x-secret' };
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;

let ws = '', channel = '', owner: Actor, stranger: Actor;
const as = (a: Actor) => ({ 'x-nm-actor': JSON.stringify(a) });
const HOSTILE = '<img src=x onerror=alert(1)>';

beforeAll(async () => {
  if (!DB) return;
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  const t = randomBytes(4).toString('hex');
  const user = async (n: string) => ({ kind: 'human', id: (await sql!`insert into nm_users (clerk_user_id, email) values (${`sc_${n}_${t}`}, ${`${n}-${t}@social.test`}) returning id`)[0]!['id'] as string } as Actor);
  owner = await user('owner'); stranger = await user('stranger');
  ws = (await sql!`insert into workspaces (name, slug, created_by, plan) values (${`Social ${t}`}, ${`social-${t}`}, ${owner.id}::uuid, 'cloud') returning id`)[0]!['id'] as string;
  await sql!`insert into workspace_members (workspace_id, user_id, role) values (${ws}::uuid, ${owner.id}::uuid, 'owner')`;
  const project = (await sql!`insert into projects (workspace_id, name, slug) values (${ws}::uuid, 'Growth', ${`growth-${t}`}) returning id`)[0]!['id'] as string;
  channel = (await sql!`insert into channels (workspace_id, project_id, slug, kind) values (${ws}::uuid, ${project}::uuid, 'marketing', 'marketing') returning id`)[0]!['id'] as string;
});
afterEach(() => { globalThis.fetch = realFetch; });
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await sql?.end(); await store?.close();
});

/** X's token and users/me endpoints, answering a handle chosen by the account being connected */
function fakeX(handle: string): void {
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.startsWith('https://api.x.com/2/oauth2/token')) return new Response(JSON.stringify({ access_token: 'at-attacker', refresh_token: 'rt', expires_in: 7200 }), { status: 200 });
    if (u.startsWith('https://api.x.com/2/users/me')) return new Response(JSON.stringify({ data: { username: handle } }), { status: 200 });
    return realFetch(url as never);
  }) as typeof fetch;
}
const connectors = async () => sql!`select handle, connected_by from connectors where workspace_id = ${ws}::uuid and provider = 'x'`;

describe.skipIf(!DB)('social connect: the start is signed in, the state expires, the handle is escaped', () => {
  it('the public start no longer builds a state from the query string', async () => {
    const res = await app!.request(`/connect/x/start?workspace=${ws}&channel=${channel}&actor=${stranger.id}`);
    expect(res.status).toBe(410);
    expect(res.headers.get('location')).toBeNull();
  });

  it('a stranger cannot start a connect into the room; a member gets the provider page', async () => {
    const refused = await app!.request('/v1/connect/x/start', { method: 'POST', headers: { 'content-type': 'application/json', ...as(stranger) }, body: JSON.stringify({ channel }) });
    expect(refused.status).toBe(403);
    const ok = await app!.request('/v1/connect/x/start', { method: 'POST', headers: { 'content-type': 'application/json', ...as(owner) }, body: JSON.stringify({ channel }) });
    expect(ok.status).toBe(200);
    const url = new URL(((await ok.json()) as { url: string }).url);
    expect(url.host).toBe('x.com');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('a member with no Marketing access cannot connect an account, and gets it with the grant', async () => {
    const t = randomBytes(4).toString('hex');
    const member: Actor = { kind: 'human', id: (await sql!`insert into nm_users (clerk_user_id, email) values (${`sc_member_${t}`}, ${`member-${t}@social.test`}) returning id`)[0]!['id'] as string };
    await sql!`insert into workspace_members (workspace_id, user_id, role) values (${ws}::uuid, ${member.id}::uuid, 'member')`;
    const start = () => app!.request('/v1/connect/x/start', { method: 'POST', headers: { 'content-type': 'application/json', ...as(member) }, body: JSON.stringify({ channel }) });
    const refused = await start();
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'NOT_PERMITTED', error: 'Ask the workspace owner to add you to Marketing.' });
    // a state that this member holds from before the access went connects nothing either
    fakeX('member_account');
    const held = seal({ workspace: ws, channel, actor: member.id, verifier: 'v', iat: Date.now() });
    expect((await app!.request(`/connect/x/callback?code=c&state=${encodeURIComponent(held)}`)).status).toBe(403);
    expect(await connectors()).toHaveLength(0);
    await sql!`insert into workspace_destination_members (workspace_id, destination, principal_kind, principal_id, added_by) values (${ws}::uuid, 'marketing', 'human', ${member.id}::uuid, ${owner.id}::uuid)`;
    expect((await start()).status).toBe(200);
  });

  it('a state with no issue time (the old public start\'s) connects nothing', async () => {
    fakeX('attacker');
    const forged = seal({ workspace: ws, channel, actor: stranger.id, verifier: 'v' });
    const res = await app!.request(`/connect/x/callback?code=c&state=${encodeURIComponent(forged)}`);
    expect(res.status).toBe(400);
    expect(await connectors()).toHaveLength(0);
  });

  it('a stale state connects nothing', async () => {
    fakeX('attacker');
    const stale = seal({ workspace: ws, channel, actor: owner.id, verifier: 'v', iat: Date.now() - 16 * 60_000 });
    const res = await app!.request(`/connect/x/callback?code=c&state=${encodeURIComponent(stale)}`);
    expect(res.status).toBe(400);
    expect(await connectors()).toHaveLength(0);
  });

  it('a state for a person who is not a member connects nothing', async () => {
    fakeX('attacker');
    const notMember = seal({ workspace: ws, channel, actor: stranger.id, verifier: 'v', iat: Date.now() });
    const res = await app!.request(`/connect/x/callback?code=c&state=${encodeURIComponent(notMember)}`);
    expect(res.status).toBe(403);
    expect(await connectors()).toHaveLength(0);
  });

  it('the member\'s own round-trip connects, and the handle is escaped on the page', async () => {
    const start = await app!.request('/v1/connect/x/start', { method: 'POST', headers: { 'content-type': 'application/json', ...as(owner) }, body: JSON.stringify({ channel }) });
    const state = new URL(((await start.json()) as { url: string }).url).searchParams.get('state')!;
    fakeX(HOSTILE);
    const res = await app!.request(`/connect/x/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('<img');
    expect(html).toContain('&#60;img');
    expect((await connectors()).map((r) => r['connected_by'])).toEqual([owner.id]);
  });
});
