// THE STREAM STORE — presence that does not churn, and a reply that lands instead of vanishing.
//
// Every consumer used to hold the growing text in React state, so each delta (twenty to sixty a
// second, on two keys for a conversation) re-rendered the whole shell and the open thread. The
// store (thread/streamstore.ts) keeps the text outside React: presence changes identity only when
// something a surface draws changes, and `done` keeps the final text as a LANDING entry until the
// thread's rows carry the reply.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { acceptStreamEvent, clearLanding, landedRow, readLanding, readPresence, readText } from './streamstore';

describe('presence', () => {
  test('keeps its identity across deltas, and changes when text starts or the agent swaps', () => {
    const k = 'c1:t-presence';
    acceptStreamEvent({ key: k, agent: 'rex', text: '', done: false });
    const thinking = readPresence(k);
    assert.deepEqual(thinking, { key: k, agent: 'rex', typing: false });
    acceptStreamEvent({ key: k, agent: 'rex', text: 'On it', done: false });
    const typing = readPresence(k);
    assert.notEqual(typing, thinking, 'the first token is a change a surface draws');
    for (let i = 0; i < 50; i++) acceptStreamEvent({ key: k, agent: 'rex', text: `On it ${'word '.repeat(i)}`, done: false });
    assert.equal(readPresence(k), typing, 'fifty deltas later: the same object, so nothing above the bubble re-renders');
    assert.equal(readText(k)!.endsWith('word '), true, 'while the text itself follows every delta');
    acceptStreamEvent({ key: k, agent: 'iris', text: 'hi', done: false });
    assert.notEqual(readPresence(k), typing, 'an agent swap is a change');
  });
});

describe('landing', () => {
  test('a reply that drew text lands: presence ends, the final text stays until its row arrives', () => {
    const k = 'c1:t-land';
    acceptStreamEvent({ key: k, agent: 'rex', text: 'The whole reply.', done: false });
    acceptStreamEvent({ key: k, agent: 'rex', text: '', done: true });
    assert.equal(readPresence(k), null);
    assert.deepEqual(readLanding(k), { key: k, agent: 'rex', typing: true, landing: true });
    assert.equal(readText(k), 'The whole reply.', 'the bubble keeps drawing the final text');
    clearLanding(k);
    assert.equal(readLanding(k), null);
    assert.equal(readText(k), null);
  });
  test('a presence-only wake (no text) simply ends — there is nothing to land', () => {
    const k = 'c1:t-empty';
    acceptStreamEvent({ key: k, agent: 'rex', text: '', done: false });
    acceptStreamEvent({ key: k, agent: 'rex', text: '', done: true });
    assert.equal(readPresence(k), null);
    assert.equal(readLanding(k), null);
  });
  test('a new stream on the key replaces a landing', () => {
    const k = 'c1:t-again';
    acceptStreamEvent({ key: k, agent: 'rex', text: 'first', done: false });
    acceptStreamEvent({ key: k, agent: 'rex', text: '', done: true });
    acceptStreamEvent({ key: k, agent: 'rex', text: 'second', done: false });
    assert.equal(readLanding(k), null);
    assert.equal(readPresence(k)?.typing, true);
    clearLanding(k);
  });
  test('the reply row is the NEW agent row by the streaming agent — not an old one, not a human', () => {
    const seen = new Set(['m1', 'm2']);
    const rows = [
      { id: 'm1', author_kind: 'human', author_id: 'u1' },
      { id: 'm2', author_kind: 'agent', author_id: 'a-rex' },
    ];
    assert.equal(landedRow(rows, seen, 'a-rex'), undefined, 'nothing new yet');
    assert.equal(landedRow([...rows, { id: 'm3', author_kind: 'human', author_id: 'u1' }], seen, 'a-rex'), undefined, 'a human row is not the reply');
    assert.equal(landedRow([...rows, { id: 'm4', author_kind: 'agent', author_id: 'a-iris' }], seen, 'a-rex'), undefined, 'another agent is not the reply');
    assert.equal(landedRow([...rows, { id: 'm5', author_kind: 'agent', author_id: 'a-rex' }], seen, 'a-rex')?.id, 'm5');
  });
});
