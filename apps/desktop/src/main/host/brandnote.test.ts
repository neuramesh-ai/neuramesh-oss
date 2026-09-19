// The brand note a conversation carries (host/brandnote.ts): where the brand lives and the tools
// that reach it, or the ask and the shelf when the room has none yet (George, 2026-09-19).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brandNote, readBrand } from './brandnote';

const PROFILE = `# Business profile\n\nFlowe AI turns a founder's notes into a weekly plan.\n\n## Who it is for\n\nSolo founders who ship every week.\n${'A line of detail.\n'.repeat(120)}`;

function fakeDb(rows: { channel?: Record<string, unknown>; docs?: Array<{ name: string; inline_content: string | null }>; conns?: Array<{ provider: string; handle: string | null }> }) {
  return {
    getAll: async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
      if (sql.includes('from channels c')) return (rows.channel ? [rows.channel] : []) as T[];
      if (sql.includes('from artifacts')) return (rows.docs ?? []) as T[];
      if (sql.includes('from connectors')) return (rows.conns ?? []) as T[];
      return [];
    },
  };
}

test('a marketing room: the product, the docs by name, and the tool that reads them', async () => {
  const db = fakeDb({
    channel: { kind: 'marketing', marketing: JSON.stringify({ website: 'https://flowe.ai', goal: 'first 100 paying teams', focus: ['founders'] }), website: null, logo: 'x' },
    docs: [
      { name: 'brand-guidelines.md', inline_content: '# Brand' },
      { name: 'business-profile.md', inline_content: PROFILE },
      { name: 'business-profile.md', inline_content: 'an older copy' }, // superseded by name: the newest wins
      { name: 'notes.md', inline_content: 'not a brand doc' },
      { name: 'market-research.md', inline_content: null }, // no body: not on the shelf
    ],
    conns: [{ provider: 'x', handle: '@joinflowe' }],
  });
  const b = await readBrand(db, 'ch1');
  assert.deepEqual([...b.docs.keys()], ['brand-guidelines.md', 'business-profile.md']);
  assert.equal(b.docs.get('business-profile.md'), PROFILE);
  const note = await brandNote(db, 'ch1');
  assert.match(note, /^\n\n\[MARKETING CONTEXT/);
  assert.match(note, /Product: https:\/\/flowe\.ai \(logo on file\)\./);
  assert.match(note, /Growth goal: first 100 paying teams\./);
  assert.match(note, /Brand docs on this room's shelf: brand-guidelines\.md, business-profile\.md\. Read them with read_library_doc \(scope room\) before you draft/);
  assert.doesNotMatch(note, /Never say/, 'guidance on the tools, not a forbidden sentence');
  assert.doesNotMatch(note, /Flowe AI turns/, 'the docs are read with the tool, not recited in the prompt');
  assert.doesNotMatch(note.replace(/MARKETING CONTEXT —/, ''), /—|;/, 'STE in the note itself');
});

test('a marketing room with no brand docs: the tools that widen the search, then the ask, then the shelf', async () => {
  const note = await brandNote(fakeDb({ channel: { kind: 'marketing', marketing: null, website: null, logo: null } }), 'ch3');
  assert.match(note, /This room has no brand docs yet \(the marketing setup writes business-profile\.md, brand-guidelines\.md, market-research\.md, social-strategy\.md\)/);
  assert.match(note, /list_library with scope project in case they live in another room of this project/);
  assert.doesNotMatch(note, /workspace/, 'another project is another product: the search never widens past the project');
  assert.match(note, /ask the human for the product facts you need before you draft, or to finish the marketing setup, and shelve what you learn with propose_library_doc/);
});

test('outside a marketing room: no note at all', async () => {
  assert.equal(await brandNote(fakeDb({ channel: { kind: 'build', marketing: null, website: null, logo: null } }), 'ch2'), '');
  assert.equal(await brandNote(fakeDb({}), 'ch4'), '');
});
