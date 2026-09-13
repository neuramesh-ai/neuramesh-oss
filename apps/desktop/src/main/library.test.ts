// The channel Library's shelving rules — the regression that matters is a room full of generated
// art reading "0 items" under Media, so the drawn-picture projection is pinned here.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { channelLibrary, drawnPostRows, postImageName, latestByName, briefFileName, type DraftedPost, type LibraryRow } from './library';

const THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const post = (over: Partial<DraftedPost> = {}): DraftedPost => ({
  id: 'ci-1',
  body: 'Body wrecked, mind still sprinting through tomorrow\'s standup.',
  media: JSON.stringify({ brief: 'warm gold key light', thumb: THUMB }),
  task_id: 't-1031',
  created_at: '2026-07-25T10:00:00.000Z',
  ...over,
});
const art = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  id: 'a-1', kind: 'doc', name: 'brand-guidelines.md', mime: 'text/markdown', inline_content: '# Brand',
  size_bytes: 6, promoted: 1, message_id: null, task_id: null, created_at: '2026-07-21T10:00:00.000Z', ...over,
});

test('a drafted picture becomes a Media row carrying its synced thumb', () => {
  const [row] = drawnPostRows([post()]);
  assert.ok(row);
  assert.equal(row.kind, 'image'); // the Media folder filters on kind/mime — this is what catches it
  assert.equal(row.mime, 'image/jpeg');
  assert.equal(row.inline_content, THUMB);
  assert.equal(row.task_id, 't-1031');
  assert.equal(row.id, 'ci-1'); // the content item IS the identity — nothing new is minted
});

test('the post it was drawn for names it, so six drafts are six distinguishable tiles', () => {
  const rows = drawnPostRows([
    post({ id: 'a', body: 'Body wrecked, mind still sprinting through tomorrow\'s standup.' }),
    post({ id: 'b', body: 'NSDR isn\'t "lying down with an app." It\'s a specific protocol.' }),
  ]);
  assert.equal(rows[0]?.name, 'Body wrecked, mind still sprinting through tom…');
  assert.equal(rows[1]?.name, 'NSDR isn\'t "lying down with an app." It\'s a sp…');
  assert.notEqual(rows[0]?.name, rows[1]?.name);
});

test('a name collapses whitespace, never breaks a tile, and survives an empty body', () => {
  assert.equal(postImageName('  two   lines\n  of copy '), 'two lines of copy');
  assert.equal(postImageName(''), 'post image');
  assert.equal(postImageName(null), 'post image');
  assert.ok(postImageName('x'.repeat(400)).length <= 47);
  assert.equal(postImageName('short enough'), 'short enough'); // no ellipsis when it fits
});

test('drafts with no picture of our own stay off the shelf', () => {
  assert.deepEqual(drawnPostRows([post({ media: null })]), []);
  assert.deepEqual(drawnPostRows([post({ media: '{"brief":"a hero shot"}' })]), []); // brief, never drawn
  assert.deepEqual(drawnPostRows([post({ media: '{"image_url":"https://elsewhere/x.png"}' })]), []); // not ours
  assert.deepEqual(drawnPostRows([post({ media: 'not json at all' })]), []);
  assert.deepEqual(drawnPostRows([post({ media: '{"thumb":"https://elsewhere/x.png"}' })]), []); // must be inline bytes
});

test('the shelf merges artifacts and pictures into one newest-first list', () => {
  const rows = channelLibrary(
    [art({ id: 'old', created_at: '2026-07-21T10:00:00.000Z' }), art({ id: 'newest', created_at: '2026-07-26T10:00:00.000Z' })],
    [post({ id: 'drawn', created_at: '2026-07-25T10:00:00.000Z' })],
  );
  assert.deepEqual(rows.map((r) => r.id), ['newest', 'drawn', 'old']);
});

test('a room with no marketing drafts shelves exactly its artifacts', () => {
  const arts = [art()];
  assert.deepEqual(channelLibrary(arts, []), arts);
});

// ── What an agent reads off the shelf ────────────────────────────────────────────────────────

test('an agent reads the NEWEST copy of each doc, never a superseded one', () => {
  // a live room carried six `result.md` rows; handing all six to a model spends its context on
  // stale copies and lets it answer from one that has already been rewritten
  const rows = [
    { name: 'result.md', v: 'newest' },
    { name: 'brand-guidelines.md', v: 'only' },
    { name: 'result.md', v: 'older' },
    { name: 'result.md', v: 'oldest' },
  ];
  assert.deepEqual(latestByName(rows), [
    { name: 'result.md', v: 'newest' },
    { name: 'brand-guidelines.md', v: 'only' },
  ]);
});

test('latestByName preserves the order it was given and passes an empty shelf through', () => {
  assert.deepEqual(latestByName([]), []);
  const rows = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  assert.deepEqual(latestByName(rows), rows);
});

test('a library name cannot escape the staging dir', () => {
  // the name is DATA — an agent wrote it — so traversal has to be impossible, not discouraged
  for (const evil of ['../../.ssh/config', '/etc/passwd', '..\\..\\win.ini', '....//x', './../../a']) {
    const out = briefFileName(evil);
    assert.ok(!out.includes('/'), `${evil} → ${out} still has a separator`);
    assert.ok(!out.includes('\\'), `${evil} → ${out} still has a separator`);
    assert.ok(!out.includes('..'), `${evil} → ${out} still has a dot-run`);
    assert.ok(!out.startsWith('.'), `${evil} → ${out} is a dotfile`);
  }
});

test('an ordinary library name is left alone, and an extension-less one becomes markdown', () => {
  assert.equal(briefFileName('brand-guidelines.md'), 'brand-guidelines.md');
  assert.equal(briefFileName('business-profile.md'), 'business-profile.md');
  assert.equal(briefFileName('Market Research'), 'Market-Research.md'); // readable, and Glob-able
  assert.equal(briefFileName('logo.png'), 'logo.png');                  // a real extension survives
  assert.equal(briefFileName(''), 'doc.md');
  assert.equal(briefFileName('///'), 'doc.md');                         // nothing left ⇒ still a file
  assert.ok(briefFileName('x'.repeat(400)).length <= 80);
});

// The contract write_library_doc rests on (agents.ts). The library had NO writer at all — an
// orchestrator asked to update brand-guidelines.md truthfully answered that it could not, then
// proposed adding a developer to the room, which would not have helped: nobody had a write path.
// The tool writes an artifact under the SAME name and relies on this to make it the live version,
// so the ordering contract is the feature, not an implementation detail.
test('a re-written library doc replaces the old one — newest-first in, newest kept', () => {
  // libraryDocs selects `order by created_at desc`, so the newest row arrives FIRST
  const rows = [
    { name: 'brand-guidelines.md', created_at: '2026-08-03T10:00:00Z', body: 'merged: visual + messaging' },
    { name: 'brand-guidelines.md', created_at: '2026-08-01T09:00:00Z', body: 'visual identity only' },
    { name: 'positioning.md', created_at: '2026-08-02T09:00:00Z', body: 'positioning' },
  ];
  const shelf = latestByName(rows);
  assert.equal(shelf.length, 2);                                   // one row per name
  assert.equal(shelf[0]?.body, 'merged: visual + messaging');      // the REWRITE wins, not the original
  assert.ok(shelf.every((r) => r.name !== undefined));
  // and the doc that was never rewritten is untouched
  assert.equal(shelf.find((r) => r.name === 'positioning.md')?.body, 'positioning');
});
