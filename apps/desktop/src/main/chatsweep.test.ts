// Dead-letter selection: which human messages does the boot sweep re-run through the
// wake path? Run from apps/desktop:
//   pnpm exec tsx --test src/main/chatsweep.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDeadLetters, type SweepCandidate } from './chatsweep';

const msg = (over: Partial<SweepCandidate>): SweepCandidate => ({
  id: 'm1',
  channel_id: 'ch1',
  task_id: null,
  thread_id: null,
  author_kind: 'human',
  author_id: 'u1',
  body: 'hey rex',
  created_at: '2026-07-10T10:00:00.000Z',
  ...over,
});

test('unanswered channel message is a dead letter', () => {
  const out = pickDeadLetters([msg({})], new Map());
  assert.equal(out.length, 1);
});

test('an agent post AFTER the message clears it — the loop was alive in that room', () => {
  const out = pickDeadLetters([msg({})], new Map([['ch1', '2026-07-10T10:05:00.000Z']]));
  assert.equal(out.length, 0);
});

test('an agent post BEFORE the message does not clear it', () => {
  const out = pickDeadLetters([msg({})], new Map([['ch1', '2026-07-10T09:00:00.000Z']]));
  assert.equal(out.length, 1);
});

test('thread messages key by task, not channel — feed activity does not clear a thread letter', () => {
  const thread = msg({ id: 'm2', task_id: 't1' });
  // the channel feed had later agent chatter, but task t1's thread did not
  const out = pickDeadLetters([thread], new Map([['ch1', '2026-07-10T11:00:00.000Z']]));
  assert.equal(out.length, 1);
  // an agent reply inside the thread clears it
  const cleared = pickDeadLetters([thread], new Map([['t1', '2026-07-10T11:00:00.000Z']]));
  assert.equal(cleared.length, 0);
});

test('an agent post at the exact same instant clears nothing (<= keeps it) — the 0060 index is the dupe guard', () => {
  const out = pickDeadLetters([msg({})], new Map([['ch1', '2026-07-10T10:00:00.000Z']]));
  assert.equal(out.length, 1);
});

// THE BUG (George, 2026-08-29): a chat thread has no task_id, so it fell through to the CHANNEL
// key — and any agent post anywhere in the room cleared it. A message sat unanswered in a busy
// room precisely because the room was busy.
test('a chat thread is its own conversation: a reply in ANOTHER thread does not clear it', () => {
  const mine = msg({ id: 'm-mine', thread_id: 't1', created_at: '2026-07-10T10:00:00.000Z' });
  // an agent spoke in the same channel, in a different thread, afterwards
  const seen = new Map([['t2', '2026-07-10T10:05:00.000Z'], ['ch1', '2026-07-10T10:05:00.000Z']]);
  assert.deepEqual(pickDeadLetters([mine], seen).map((m) => m.id), ['m-mine']);
});

test('…and an answer IN that thread does clear it', () => {
  const mine = msg({ id: 'm-mine', thread_id: 't1', created_at: '2026-07-10T10:00:00.000Z' });
  const seen = new Map([['t1', '2026-07-10T10:05:00.000Z']]);
  assert.deepEqual(pickDeadLetters([mine], seen), []);
});

test('the FEED keeps its channel key — the card flows that argued for it are still on the feed', () => {
  const feed = msg({ id: 'm-feed', thread_id: null, created_at: '2026-07-10T10:00:00.000Z' });
  const seen = new Map([['ch1', '2026-07-10T10:05:00.000Z']]);
  assert.deepEqual(pickDeadLetters([feed], seen), []);
});

test('a TASK thread still keys by task, not by its thread row', () => {
  const t = msg({ id: 'm-task', task_id: 'tk1', thread_id: 'th-of-tk1', created_at: '2026-07-10T10:00:00.000Z' });
  assert.deepEqual(pickDeadLetters([t], new Map([['tk1', '2026-07-10T10:05:00.000Z']])), []);
  // and the thread row's own key must NOT clear it, or task threads regress to the same bug
  assert.deepEqual(pickDeadLetters([t], new Map([['th-of-tk1', '2026-07-10T10:05:00.000Z']])).map((m) => m.id), ['m-task']);
});
