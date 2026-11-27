// Email drafts on the real schema (0199): the store's SQL lands one row per email with its letter, a newer card
// replaces the waiting drafts to the same people, a revision names its version, a send holds its rows once, and
// every column the client schema names exists, so the replica serves the table.
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import { TABLE_COLUMNS } from '@neuramesh/client-core/schema';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresStore } from '../src/pgstore';
import { emailDraftsOf } from '../src/store/email-drafts';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const DEV = 'c0000000-0000-0000-0000-00000000000b';
const GEORGE = '00000000-0000-0000-0000-000000000001';
const store = DB ? new PostgresStore(DB) : null;
const email = (name: string, to: string) => ({ toName: name, toEmail: to, subject: 'Field Sync is live', body: `Hi ${name}`, reason: '' });

afterAll(async () => { await store?.close(); });

describe.skipIf(!DB)('email drafts on postgres (0199)', () => {
  it('writes a card, replaces, revises by version, and holds a send once', async () => {
    const thread = crypto.randomUUID();
    await store!.createThread(WS, DEV, thread, 'Launch email', '', GEORGE);
    const drafts = emailDraftsOf(store!);
    expect(await drafts.threadRoom(thread)).toEqual({ workspaceId: WS, channelId: DEV });
    const by = { kind: 'agent' as const, id: 'pike' };
    const one = await drafts.draft({ workspaceId: WS, channelId: DEV, threadId: thread, by, emails: [email('Lena', 'Lena@Pinecrest.com'), email('Priya', 'priya@halcyongrid.com')] });
    expect(one.emails.map((e) => e.letter)).toEqual(['a', 'b']);
    const two = await drafts.draft({ workspaceId: WS, channelId: DEV, threadId: thread, by, emails: [email('Lena', 'lena@pinecrest.com')] });
    expect(two.replaced).toBe(1);
    expect((await drafts.card(one.cardId)).map((e) => [e.letter, e.status])).toEqual([['a', 'replaced'], ['b', 'draft']]);

    const b = one.emails[1]!.id;
    const edited = await drafts.revise(b, 1, { body: 'Hi Priya, my own words.' }, { kind: 'human', id: GEORGE });
    expect([edited.version, edited.editedByKind]).toEqual([2, 'human']);
    await expect(drafts.revise(b, 1, { body: 'over' }, by)).rejects.toMatchObject({ code: 'EMAIL_STALE' });
    expect((await drafts.revise(b, 2, { subject: 'Better' }, by)).body).toBe('Hi Priya, my own words.');

    const now = new Date();
    const held = await drafts.claim(one.cardId, ['a', 'b'], GEORGE, 'george@acme.test', now);
    expect(held.map((e) => e.letter)).toEqual(['b']);
    expect(await drafts.claim(one.cardId, ['b'], GEORGE, 'george@acme.test', now)).toEqual([]);
    await expect(drafts.revise(b, 3, { body: 'x' }, by)).rejects.toMatchObject({ code: 'CONFLICT' });
    await drafts.release(b);
    expect((await drafts.get(b))!.sentAt).toBeNull();
    await drafts.claim(one.cardId, ['b'], GEORGE, 'george@acme.test', now);
    await drafts.markSent(b, 'gmail-1', now);
    expect(await drafts.get(b)).toMatchObject({ status: 'sent', sentFrom: 'george@acme.test', gmailId: 'gmail-1' });
  });

  it('has every column the client schema names, and the sync triggers', async () => {
    const cols = await store!.sql<Array<{ column_name: string }>>`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'email_drafts'`;
    const have = new Set(cols.map((c) => c.column_name));
    expect(Object.keys(TABLE_COLUMNS['email_drafts']!).filter((c) => !have.has(c))).toEqual([]);
    expect(have.has('gmail_id')).toBe(true);
    expect('gmail_id' in TABLE_COLUMNS['email_drafts']!).toBe(false);
    const triggers = await store!.sql`select tgname from pg_trigger where tgrelid = 'public.email_drafts'::regclass and tgname in ('sync_note', 'sync_change')`;
    expect(triggers.length).toBe(2);
  });
});
