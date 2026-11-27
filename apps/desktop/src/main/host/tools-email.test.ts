// The email tools (host/tools-email.ts, plan I8 to I10): a card needs a conversation; draft_emails posts one
// email.draft with every person; revise_emails finds the waiting email by letter on the newest card, names the
// version it read, and gives the agent the person's own edit back instead of writing over it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import type { EmailDraftRow } from '@neuramesh/shared';
import { emailByLetter, emailTools, revisionGate } from './tools-email';

const row = (letter: string, over: Partial<EmailDraftRow> = {}): EmailDraftRow => ({
  id: `id-${letter}`, workspace_id: 'w', channel_id: 'c', thread_id: 't', card_id: 'k1', letter, version: 1, to_name: 'Lena Ortiz', to_email: 'lena@pinecrest.com',
  subject: 'Field Sync is live', body: 'Hi Lena', reason: '', status: 'draft', author_kind: 'agent', author_id: 'pike', edited_by_kind: 'agent', edited_by: 'pike',
  sent_by: null, sent_from: null, sent_at: null, created_at: '2026-11-23T09:42:00.000Z', updated_at: '2026-11-23T09:42:00.000Z', ...over,
});

function harness(rows: EmailDraftRow[], answer: (cmd: Record<string, unknown>) => Response = () => Response.json({ ok: true })) {
  const sent: Array<Record<string, unknown>> = [];
  const tools = emailTools({
    z, ch: { id: 'chan', workspace_id: 'w' }, actor: { kind: 'agent', id: 'pike' }, convoThreadId: 't',
    db: { getAll: async () => rows } as never,
    post: (async (_path: string, _actor: unknown, cmd: unknown) => { sent.push(cmd as Record<string, unknown>); return answer(cmd as Record<string, unknown>); }) as never,
  });
  const run = (name: string, input: unknown) => tools.find((t) => t.name === name)!.run(input);
  return { sent, run };
}

test('draft_emails posts one card with every person, and says nothing is sent', async () => {
  const h = harness([], () => Response.json({ cardId: 'k1', emails: [{ letter: 'a' }, { letter: 'b' }], replaced: 0 }));
  const out = await h.run('draft_emails', { emails: [
    { toName: 'Lena Ortiz', toEmail: 'lena@pinecrest.com', subject: 'Hi', body: 'Hi Lena' },
    { toName: 'Priya Nand', toEmail: 'priya@halcyongrid.com', subject: 'Hi', body: 'Hi Priya', reason: 'read 2 threads' },
  ] });
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0]!['type'], 'email.draft');
  assert.equal(h.sent[0]!['thread'], 't');
  assert.equal(h.sent[0]!['channel'], 'chan');
  assert.equal((h.sent[0]!['emails'] as unknown[]).length, 2);
  assert.match(out, /2 emails delivered as one card in this thread \(a\/b, each at v1\)/);
  assert.match(out, /Nothing is sent/);
});

test('a card needs a conversation', async () => {
  const tools = emailTools({ z, ch: { id: 'c', workspace_id: 'w' }, actor: { kind: 'agent', id: 'pike' }, convoThreadId: null, db: {} as never, post: (async () => Response.json({})) as never });
  assert.match(await tools[0]!.run({ emails: [] }), /live in a conversation/);
});

test('revise_emails changes the waiting email by letter, from the version it read', async () => {
  const h = harness([row('a'), row('b', { id: 'id-b', version: 2 })]);
  const out = await h.run('revise_emails', { revisions: [{ letter: 'B', version: 2, body: 'Shorter.' }] });
  assert.deepEqual(h.sent, [{ type: 'email.revise', email: 'id-b', version: 2, body: 'Shorter.' }]);
  assert.match(out, /Revised b \(v3\) in place/);
});

test('the person\'s edit comes back to the agent instead of being written over', async () => {
  const h = harness([row('a', { version: 3, edited_by_kind: 'human', edited_by: 'george', body: 'Hi Lena, my own words.' })]);
  const out = await h.run('revise_emails', { revisions: [{ letter: 'a', body: 'Overwrite' }] });
  assert.equal(h.sent.length, 0);
  assert.match(out, /at v3, and the person wrote that version/);
  assert.match(out, /Hi Lena, my own words\./);
  assert.match(out, /Never claim a change/);
});

test('the newest card wins a letter, and a sent or replaced email is not a target', () => {
  const rows = [row('a', { card_id: 'old', created_at: '2026-11-23T09:00:00.000Z' }), row('a', { id: 'new-a', card_id: 'new', created_at: '2026-11-23T10:00:00.000Z' }), row('b', { status: 'sent' })];
  assert.equal(emailByLetter(rows, 'A')!.id, 'new-a');
  assert.equal(emailByLetter(rows, 'b'), null);
  assert.equal(revisionGate(row('a'), undefined), null);
  assert.equal(revisionGate(row('a', { version: 2 }), 2), null);
  assert.match(revisionGate(row('a', { version: 2 }), 1)!, /Start from this text/);
});
