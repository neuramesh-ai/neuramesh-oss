import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTranscript } from './merge';

const row = (id: string, at: string) => ({ id, created_at: at });

test('the conversation and the unit\'s own rows interleave by time, and a row both name appears once', () => {
  const convo = [row('ask', '2026-09-20T02:41:06.885Z'), row('card', '2026-09-20T02:41:08.403Z'), row('created', '2026-09-20T02:41:09.400Z')];
  const own = [row('plan', '2026-09-20T02:41:08.450Z'), row('card', '2026-09-20T02:41:08.403Z'), row('claimed', '2026-09-20T02:51:00.000Z')];
  assert.deepEqual(mergeTranscript(convo, own).map((m) => m.id), ['ask', 'card', 'plan', 'created', 'claimed']);
});

test('a tie on time orders by id, so two renders agree', () => {
  assert.deepEqual(mergeTranscript([row('b', 't')], [row('a', 't')]).map((m) => m.id), ['a', 'b']);
  assert.deepEqual(mergeTranscript([], []), []);
});
