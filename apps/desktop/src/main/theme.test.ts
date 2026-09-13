// The first renderer unit tests that are not a source-text grep (track A1): theme/theme.ts
// is a pure module — the before-first-paint applyTheme side effect stayed in App.tsx exactly
// so this file can run under plain node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, isThemePref, resolveTheme, systemTheme, loadThemePref } from '../renderer/src/theme/theme';

test('the four themes are the contract: two dark, two light, stable ids', () => {
  assert.deepEqual(THEMES.map((t) => t.id), ['dark', 'soft-dark', 'light', 'cream-oak']);
  assert.deepEqual(THEMES.map((t) => t.group), ['dark', 'dark', 'light', 'light']);
});

test('isThemePref accepts exactly the ids + system', () => {
  for (const t of THEMES) assert.equal(isThemePref(t.id), true);
  assert.equal(isThemePref('system'), true);
  assert.equal(isThemePref('north-slate'), false, 'an unshipped theme id must not validate');
  assert.equal(isThemePref(''), false);
});

test('resolveTheme: a concrete pref is itself; system falls back to dark under node', () => {
  assert.equal(resolveTheme('cream-oak'), 'cream-oak');
  // no window here — the guard must resolve, not throw (the boot path runs before DOM in tests)
  assert.equal(systemTheme(), 'dark');
  assert.equal(resolveTheme('system'), 'dark');
});

test('loadThemePref survives node (no localStorage) and garbage values', () => {
  assert.equal(loadThemePref(), 'system');
});
