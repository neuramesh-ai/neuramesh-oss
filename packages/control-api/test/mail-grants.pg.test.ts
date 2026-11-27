// THE READ GRANTS on Postgres (0203, plan I12). What must hold on the real table: an ask waits one at a time for an
// agent in a session; Allow once moves only an ask that waits; two reads of one grant never both win; the hour ends;
// the row syncs to the replica, and it holds no token.
//
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgMailGrantStore } from '../src/store/mail-grants';

const DB = process.env['DATABASE_URL'];
const sql = DB ? postgres(DB) : null;
const grants = sql ? new PgMailGrantStore(sql) : null;
// the CI fixtures (supabase/validate/test-fixtures.sql): Acme, its dev room, George
const ws = 'a0000000-0000-0000-0000-00000000000a';
const channel = 'c0000000-0000-0000-0000-00000000000b';
const george = '00000000-0000-0000-0000-000000000001';
let thread = '', agent = '', other = '';
const SEARCH = { mail: { people: ['lena@pinecrest.com'], words: '', days: 90, max: 20 } };
const newThread = async (title: string) => (await sql!`insert into threads (id, workspace_id, channel_id, title, created_by) values (gen_random_uuid(), ${ws}::uuid, ${channel}::uuid, ${title}, ${george}) returning id`)[0]!['id'] as string;

beforeAll(async () => {
  if (!sql) return;
  const t = randomBytes(4).toString('hex');
  // George may already own the fixture workspace's one member machine (machines_one_member): reuse it
  const mine = await sql`select id from machines where workspace_id = ${ws}::uuid and owner_user_id = ${george}::uuid and kind = 'member' and (lifecycle is null or lifecycle <> 'destroyed') limit 1`;
  const machine = (mine[0] ?? (await sql`insert into machines (workspace_id, owner_user_id, name, kind) values (${ws}::uuid, ${george}::uuid, ${`Desk ${t}`}, 'member') returning id`)[0]!)['id'] as string;
  agent = (await sql`insert into agents (workspace_id, machine_id, name) values (${ws}::uuid, ${machine}::uuid, ${`pike-${t}`}) returning id`)[0]!['id'] as string;
  other = (await sql`insert into agents (workspace_id, machine_id, name) values (${ws}::uuid, ${machine}::uuid, ${`rex-${t}`}) returning id`)[0]!['id'] as string;
  thread = await newThread('Launch email');
});
afterAll(async () => { await sql?.end(); });

describe.skipIf(!DB)('mail grants on Postgres', () => {
  it('reads once: Allow once moves only a waiting ask, and two reads of one grant never both win', async () => {
    const a = (await grants!.ask({ workspaceId: ws, channelId: channel, threadId: thread, agentId: agent, search: SEARCH, reason: 'to write to Lena' }))!;
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await grants!.ask({ workspaceId: ws, channelId: channel, threadId: thread, agentId: agent, search: SEARCH, reason: 'again' })).toBeNull();
    expect(await grants!.claim(agent, thread, null, new Date())).toBeNull();
    const now = new Date();
    const allowed = await grants!.allow(a.id, george, 'America/Denver', now);
    expect(allowed).toMatchObject({ status: 'allowed', allowedBy: george, timeZone: 'America/Denver', search: SEARCH });
    expect(Date.parse(allowed!.expiresAt!) - now.getTime()).toBe(3_600_000);
    expect(await grants!.allow(a.id, george, 'UTC', now)).toBeNull();
    expect(await grants!.claim(other, thread, null, now)).toBeNull();
    const [one, two] = await Promise.all([grants!.claim(agent, thread, a.id, now), grants!.claim(agent, thread, a.id, now)]);
    expect([one, two].filter(Boolean)).toHaveLength(1);
    await grants!.finish(a.id, 6, null);
    await grants!.release(a.id);
    expect(await grants!.get(a.id)).toMatchObject({ status: 'used', readThreads: 6, readDays: null });
  });

  it('a grant past its hour never reads, and a failed read gives the grant back', async () => {
    const t2 = await newThread('Two');
    const a = (await grants!.ask({ workspaceId: ws, channelId: channel, threadId: t2, agentId: agent, search: SEARCH, reason: 'x' }))!;
    await grants!.allow(a.id, george, 'UTC', new Date(Date.now() - 2 * 3_600_000));
    expect(await grants!.claim(agent, t2, null, new Date())).toBeNull();
    const b = (await grants!.ask({ workspaceId: ws, channelId: channel, threadId: t2, agentId: agent, search: SEARCH, reason: 'y' }))!;
    await grants!.allow(b.id, george, 'UTC', new Date());
    expect((await grants!.claim(agent, t2, null, new Date()))?.id).toBe(b.id);
    await grants!.release(b.id);
    expect((await grants!.get(b.id))?.status).toBe('allowed');
  });

  it('syncs to the replica with no token in any column', async () => {
    const [t] = await sql!<{ n: number }[]>`select count(*)::int as n from pg_trigger where tgrelid = 'public.mail_grants'::regclass and tgname in ('sync_change', 'sync_note')`;
    expect(t!.n).toBe(2);
    const cols = (await sql!<{ c: string }[]>`select column_name as c from information_schema.columns where table_name = 'mail_grants'`).map((r) => r.c);
    expect(cols.some((c) => /token|secret|sealed/.test(c))).toBe(false);
  });
});
