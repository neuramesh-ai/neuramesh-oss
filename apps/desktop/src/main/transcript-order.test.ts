// Inline workflow cards are transcript entries, not a sticky footer. Run from apps/desktop:
//   pnpm exec tsx --test src/main/transcript-order.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designRoundAnchor, orderTranscriptEntries } from '../renderer/src/transcript-order';

// The regression this guards: the card used to anchor on the LIFECYCLE move that opened the round,
// so it sorted above every message written while the designers worked and stayed pinned there. It
// now anchors on its first artifact — where the round actually landed.
test('a design round sorts by when its artifacts landed, not when the round opened', () => {
  const roundOpenedAt = new Date('2026-07-24T12:29:00Z').getTime();
  const designAt = designRoundAnchor([
    { created_at: '2026-07-24T13:20:01Z' },
    { created_at: '2026-07-24T13:20:02Z' },
  ], roundOpenedAt);

  const ordered = orderTranscriptEntries([
    { at: roundOpenedAt, order: 0, value: 'round opened' },
    { at: new Date('2026-07-24T13:15:00Z').getTime(), order: 1, value: 'a message written mid-round' },
    { at: new Date('2026-07-24T13:31:00Z').getTime(), order: 2, value: 'planning decision' },
    { at: designAt, order: 10_000, value: 'inline design handoff' },
  ]);

  // the card lands AFTER the mid-round message — the ordering the live thread got wrong
  assert.deepEqual(ordered, ['round opened', 'a message written mid-round', 'inline design handoff', 'planning decision']);
});

test('an inline component follows messages when timestamps tie', () => {
  const at = new Date('2026-07-24T12:29:00Z').getTime();
  assert.deepEqual(orderTranscriptEntries([
    { at, order: 10_000, value: 'inline design handoff' },
    { at, order: 0, value: 'design proposed' },
  ]), ['design proposed', 'inline design handoff']);
});

test('an unparseable or empty artifact set falls back rather than sorting to 1970', () => {
  const fallback = new Date('2026-07-24T12:00:00Z').getTime();
  assert.equal(designRoundAnchor([], fallback), fallback);
  assert.equal(designRoundAnchor([{ created_at: 'not-a-date' }], fallback), fallback);
});
