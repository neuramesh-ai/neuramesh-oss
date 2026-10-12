// The frame's name check (host/frames.ts): the shelf's spelling wins, a miss lists the shelf, an empty shelf says what to ask for.
// Real app screenshots only (George, 2026-10-06): a person's image or a repository file counts, an agent's capture never does.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appShots, frameOf, isAppShot, productShotsFor, productShotsGate } from './frames';
import type { LibDoc } from './orchtools';

const shelf: LibDoc[] = [
  { name: 'business-profile.md', kind: 'doc', created_at: '2026-09-19T10:00:00Z', promoted: 1, inline_content: '# NeuraMesh', created_by_kind: 'human' },
  { name: 'App-Home.png', kind: 'screenshot', created_at: '2026-09-19T11:00:00Z', promoted: 0, inline_content: 'data:image/png;base64,iVBORw0KGgo=', created_by_kind: 'human' },
  { name: 'board.jpg', kind: 'file', created_at: '2026-09-19T12:00:00Z', promoted: 0, inline_content: 'data:image/jpeg;base64,/9j/4AA=', mime: 'image/jpeg', created_by_kind: 'agent', source: 'repo:acme/app/docs/board.jpg@3f2a' },
  // what George's room held: an agent's capture of the X profile, and a picture an agent drew
  { name: 'x-profile-capture.png', kind: 'file', created_at: '2026-09-19T13:00:00Z', promoted: 0, inline_content: 'data:image/png;base64,iVBORw0KGgo=', created_by_kind: 'agent' },
  { name: 'cover.jpg', kind: 'file', created_at: '2026-09-19T14:00:00Z', promoted: 0, inline_content: 'data:image/jpeg;base64,/9j/4AA=', mime: 'image/jpeg', created_by_kind: 'agent', source: null },
];
const reader = (docs: LibDoc[]) => async () => docs;
/** a reader that knows scopes: the room's rows, and the project's beyond them */
const scoped = (room: LibDoc[], project: LibDoc[]) => async (_ch: string, _limit?: number, scope?: 'room' | 'project' | 'workspace') => (scope === 'room' ? room : [...room, ...project]);

test('a real app screenshot is a person\'s image or a repository file, never an agent\'s capture or drawing', () => {
  assert.equal(isAppShot({ created_by_kind: 'human' }), true);
  assert.equal(isAppShot({ created_by_kind: 'agent', source: 'repo:acme/app/screens/home.png@9c1' }), true);
  assert.equal(isAppShot({ created_by_kind: 'agent' }), false);
  assert.equal(isAppShot({ created_by_kind: 'agent', source: 'web:https://x.com/acme' }), false);
  // a row from a replica that predates the column reads as nobody's: it does not count
  assert.equal(isAppShot({}), false);
});

test('the shelf\'s app screenshots, by name, and a name matched the way the shelf spells it', async () => {
  assert.deepEqual(await appShots(reader(shelf), 'ch'), ['App-Home.png', 'board.jpg']);
  assert.deepEqual(await frameOf(reader(shelf), 'ch', 'app-home.png'), { ok: true, name: 'App-Home.png' });
  assert.deepEqual(await frameOf(reader(shelf), 'ch', 'board.jpg'), { ok: true, name: 'board.jpg' });
});

test('a miss lists the screenshots; an agent\'s image says why it does not count; an empty shelf names the ways out', async () => {
  const miss = await frameOf(reader(shelf), 'ch', 'home.png');
  assert.equal(miss.ok, false);
  assert.match((miss as { why: string }).why, /no image named "home.png".*App screenshots on the shelf: App-Home.png, board.jpg/);
  const capture = await frameOf(reader(shelf), 'ch', 'x-profile-capture.png');
  assert.match((capture as { why: string }).why, /"x-profile-capture.png" is not an app screenshot: an agent made it/);
  const doc = await frameOf(reader(shelf), 'ch', 'business-profile.md');
  assert.equal(doc.ok, false);
  const empty = await frameOf(reader([shelf[0]!, shelf[3]!]), 'ch', 'x.png');
  assert.match((empty as { why: string }).why, /holds no app screenshots.*shelve_repo_screenshot.*upload a screenshot of the app/);
});

test('the shelf widens to the project: the room\'s screenshots first, then the other rooms\' (plan §9)', async () => {
  const elsewhere: LibDoc[] = [{ name: 'pricing.png', kind: 'file', created_at: '2026-09-20T01:00:00Z', promoted: 0, inline_content: 'data:image/png;base64,iVBORw0KGgo=', room: 'build', created_by_kind: 'human' }];
  assert.deepEqual(await appShots(scoped(shelf, elsewhere), 'ch'), ['App-Home.png', 'board.jpg', 'pricing.png']);
  assert.deepEqual(await frameOf(scoped(shelf, elsewhere), 'ch', 'pricing.png'), { ok: true, name: 'pricing.png' });
});

test('the product-shot gate: a SHOW line must name a real app screenshot, and a beat with the app\'s screen on camera must carry one', async () => {
  const lib = reader(shelf);
  assert.equal(await productShotsGate(lib, 'ch', '[0:00-0:03] Hook to camera.\n[0:03-0:07] Cut to the app home screen. SHOW: app-home.png'), null);
  assert.equal(await productShotsGate(lib, 'ch', '[0:00-0:03] Hook to camera.\n[0:03-0:07] Walk through the park.'), null); // no screen on camera: nothing to ask
  assert.match((await productShotsGate(lib, 'ch', '[0:00-0:03] Hook.\n[0:03-0:07] Cut to the app home screen. SHOW: home.png')) ?? '', /beat \[0:03-0:07\] says SHOW: home.png, and no image of that name is on the shelf\. App screenshots on the shelf: App-Home.png, board.jpg\. Name one of them, then draft again\. Take one from the project's repository with shelve_repo_screenshot/);
  // the case George saw: the X profile capture named as the product shot
  assert.match((await productShotsGate(lib, 'ch', '[0:00-0:03] Hook.\n[0:03-0:07] Scroll the feed. SHOW: x-profile-capture.png')) ?? '', /says SHOW: x-profile-capture.png, and "x-profile-capture.png" is not an app screenshot/);
  assert.match((await productShotsGate(lib, 'ch', '[0:00-0:03] Hook.\n[0:03-0:07] Cut to the app home screen.\nSpoken: "Look."')) ?? '', /beat \[0:03-0:07\] puts the app's screen on camera but names no screenshot.*Add `SHOW: <image name>`.*App screenshots on the shelf: App-Home.png, board.jpg\. Take one from/);
  assert.doesNotMatch((await productShotsGate(lib, 'ch', '[0:00-0:03] Cut to the app home screen.')) ?? '', /make_product_image/);
  assert.match((await productShotsGate(reader([shelf[0]!, shelf[3]!]), 'ch', '[0:00-0:03] Close on the phone screen.')) ?? '', /The shelf holds no app screenshots\./);
  // a phone in hand shows no screen: no shot to ask for (George, 2026-10-06: "we don't always need that")
  assert.equal(await productShotsGate(reader([shelf[0]!]), 'ch', '[0:00-0:03] The phone in hand.'), null);
  // over a draft_posts call: the first refusal names its post
  assert.equal(await productShotsFor(lib, 'ch', [{ script: '[0:00-0:03] Hook.' }, { }]), null);
  assert.match((await productShotsFor(lib, 'ch', [{ script: '[0:00-0:03] Hook.' }, { script: '[0:00-0:04] The app on screen.' }])) ?? '', /^Post b: Not yet: beat \[0:00-0:04\]/);
});
