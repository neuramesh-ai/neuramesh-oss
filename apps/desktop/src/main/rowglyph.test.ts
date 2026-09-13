// The rail row's glyph vocabulary is TOTAL over the FSM: every state resolves to exactly one
// glyph, colour survives only for active states, and the trailing fact has one priority order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_STATES } from '@neuramesh/shared';
import { SETTLED_STATES, WAITING_STATES, renamable, rowGlyphFor, rowTrailFor } from '../renderer/src/lib/rowglyph';

test('every FSM state has a glyph, and only active states keep a hue', () => {
  for (const state of TASK_STATES) {
    const g = rowGlyphFor({ kind: 'task', state, run: false });
    if (WAITING_STATES.has(state)) assert.equal(g, 'circle', state);
    else if (SETTLED_STATES.has(state)) assert.equal(g, 'check', state);
    else assert.equal(g, 'dot', `${state} is active and keeps its state hue`);
  }
  assert.deepEqual([...WAITING_STATES], ['backlog', 'todo']);
  assert.deepEqual([...SETTLED_STATES], ['done', 'accepted', 'closed']);
});

test('a run wears the orb whatever the state; a chat and a routine have no state to colour', () => {
  assert.equal(rowGlyphFor({ kind: 'task', state: 'done', run: true }), 'orb');
  assert.equal(rowGlyphFor({ kind: 'chat', state: null, run: true }), 'orb');
  assert.equal(rowGlyphFor({ kind: 'chat', state: null, run: false }), 'chat');
  assert.equal(rowGlyphFor({ kind: 'routine', state: null, run: false }), 'clock');
  assert.equal(rowGlyphFor({ kind: 'code', state: null, run: false }), 'code', 'an engineering session wears the prompt');
  assert.equal(rowGlyphFor({ kind: 'code', state: null, run: true }), 'orb');
  assert.equal(rowGlyphFor({ kind: 'task', state: 'not-a-state', run: false }), 'dot', 'an unknown state degrades to the old dot, never throws');
});

test('the status word takes the slot when the row has one (settle round, mark M4)', () => {
  const base = { ask: false, run: null, fact: null, when: '2w' };
  for (const status of ['needs_you', 'in_progress', 'settled'] as const) {
    assert.deepEqual(rowTrailFor({ ...base, status, ask: true, run: { done: 2, total: 5 }, fact: '#dev' }), { kind: 'status', status });
  }
  // a row with no status of its own (an engineering session) keeps the old ladder
  assert.deepEqual(rowTrailFor({ ...base, status: null, fact: '#dev' }), { kind: 'fact', text: '#dev' });
});

test('the trailing fact: ask > run progress > the fact the scope does not say > age', () => {
  const base = { ask: false, run: null, fact: null, when: '2w' };
  assert.deepEqual(rowTrailFor({ ...base, ask: true, run: { done: 2, total: 5 }, fact: '#dev' }), { kind: 'ask' });
  assert.deepEqual(rowTrailFor({ ...base, run: { done: 2, total: 5 }, fact: '#dev' }), { kind: 'frac', text: '2/5' });
  assert.deepEqual(rowTrailFor({ ...base, run: { done: 0, total: 0 }, fact: '#dev' }), { kind: 'fact', text: '#dev' }, 'a run with no legs yet has nothing to count');
  assert.deepEqual(rowTrailFor({ ...base, fact: '#dev' }), { kind: 'fact', text: '#dev' });
  assert.deepEqual(rowTrailFor(base), { kind: 'when', text: '2w' });
});

test('rename: chats always, tasks only before work starts, routine runs never', () => {
  assert.equal(renamable('chat', null), true);
  assert.equal(renamable('task', 'todo'), true);
  assert.equal(renamable('task', 'backlog'), true);
  assert.equal(renamable('task', 'in_progress'), false);
  assert.equal(renamable('task', 'done'), false);
  assert.equal(renamable('routine', null), false);
  assert.equal(renamable('code', null), false, 'an engineering session is named by its own runtime');
});
