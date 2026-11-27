// add_email_media (host/tools-email-media.ts, plan I13): the agent puts a picture, a GIF or a video link into an email on
// the card by letter. It writes a reference into the body (never bytes over a token), names the version it read, refuses
// a video file and a guessed link, and saves a picture it draws to the session's Files before the body names it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import type { EmailDraftRow } from '@neuramesh/shared';
import { emailTools } from './tools-email';

const IMG = 'f1111111-1111-4111-8111-111111111111';
const row = (over: Partial<EmailDraftRow> = {}): EmailDraftRow => ({
  id: 'id-a', workspace_id: 'w', channel_id: 'chan', thread_id: 't', card_id: 'k1', letter: 'a', version: 2, to_name: 'Lena Ortiz', to_email: 'lena@pinecrest.com',
  subject: 'Field Sync is live', body: 'Hi Lena,\n\nField Sync is live.\n\nGeorge', reason: '', status: 'draft', author_kind: 'agent', author_id: 'pike', edited_by_kind: 'agent', edited_by: 'pike',
  sent_by: null, sent_from: null, sent_at: null, created_at: '2026-11-23T09:42:00.000Z', updated_at: '2026-11-23T09:42:00.000Z', ...over,
});

function harness(rows: EmailDraftRow[], files: Array<{ id: string; name: string }> = [], draw?: () => Promise<{ bytes?: Buffer; mime?: string; error?: string }>) {
  const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
  const tools = emailTools({
    z, ch: { id: 'chan', workspace_id: 'w' }, actor: { kind: 'agent', id: 'pike' }, convoThreadId: 't', ...(draw ? { draw } : {}),
    db: { getAll: async (q: string) => (q.includes('from artifacts') ? files : rows) } as never,
    post: (async (path: string, _a: unknown, body: unknown) => { sent.push({ path, body: body as Record<string, unknown> }); return Response.json({ ok: true }); }) as never,
  });
  const run = (input: unknown) => tools.find((t) => t.name === 'add_email_media')!.run(input);
  return { sent, run };
}

test('a file from Files goes in as a reference, before the sign-off, from the version the agent read', async () => {
  const h = harness([row()], [{ id: IMG, name: 'launch-screen.png' }]);
  const out = await h.run({ letter: 'a', version: 2, file: 'launch-screen.png', alt: 'The Field Sync screen' });
  assert.match(out, /has the picture now \(v3\)/);
  assert.deepEqual(h.sent, [{ path: '/v1/commands', body: { type: 'email.revise', email: 'id-a', version: 2, body: `Hi Lena,\n\nField Sync is live.\n\n![The Field Sync screen](file:${IMG})\n\nGeorge` } }]);
});

test('a video link goes after the paragraph it names, and a video file or a page that is not https is refused', async () => {
  const h = harness([row()], [{ id: IMG, name: 'demo.mp4' }]);
  await h.run({ letter: 'a', version: 2, video: 'https://www.loom.com/share/abc', alt: 'The demo', after: 'Hi Lena' });
  assert.equal(h.sent[0]!.body['body'], 'Hi Lena,\n\n![The demo](video:https://www.loom.com/share/abc)\n\nField Sync is live.\n\nGeorge');
  assert.match(await h.run({ letter: 'a', version: 2, file: 'demo.mp4', alt: 'x' }), /is a video/);
  assert.match(await h.run({ letter: 'a', version: 2, video: 'http://x.test/v', alt: 'x' }), /https/);
  assert.match(await h.run({ letter: 'a', version: 2, video: 'https://x.test/v', file: 'demo.mp4', alt: 'x' }), /exactly one/);
  assert.equal(h.sent.length, 1);
});

test('an edit by the person comes back before the agent writes over it', async () => {
  const h = harness([row({ version: 3, edited_by_kind: 'human' })], [{ id: IMG, name: 'launch-screen.png' }]);
  assert.match(await h.run({ letter: 'a', version: 2, file: 'launch-screen.png', alt: 'x' }), /the person wrote that version/);
  assert.equal(h.sent.length, 0);
});

test('a picture it draws goes to the session\'s Files first, and the body names that file', async () => {
  const h = harness([row()], [], async () => ({ bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mime: 'image/png' }));
  assert.match(await h.run({ letter: 'a', version: 2, brief: 'a field crew at dusk', alt: 'A field crew at dusk' }), /has the picture now/);
  const upload = h.sent[0]!;
  assert.equal(upload.path, '/v1/brain/artifacts');
  assert.equal(upload.body['threadId'], 't');
  assert.equal(upload.body['name'], 'a-field-crew-at-dusk.png');
  assert.match(String(h.sent[1]!.body['body']), new RegExp(`!\\[A field crew at dusk\\]\\(file:${String(upload.body['id'])}\\)`));
  const none = harness([row()]);
  assert.match(await none.run({ letter: 'a', version: 2, brief: 'x', alt: 'x' }), /cannot draw/);
});
