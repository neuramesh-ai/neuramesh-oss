// The drafts read back (chattools-drafts.ts): the cards by letter with every field a revision can
// replace, and the gate that keeps revise_posts from rewriting a card this turn has not read.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftsText, readDrafts, unreadRevision } from './chattools-drafts';
import { newGrounding } from './grounding';

const rows = [
  { id: 'i1', platform: 'x', body: 'The caption that posts. #neuramesh', status: 'draft', media: JSON.stringify({ brief: 'phone in hand', script: '[0:00-0:03] hook\nSpoken: "Hi."', seconds: 15, frame: 'app-home.jpg', video_id: 'v1', video: { model: 'Seedance 2.0', seconds: 15 } }) },
  { id: 'i2', platform: 'linkedin', body: 'A text post.', status: 'scheduled', media: JSON.stringify({ brief: 'a warm desk' }) },
  { id: 'i3', platform: 'x', body: 'Filming.', status: 'draft', media: JSON.stringify({ script: '[0:00-0:03] one', video_pending: true }) },
  { id: 'i4', platform: 'x', body: 'Failed.', status: 'draft', media: JSON.stringify({ script: '[0:00-0:03] one', video_error: 'out of credits' }) },
  { id: 'i5', platform: 'x', body: 'Broken media.', status: 'draft', media: '{not json' },
];
const db = { getAll: async <T,>(sql: string, args: unknown[]): Promise<T[]> => (sql.includes('thread_id = ?') && args[0] === 't1' ? rows : []) as T[] };

test('the drafts read back by letter: caption, script, length, direction, frame and the film\'s state', async () => {
  const drafts = await readDrafts(db as never, { threadId: 't1' });
  assert.deepEqual(drafts.map((d) => [d.letter, d.platform, d.status, d.seconds, d.film]), [
    ['a', 'x', 'draft', 15, 'filmed, 15 s on Seedance 2.0'],
    ['b', 'linkedin', 'scheduled', null, 'not filmed yet'],
    ['c', 'x', 'draft', null, 'filming now'],
    ['d', 'x', 'draft', null, 'no film: out of credits'],
    ['e', 'x', 'draft', null, 'not filmed yet'],
  ]);
  const text = draftsText(drafts);
  assert.match(text, /^a\) \[x\] draft · video post · length 15 s · filmed, 15 s on Seedance 2\.0 · frame app-home\.jpg\ncaption: The caption that posts\. #neuramesh\nshot direction: phone in hand\nscript:\n\[0:00-0:03\] hook\nSpoken: "Hi\."/);
  assert.match(text, /b\) \[linkedin\] scheduled\ncaption: A text post\.\nimage brief: a warm desk/);
  assert.equal(draftsText([]), 'there are no drafts in this conversation yet');
  assert.deepEqual(await readDrafts(db as never, { threadId: 'other' }), []);
  assert.deepEqual(await readDrafts(db as never, {}), []);
});

test('the read gate: a rewrite of a card\'s text waits for read_drafts this turn; a frame, a brief or a length alone does not', () => {
  const g = newGrounding();
  assert.match(unreadRevision(g, 'a', { script: 'new' }) ?? '', /read draft a before you rewrite it\. Call read_drafts, then revise_posts with the script changed/);
  assert.match(unreadRevision(g, 'b', { body: 'new' }) ?? '', /the text changed/);
  assert.equal(unreadRevision(g, 'a', { }), null);
  g.drafts.add('a');
  assert.equal(unreadRevision(g, 'a', { script: 'new', body: 'new' }), null);
  assert.match(unreadRevision(g, 'b', { body: 'new' }) ?? '', /read draft b/);
});
