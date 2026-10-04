// One review family, one tab (review-round.ts), the side-panel round (2026-10-03).
// Run from apps/hq: pnpm test
//
// Four things hold: a round collects only its own mockups, in the order they landed · a re-open
// keeps the mockup you read unless you name another · a re-read sees a round grow and a mockup
// change · a new version replaces the tab's content unless an automatic open meets your unsent batch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familyEntry, refreshRev, reviewKey, reviewTitle, roundMockupsOf, roundStage, stageMockup, type FamilyOpen, type ReviewEntry } from './review-round';

const arts = [
  { id: 'p2', kind: 'doc', name: 'implementation-plan-v2.md', content: '# plan' },
  { id: 'a1', kind: 'design', name: 'design-mockup-v1-summary.html', content: '<p>v1</p>' },
  { id: 'b2', kind: 'design', name: 'design-mockup-v2-summary-wide.html', content: '<p>wide</p>' },
  { id: 'c2', kind: 'design', name: 'design-mockup-v2-summary-phone.html', content: '<p>phone</p>' },
  { id: 'd2', kind: 'design', name: 'design-mockup-v2-empty-state.html', content: null },
];

test('a round collects its own mockups with bytes, in the order they landed', () => {
  assert.deepEqual(roundMockupsOf(arts, 2).map((m) => m.id), ['b2', 'c2']);
  assert.deepEqual(roundMockupsOf(arts, 1).map((m) => m.id), ['a1']);
  assert.deepEqual(roundMockupsOf(arts, 0), []);
  assert.equal(reviewKey('design', 't1'), 'design:t1');
  assert.equal(reviewTitle('design', 'design-mockup-v2-summary-wide.html'), 'Design round 2');
  assert.equal(reviewTitle('plan', 'implementation-plan-v3.md'), 'Plan v3');
  assert.equal(reviewTitle('ship', 'ship-plan-v1.md'), 'Release plan v1');
});

test('a mockup posted again under its own name keeps its place and takes the newest bytes', () => {
  const again = [...arts, { id: 'b2x', kind: 'design', name: 'design-mockup-v2-summary-wide.html', content: '<p>wide, redrawn</p>' }];
  const ms = roundMockupsOf(again, 2);
  assert.deepEqual(ms.map((m) => m.id), ['b2x', 'c2']);
  assert.equal(ms[0]!.content, '<p>wide, redrawn</p>');
});

test('the stage: the named mockup, else the one read last, else the first', () => {
  const ms = roundMockupsOf(arts, 2);
  assert.equal(roundStage(ms, 'design-mockup-v2-summary-phone.html').id, 'c2');
  assert.equal(roundStage(ms, null, ms[1]).id, 'c2');
  assert.equal(roundStage(ms, null, { id: 'gone', name: 'x', content: '' }).id, 'b2');
  assert.equal(roundStage(ms, null, { id: 'old-row', name: 'design-mockup-v2-summary-phone.html', content: '' }).id, 'c2', 'a mockup is its name');
  assert.equal(roundStage(ms, 'not-in-the-round.html').id, 'b2');
});

const entry = (): ReviewEntry => {
  const mockups = roundMockupsOf(arts, 2);
  return { artifact: mockups[0]!, mockups, rounds: arts.map((a) => ({ name: a.name, content: a.content ?? '' })), taskId: 't1', channelId: 'ch', taskNumber: 7 };
};

test('a pick puts a mockup on stage, and a pick outside the round changes nothing', () => {
  const revs = { [reviewKey('design', 't1')]: entry() };
  const next = stageMockup(revs, reviewKey('design', 't1'), 'c2');
  assert.equal(next[reviewKey('design', 't1')]!.artifact.id, 'c2');
  assert.equal(stageMockup(revs, reviewKey('design', 't1'), 'a1'), revs, 'a mockup of another round');
  assert.equal(stageMockup(revs, reviewKey('design', 't1'), 'b2'), revs, 'already on stage');
  assert.equal(stageMockup(revs, 'design:t9', 'c2'), revs, 'no such tab');
});

test('a re-read sees the round grow and the stage change, and nothing when nothing moved', () => {
  const rev = entry();
  assert.equal(refreshRev(rev, arts, rev.rounds), null);
  const grown = [...arts.slice(0, 4), { ...arts[4]!, content: '<p>empty</p>' }];
  const r1 = refreshRev(rev, grown, grown.map((a) => ({ name: a.name, content: a.content ?? '' })));
  assert.deepEqual(r1?.mockups?.map((m) => m.id), ['b2', 'c2', 'd2']);
  const rewritten = arts.map((a) => (a.id === 'b2' ? { ...a, content: '<p>wide, again</p>' } : a));
  const r2 = refreshRev(rev, rewritten, rewritten.map((a) => ({ name: a.name, content: a.content ?? '' })));
  assert.equal(r2?.artifact.content, '<p>wide, again</p>');
  const reposted = [...arts, { id: 'b2x', kind: 'design', name: 'design-mockup-v2-summary-wide.html', content: '<p>wide, redrawn</p>' }];
  const r3 = refreshRev(rev, reposted, reposted.map((a) => ({ name: a.name, content: a.content ?? '' })));
  assert.equal(r3?.artifact.id, 'b2x', 'the stage follows the name to the new row');
  assert.equal(r3?.artifact.content, '<p>wide, redrawn</p>');
});

test('a plan review never grows mockups', () => {
  const plan: ReviewEntry = { artifact: { id: 'p2', name: 'implementation-plan-v2.md', content: '# plan' }, rounds: [], taskId: 't1', channelId: 'ch', taskNumber: 7 };
  const r = refreshRev(plan, arts, [{ name: 'implementation-plan-v2.md', content: '# plan' }]);
  assert.equal(r?.mockups, undefined);
  assert.equal(r?.artifact.content, '# plan');
});

const planOpen = (v: number, over: Partial<FamilyOpen> = {}): FamilyOpen => ({
  kind: 'plan', artifact: { id: `p${v}`, name: `implementation-plan-v${v}.md`, content: `# plan v${v}` }, name: null,
  rounds: Array.from({ length: v }, (_, i) => ({ name: `implementation-plan-v${i + 1}.md`, content: `# plan v${i + 1}` })),
  taskId: 't1', channelId: 'ch', taskNumber: 7, ...over,
});

test('a new version of a plan replaces the tab, and the head wears new', () => {
  const first = familyEntry(undefined, planOpen(1), { auto: true, batch: 0 });
  assert.equal(first.entry.artifact.name, 'implementation-plan-v1.md');
  assert.equal(first.entry.isNew, undefined, 'a first open is not new');
  const next = familyEntry(first.entry, planOpen(2), { auto: true, batch: 0 });
  assert.equal(next.kept, false);
  assert.equal(next.entry.artifact.name, 'implementation-plan-v2.md');
  assert.equal(next.entry.isNew, true);
  const again = familyEntry(next.entry, planOpen(2), { auto: false, batch: 0 });
  assert.equal(again.entry.isNew, true, 'a re-open of the same version keeps the mark');
});

test('an automatic open never replaces a version you are commenting on, and your own click does', () => {
  const v1 = familyEntry(undefined, planOpen(1), { auto: true, batch: 0 }).entry;
  const held = familyEntry(v1, planOpen(2), { auto: true, batch: 2 });
  assert.equal(held.kept, true);
  assert.equal(held.entry.artifact.name, 'implementation-plan-v1.md', 'your version stays on stage');
  assert.equal(held.entry.rounds.length, 2, 'the rounds move on, so the binding turns superseded and offers v2');
  const clicked = familyEntry(held.entry, planOpen(2), { auto: false, batch: 2 });
  assert.equal(clicked.kept, false);
  assert.equal(clicked.entry.artifact.name, 'implementation-plan-v2.md');
});

test('a design round keeps the mockup you read, and a new round starts on the one you named or the first', () => {
  const r2 = roundMockupsOf(arts, 2);
  const open2 = (name: string | null): FamilyOpen => ({ kind: 'design', artifact: r2[0]!, mockups: r2, name, rounds: [], taskId: 't1', channelId: 'ch', taskNumber: 7 });
  const picked = familyEntry(undefined, open2('design-mockup-v2-summary-phone.html'), { auto: false, batch: 0 }).entry;
  assert.equal(picked.artifact.id, 'c2');
  assert.equal(familyEntry(picked, open2(null), { auto: true, batch: 0 }).entry.artifact.id, 'c2', 'the same round keeps your pick');
  const r1 = roundMockupsOf(arts, 1);
  const older = familyEntry(undefined, { ...open2(null), artifact: r1[0]!, mockups: r1 }, { auto: true, batch: 0 }).entry;
  const newer = familyEntry(older, open2(null), { auto: true, batch: 0 });
  assert.equal(newer.entry.artifact.id, 'b2', 'a new round starts on its first mockup');
  assert.equal(newer.entry.isNew, true);
});
