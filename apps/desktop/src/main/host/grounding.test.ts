// The grounding gate (host/grounding.ts): draft_posts in a marketing room with brand docs on the
// shelf refuses until this turn read one of them, and the refusal names the read that lifts it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listLibrary, newGrounding, readLibraryDoc, ungrounded, type LibraryReader } from './grounding';
import type { LibDoc } from './orchtools';

const doc = (name: string, body: string | null, mime?: string): LibDoc => ({ name, kind: 'doc', created_at: '2026-09-18T05:00:00.000Z', promoted: 0, inline_content: body, ...(mime ? { mime } : {}) });
const SHELF: LibDoc[] = [doc('market-research.md', '# Market'), doc('business-profile.md', '# Flowe AI\n\nA weekly plan from a founder\'s notes.'), doc('logo.png', 'data:image/png;base64,AAAA', 'image/png')];
const reader: LibraryReader = async () => SHELF;

function fakeDb(kind: string, docs: Array<{ name: string; inline_content: string | null }>) {
  return { getAll: async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
    if (sql.includes('from channels c')) return [{ kind, marketing: null, website: 'https://flowe.ai', logo: null }] as T[];
    if (sql.includes('from artifacts')) return docs.map((d) => ({ kind: 'doc', ...d })) as T[]; // a real row always has a kind
    return [];
  } };
}
const twoDocs = [{ name: 'market-research.md', inline_content: '# Market' }, { name: 'business-profile.md', inline_content: '# Flowe' }];

test('a marketing room with brand docs: refused until one is read, the business profile named first, then open', async () => {
  const g = newGrounding();
  const db = fakeDb('marketing', twoDocs);
  const gate = await ungrounded(db, 'ch', g);
  assert.match(gate ?? '', /read_library_doc with name "business-profile\.md" \(scope room\), and market-research\.md/);
  assert.match(gate ?? '', /Then call draft_posts again/);
  // the read records itself on the turn, and the gate opens
  const body = await readLibraryDoc(reader, 'ch', 'business-profile.md', 'room', g);
  assert.match(body, /^# Flowe AI/);
  assert.deepEqual([...g.read], ['business-profile.md']);
  assert.equal(await ungrounded(db, 'ch', g), null);
});

test('no gate outside a marketing room, or for a shelf with no brand docs', async () => {
  assert.equal(await ungrounded(fakeDb('build', twoDocs), 'ch', newGrounding()), null);
  assert.equal(await ungrounded(fakeDb('marketing', [{ name: 'notes.md', inline_content: 'x' }]), 'ch', newGrounding()), null);
});

test('reads that are not reads do not count: a missing name, an image, an empty body', async () => {
  const g = newGrounding();
  assert.match(await readLibraryDoc(reader, 'ch', 'nope.md', 'room', g), /no document named "nope\.md"/);
  assert.match(await readLibraryDoc(reader, 'ch', 'logo.png', 'room', g), /is an image/);
  assert.match(await readLibraryDoc(async () => [doc('empty.md', '   ')], 'ch', 'empty.md', 'room', g), /no readable text body/);
  assert.equal(g.read.size, 0);
  // the name resolves case-insensitively, as the orchestrator's read always did
  await readLibraryDoc(reader, 'ch', 'Business-Profile.md', 'room', g);
  assert.deepEqual([...g.read], ['business-profile.md']);
});

test('the listing names the shelf, and says where a widened scope found each document', async () => {
  const room = JSON.parse(await listLibrary(reader, 'ch', 'room')) as Array<Record<string, unknown>>;
  assert.deepEqual(room.map((d) => d['name']), ['market-research.md', 'business-profile.md', 'logo.png']);
  assert.equal(room[0]!['room'], undefined);
  assert.match(await listLibrary(async () => [], 'ch', 'room'), /library is empty/);
  assert.match(await listLibrary(async () => [], 'ch', 'project'), /no documents in this project/);
});
