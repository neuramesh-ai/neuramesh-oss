// EMAIL DRAFTS IN A SESSION (docs/design/inbox-sales-2026-11/plan.md I8 to I11). What must hold: an agent or a person
// writes a card of up to 50 emails, one per person, lettered in order; a newer card replaces the session's waiting
// drafts to the same people; a revision names the version it read, so the agent's next revision starts from the
// person's newest edit; only a person edits the text on the card; and a session's draft stays in its own room.
import { emailCardAnchor, emailCards, emailLetter, type Actor, type EmailDraftRow } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';
import { emailDraftsOf, type MemEmailDraftStore } from '../src/store/email-drafts';

const george: Actor = { kind: 'human', id: 'george' };
const pike: Actor = { kind: 'agent', id: 'pike', role: 'worker' };

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const hdr = (actor: Actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
const send = (actor: Actor, body: unknown) => app.request('/v1/commands', { method: 'POST', headers: hdr(actor), body: JSON.stringify(body) });
const lead = (name: string, email: string) => ({ toName: name, toEmail: email, subject: 'Field Sync is live', body: `Hi ${name.split(' ')[0]},\n\nField Sync is live.\n\nGeorge`, reason: 'read 2 threads' });

async function session(slug = 'sales'): Promise<{ channel: string; thread: string }> {
  const proj = await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: `P ${slug}` }));
  const chan = await j(await send(george, { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug }));
  const thread = crypto.randomUUID();
  await store.createThread('ws_acme', chan.channelId, thread, 'Launch email to the trial leads', '', 'george');
  return { channel: chan.channelId as string, thread };
}
const rows = () => (emailDraftsOf(store) as MemEmailDraftStore).rows;

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
  (store as unknown as { addMember(w: string, u: string): void }).addMember('ws_acme', 'george');
});

describe('email.draft', () => {
  it('an agent writes one email per person, lettered in order, as drafts', async () => {
    const s = await session();
    const r = await send(pike, { type: 'email.draft', ...s, emails: [lead('Lena Ortiz', 'Lena@Pinecrest.com'), lead('Priya Nand', 'priya@halcyongrid.com'), lead('Sam Reyes', 'sam@fieldopsweekly.com')] });
    expect(r.status).toBe(200);
    const out = await j(r);
    expect(out.emails.map((e: { letter: string }) => e.letter)).toEqual(['a', 'b', 'c']);
    expect(rows().map((e) => [e.letter, e.toEmail, e.status, e.version, e.authorKind])).toEqual([
      ['a', 'lena@pinecrest.com', 'draft', 1, 'agent'], ['b', 'priya@halcyongrid.com', 'draft', 1, 'agent'], ['c', 'sam@fieldopsweekly.com', 'draft', 1, 'agent'],
    ]);
    expect(new Set(rows().map((e) => e.cardId)).size).toBe(1);
  });

  it('a newer card replaces the waiting drafts to the same people, and keeps the others', async () => {
    const s = await session();
    await send(pike, { type: 'email.draft', ...s, emails: [lead('Lena Ortiz', 'lena@pinecrest.com'), lead('Priya Nand', 'priya@halcyongrid.com')] });
    const r = await j(await send(pike, { type: 'email.draft', ...s, emails: [lead('Lena Ortiz', 'lena@pinecrest.com')] }));
    expect(r.replaced).toBe(1);
    expect(rows().filter((e) => e.status === 'draft').map((e) => e.toEmail).sort()).toEqual(['lena@pinecrest.com', 'priya@halcyongrid.com']);
    expect(rows().find((e) => e.status === 'replaced')!.cardId).not.toBe(r.cardId);
  });

  it('refuses a card over 50 emails, an address twice, and a session of another room', async () => {
    const s = await session();
    const many = Array.from({ length: 51 }, (_, i) => lead(`Lead ${i}`, `lead${i}@example.com`));
    expect((await send(pike, { type: 'email.draft', ...s, emails: many })).status).toBe(400);
    expect((await send(pike, { type: 'email.draft', ...s, emails: many.slice(0, 50) })).status).toBe(200);
    expect((await send(pike, { type: 'email.draft', ...s, emails: [lead('A', 'a@example.com'), lead('A', 'A@example.com')] })).status).toBe(422);
    expect((await send(pike, { type: 'email.draft', ...s, emails: [lead('A', 'not an address')] })).status).toBe(400);
    const other = await session('build');
    expect((await send(pike, { type: 'email.draft', channel: other.channel, thread: s.thread, emails: [lead('A', 'a@example.com')] })).status).toBe(422);
  });
});

describe('a revision starts from the newest version', () => {
  it('the agent writes one email again by its version, and the version goes up', async () => {
    const s = await session();
    const { emails } = await j(await send(pike, { type: 'email.draft', ...s, emails: [lead('Lena Ortiz', 'lena@pinecrest.com')] }));
    const r = await send(pike, { type: 'email.revise', email: emails[0].id, version: 1, body: 'Hi Lena,\n\nShorter.\n\nGeorge' });
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ letter: 'a', version: 2 });
    expect(rows()[0]).toMatchObject({ version: 2, body: 'Hi Lena,\n\nShorter.\n\nGeorge', editedByKind: 'agent' });
  });

  it('the person\'s edit is the newest version, and an agent revision of the older version is refused', async () => {
    const s = await session();
    const { emails } = await j(await send(pike, { type: 'email.draft', ...s, emails: [lead('Lena Ortiz', 'lena@pinecrest.com')] }));
    expect((await send(george, { type: 'email.edit', email: emails[0].id, version: 1, body: 'Hi Lena, my own words.' })).status).toBe(200);
    expect(rows()[0]).toMatchObject({ version: 2, editedByKind: 'human', editedBy: 'george' });
    const stale = await send(pike, { type: 'email.revise', email: emails[0].id, version: 1, body: 'Overwrite' });
    expect(stale.status).toBe(409);
    expect(await j(stale)).toMatchObject({ code: 'EMAIL_STALE' });
    expect(rows()[0]!.body).toBe('Hi Lena, my own words.');
    expect((await send(pike, { type: 'email.revise', email: emails[0].id, version: 2, subject: 'A better subject' })).status).toBe(200);
    expect(rows()[0]).toMatchObject({ version: 3, body: 'Hi Lena, my own words.', subject: 'A better subject' });
  });

  it('only a person edits the text on the card, and a revision must change something', async () => {
    const s = await session();
    const { emails } = await j(await send(pike, { type: 'email.draft', ...s, emails: [lead('Lena Ortiz', 'lena@pinecrest.com')] }));
    const r = await send(pike, { type: 'email.edit', email: emails[0].id, version: 1, body: 'x' });
    expect(r.status).toBe(403);
    expect(await j(r)).toMatchObject({ code: 'HUMAN_ONLY' });
    expect((await send(pike, { type: 'email.revise', email: emails[0].id, version: 1 })).status).toBe(422);
  });

  it('a sent or replaced email does not change', async () => {
    const s = await session();
    const { emails } = await j(await send(pike, { type: 'email.draft', ...s, emails: [lead('Lena Ortiz', 'lena@pinecrest.com')] }));
    await send(pike, { type: 'email.draft', ...s, emails: [lead('Lena Ortiz', 'lena@pinecrest.com')] });
    const r = await send(george, { type: 'email.edit', email: emails[0].id, version: 1, body: 'x' });
    expect(r.status).toBe(409);
    expect((await j(r)).error).toMatch(/replaced/);
  });
});

describe('the card in hq', () => {
  const row = (letter: string, over: Partial<EmailDraftRow> = {}): EmailDraftRow => ({
    id: letter, workspace_id: 'w', channel_id: 'c', thread_id: 't', card_id: 'k', letter, version: 1, to_name: '', to_email: `${letter}@example.com`, subject: 's', body: 'b', reason: '',
    status: 'draft', author_kind: 'agent', author_id: 'pike', edited_by_kind: 'agent', edited_by: 'pike', sent_by: null, sent_from: null, sent_at: null,
    created_at: '2026-11-23T09:42:00.000Z', updated_at: '2026-11-23T09:42:00.000Z', ...over,
  });

  it('letters run a to z, then aa, and 50 letters are all different', () => {
    expect([0, 1, 25, 26, 49].map(emailLetter)).toEqual(['a', 'b', 'z', 'aa', 'ax']);
    expect(new Set(Array.from({ length: 50 }, (_, i) => emailLetter(i))).size).toBe(50);
  });

  it('groups a card\'s emails by letter, and sits under the agent message after its newest change', () => {
    const [card] = emailCards([row('b'), row('aa'), row('a', { updated_at: '2026-11-23T09:45:00.000Z' })]);
    expect(card!.emails.map((e) => e.letter)).toEqual(['a', 'b', 'aa']);
    expect(card!.updatedAt).toBe('2026-11-23T09:45:00.000Z');
    const talk = [{ author_kind: 'human', created_at: '2026-11-23T09:44:00.000Z' }, { author_kind: 'agent', created_at: '2026-11-23T09:45:02.000Z' }];
    expect(emailCardAnchor(card!, talk)).toBe('2026-11-23T09:45:02.001Z');
    expect(emailCardAnchor(card!, talk.slice(0, 1))).toBe('2026-11-23T09:45:00.000Z');
  });
});
