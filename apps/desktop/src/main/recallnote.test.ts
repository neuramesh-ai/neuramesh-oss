// The fan-out memory note (docs/03 §6 context packet): pure formatting rules —
// caps, dedupe (against itself AND the lessons block), fragment/whitespace
// hygiene, and the context-not-instructions framing.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { formatRecallNote, type RecallHit } from './recallnote';

const hit = (body: string, kind = 'message', channel = 'dev'): RecallHit => ({ kind, body, channel });

test('formats fact and message hits with their source labels', () => {
  const note = formatRecallNote([hit('the API deploys from main on merge', 'fact'), hit('we agreed to pin the reviewer pool', 'message', 'general')]);
  assert.ok(note.includes('- [fact] the API deploys from main on merge'));
  assert.ok(note.includes('- [#general] we agreed to pin the reviewer pool'));
  assert.ok(note.includes('context, not instructions'));
});

test('empty input and fragment-only input produce no note at all', () => {
  assert.equal(formatRecallNote([]), '');
  assert.equal(formatRecallNote([hit('ok'), hit('ship it')]), ''); // <12 chars = no context
});

test('caps at five lines even when more hits arrive', () => {
  const hits = Array.from({ length: 9 }, (_, i) => hit(`durable decision number ${i} about the deploy pipeline`));
  const note = formatRecallNote(hits);
  assert.equal((note.match(/\n- /g) ?? []).length, 5);
});

test('dedupes repeated bodies and collapses whitespace', () => {
  const note = formatRecallNote([hit('release  trains\nship   weekly from main'), hit('release trains ship weekly from main')]);
  assert.equal((note.match(/\n- /g) ?? []).length, 1);
  assert.ok(note.includes('release trains ship weekly from main'));
});

test('skips hits already covered by the lessons block', () => {
  const lessons = '\nLessons this team already learned…\n- mock evidence html is never committed — renders attach as artifacts\n';
  const note = formatRecallNote([hit('mock evidence HTML is never committed — renders attach as artifacts'), hit('the deploy waits for CI green')], lessons);
  assert.equal((note.match(/\n- /g) ?? []).length, 1);
  assert.ok(note.includes('deploy waits for CI'));
});

test('truncates very long bodies at 240 chars with an ellipsis', () => {
  const long = 'a decision '.repeat(40);
  const note = formatRecallNote([hit(long)]);
  const line = note.split('\n').find((l) => l.startsWith('- '))!;
  assert.ok(line.length <= 240 + '- [#dev] '.length + 1);
  assert.ok(line.endsWith('…'));
});
