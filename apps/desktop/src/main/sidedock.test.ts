// The side dock's rules (shell/sidedock-state.ts) — what it draws, what ⌘digits reach, and when
// the fold moves on its own. Pure functions over the tab model, so the dock's behaviour is tested
// here rather than eyeballed in the harness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockActiveId, dockFoldAfter, dockKeyTarget, dockTabs } from '../renderer/src/shell/sidedock-state';
import type { WTab } from '../renderer/src/wtabs';

const conv: WTab = { id: 'c', kind: 'conversation', title: '#build' };
const file: WTab = { id: 'f', kind: 'file', title: 'a.ts', path: '/r/a.ts', root: '/r' };
const term: WTab = { id: 't', kind: 'terminal', title: '~' };

test('the dock draws every tab but the conversation, in strip order', () => {
  assert.deepEqual(dockTabs([conv, file, term]).map((t) => t.id), ['f', 't']);
  assert.deepEqual(dockTabs([conv]), []);
});

test('the fronted tab is the active guest, else the last guest — the conversation never fronts the dock', () => {
  assert.equal(dockActiveId([conv, file, term], 'f'), 'f');
  // the model's active id names the conversation, or nothing, or a tab that is gone: the last guest fronts
  assert.equal(dockActiveId([conv, file, term], 'c'), 't');
  assert.equal(dockActiveId([conv, file, term], null), 't');
  assert.equal(dockActiveId([conv, file, term], 'gone'), 't');
  assert.equal(dockActiveId([conv], 'c'), null);
  assert.equal(dockActiveId([], null), null);
});

test('⌘1 is the composer; ⌘2 onwards are the guests in strip order; past the end is nothing', () => {
  assert.deepEqual(dockKeyTarget([conv, file, term], 1), { kind: 'composer' });
  assert.deepEqual(dockKeyTarget([conv, file, term], 2), { kind: 'tab', id: 'f' });
  assert.deepEqual(dockKeyTarget([conv, file, term], 3), { kind: 'tab', id: 't' });
  assert.equal(dockKeyTarget([conv, file, term], 4), null);
  assert.deepEqual(dockKeyTarget([conv], 1), { kind: 'composer' });
});

test('a guest coming to the front unfolds; the last guest leaving folds; a switch or a human fold is left alone', () => {
  assert.equal(dockFoldAfter({ active: null, count: 0 }, { active: 'f', count: 1 }), 'open');
  assert.equal(dockFoldAfter({ active: 'f', count: 1 }, { active: 'f', count: 1 }), null);
  assert.equal(dockFoldAfter({ active: 'f', count: 2 }, { active: 't', count: 2 }), 'open');
  assert.equal(dockFoldAfter({ active: 'f', count: 1 }, { active: null, count: 0 }), 'close');
  // closing one of two leaves the dock as it is — the heir is already fronted
  assert.equal(dockFoldAfter({ active: 'f', count: 2 }, { active: 'f', count: 1 }), null);
  // nothing ever opened: no verdict, the stored fold stands
  assert.equal(dockFoldAfter({ active: null, count: 0 }, { active: null, count: 0 }), null);
});
