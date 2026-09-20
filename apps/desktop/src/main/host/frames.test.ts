// The frame's name check (host/frames.ts): the shelf's spelling wins, a miss lists the shelf, an empty shelf says what to ask for.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameOf, productShotsFor, productShotsGate, shelfImages } from './frames';
import type { LibDoc } from './orchtools';

const shelf: LibDoc[] = [
  { name: 'business-profile.md', kind: 'doc', created_at: '2026-09-19T10:00:00Z', promoted: 1, inline_content: '# NeuraMesh' },
  { name: 'App-Home.png', kind: 'screenshot', created_at: '2026-09-19T11:00:00Z', promoted: 0, inline_content: 'data:image/png;base64,iVBORw0KGgo=' },
  { name: 'board.jpg', kind: 'file', created_at: '2026-09-19T12:00:00Z', promoted: 0, inline_content: 'data:image/jpeg;base64,/9j/4AA=', mime: 'image/jpeg' },
];
const reader = (docs: LibDoc[]) => async () => docs;
/** a reader that knows scopes: the room's rows, and the project's beyond them */
const scoped = (room: LibDoc[], project: LibDoc[]) => async (_ch: string, _limit?: number, scope?: 'room' | 'project' | 'workspace') => (scope === 'room' ? room : [...room, ...project]);

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

test('the shelf widens to the project: the room\'s images first, then the other rooms\' (plan §9)', async () => {
  const elsewhere: LibDoc[] = [{ name: 'pricing.png', kind: 'file', created_at: '2026-09-20T01:00:00Z', promoted: 0, inline_content: 'data:image/png;base64,iVBORw0KGgo=', room: 'build' }];
  assert.deepEqual(await shelfImages(scoped(shelf, elsewhere), 'ch'), ['App-Home.png', 'board.jpg', 'pricing.png']);
  assert.deepEqual(await frameOf(scoped(shelf, elsewhere), 'ch', 'pricing.png'), { ok: true, name: 'pricing.png' });
});

test('the product-shot gate: a SHOW line must name a shelf image, and a beat that shows the product must carry one', async () => {
  const lib = reader(shelf);
  assert.equal(await productShotsGate(lib, 'ch', '[0:00-0:03] Hook to camera.\n[0:03-0:07] Cut to the app home screen. SHOW: app-home.png'), null);
  assert.equal(await productShotsGate(lib, 'ch', '[0:00-0:03] Hook to camera.\n[0:03-0:07] Walk through the park.'), null); // no product on screen: nothing to ask
  assert.match((await productShotsGate(lib, 'ch', '[0:00-0:03] Hook.\n[0:03-0:07] Cut to the app home screen. SHOW: home.png')) ?? '', /beat \[0:03-0:07\] says SHOW: home.png, and no image of that name is on the shelf\. Images on the shelf: App-Home.png, board.jpg\. Name one of them, or make_product_image/);
  assert.match((await productShotsGate(lib, 'ch', '[0:00-0:03] Hook.\n[0:03-0:07] Cut to the app home screen.\nSpoken: "Look."')) ?? '', /beat \[0:03-0:07\] shows the product but names no image.*Add `SHOW: <image name>`.*Images on the shelf: App-Home.png, board.jpg\. No image fits: make_product_image, or ask the human for a screenshot/);
  assert.match((await productShotsGate(reader([shelf[0]!]), 'ch', '[0:00-0:03] The phone in hand.')) ?? '', /The shelf holds no images\./);
  // over a draft_posts call: the first refusal names its post
  assert.equal(await productShotsFor(lib, 'ch', [{ script: '[0:00-0:03] Hook.' }, { }]), null);
  assert.match((await productShotsFor(lib, 'ch', [{ script: '[0:00-0:03] Hook.' }, { script: '[0:00-0:04] The app on screen.' }])) ?? '', /^Post b: Not yet: beat \[0:00-0:04\]/);
});
