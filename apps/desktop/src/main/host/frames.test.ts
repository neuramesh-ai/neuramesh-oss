// The frame's name check (host/frames.ts): the shelf's spelling wins, a miss lists the shelf, an empty shelf says what to ask for.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameOf, shelfImages } from './frames';
import type { LibDoc } from './orchtools';

const shelf: LibDoc[] = [
  { name: 'business-profile.md', kind: 'doc', created_at: '2026-09-19T10:00:00Z', promoted: 1, inline_content: '# NeuraMesh' },
  { name: 'App-Home.png', kind: 'screenshot', created_at: '2026-09-19T11:00:00Z', promoted: 0, inline_content: 'data:image/png;base64,iVBORw0KGgo=' },
  { name: 'board.jpg', kind: 'file', created_at: '2026-09-19T12:00:00Z', promoted: 0, inline_content: 'data:image/jpeg;base64,/9j/4AA=', mime: 'image/jpeg' },
];
const reader = (docs: LibDoc[]) => async () => docs;

test('the shelf\'s images, by name, and a name matched the way the shelf spells it', async () => {
  assert.deepEqual(await shelfImages(reader(shelf), 'ch'), ['App-Home.png', 'board.jpg']);
  assert.deepEqual(await frameOf(reader(shelf), 'ch', 'app-home.png'), { ok: true, name: 'App-Home.png' });
  assert.deepEqual(await frameOf(reader(shelf), 'ch', 'board.jpg'), { ok: true, name: 'board.jpg' });
});

test('a miss lists the shelf; an empty shelf says what to ask the human for; a document is not a frame', async () => {
  const miss = await frameOf(reader(shelf), 'ch', 'home.png');
  assert.equal(miss.ok, false);
  assert.match((miss as { why: string }).why, /no image named "home.png".*Its images: App-Home.png, board.jpg/);
  const doc = await frameOf(reader(shelf), 'ch', 'business-profile.md');
  assert.equal(doc.ok, false);
  const empty = await frameOf(reader([shelf[0]!]), 'ch', 'x.png');
  assert.match((empty as { why: string }).why, /holds no images.*upload a screenshot/);
});
