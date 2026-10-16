import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { DEFAULT_THEME_PREF, THEMES, applyTheme, isThemePref, loadThemePref, lookOf, resolveTheme, type ThemePref } from './theme';

const boot = readFileSync(new URL('../../public/theme-boot.js', import.meta.url), 'utf8');
const prefs: ThemePref[] = ['system', 'paper-system', ...THEMES.map((t) => t.id)];

function withGlobals(values: Record<string, unknown>, run: () => void) {
  const old = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true });
    run();
  } finally {
    for (const key of Object.keys(values)) {
      const descriptor = old[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test('every preference resolves consistently before paint and at runtime, for both system palettes', () => {
  assert.equal(DEFAULT_THEME_PREF, 'system');
  assert.equal(boot.match(/var DEFAULT = '([^']+)'/)![1], DEFAULT_THEME_PREF);
  for (const light of [false, true]) {
    const matchMedia = () => ({ matches: light });
    withGlobals({ window: { matchMedia } }, () => {
      for (const pref of [...prefs, '', 'paper', 'graphite']) {
        const dataset: Record<string, string> = {};
        const localStorage = { getItem: (key: string) => key === 'nm:theme' ? pref : null };
        runInNewContext(boot, { window: { localStorage, matchMedia }, matchMedia, document: { documentElement: { dataset } } });
        const id = resolveTheme(isThemePref(pref) ? pref : DEFAULT_THEME_PREF);
        assert.equal(dataset['theme'], id, `${pref}, light=${light}`);
        assert.equal(dataset['look'], lookOf(id));
      }
      assert.equal(resolveTheme('paper-system'), light ? 'paper-light' : 'paper-dark');
      assert.equal(resolveTheme('system'), light ? 'light' : 'soft-dark');
    });
  }
});

test('saved choices, invalid values, and blocked storage', () => {
  for (const pref of [...prefs, null, 'paper', 'graphite', '']) {
    withGlobals({ localStorage: { getItem: () => pref } }, () => {
      assert.equal(loadThemePref(), pref && isThemePref(pref) ? pref : DEFAULT_THEME_PREF);
    });
  }
  const localStorage = { getItem() { throw new Error('denied'); } };
  withGlobals({ localStorage }, () => assert.equal(loadThemePref(), DEFAULT_THEME_PREF));
  const dataset: Record<string, string> = {};
  const matchMedia = () => ({ matches: true });
  runInNewContext(boot, { window: { localStorage, matchMedia }, matchMedia, document: { documentElement: { dataset } } });
  assert.equal(dataset['theme'], 'light');
  assert.equal(dataset['look'], 'elevated');
  for (const value of ['paper', '', 'graphite']) assert.equal(isThemePref(value), false);
  for (const theme of THEMES) assert.equal(lookOf(theme.id), theme.id.startsWith('paper-') ? 'paper' : 'elevated');
});

test('switches palette and look atomically, repairs missing look, and clears transitions after paint', () => {
  const dataset: Record<string, string> = { theme: 'paper-dark' };
  let next = 0;
  const frames = new Map<number, FrameRequestCallback>();
  withGlobals({ document: { documentElement: { dataset } }, requestAnimationFrame: (fn: FrameRequestCallback) => { frames.set(++next, fn); return next; }, cancelAnimationFrame: (id: number) => frames.delete(id) }, () => {
    applyTheme('paper-dark');
    assert.deepEqual(dataset, { theme: 'paper-dark', look: 'paper', themeSwitch: '' });
    applyTheme('cream-oak');
    assert.deepEqual(dataset, { theme: 'cream-oak', look: 'elevated', themeSwitch: '' });
    assert.equal(frames.size, 1);
    for (let i = 0; i < 2; i++) {
      const [id, fn] = [...frames][0]!;
      frames.delete(id);
      fn(0);
    }
    assert.equal(dataset['themeSwitch'], undefined);
    applyTheme('cream-oak');
    assert.equal(frames.size, 0);
  });
});

test('paper text and diff colors meet 4.5:1 on every paper surface', () => {
  const css = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/../g)!.map((v) => parseInt(v, 16) / 255).map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
  };
  const contrast = (a: string, b: string) => {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  };
  for (const { id } of THEMES.filter((theme) => theme.look === 'paper')) {
    const block = css.split(`[data-theme='${id}'] {`)[1]!.split('}')[0]!;
    const color = (token: string) => block.match(new RegExp(`--${token}: (#[a-f0-9]{6})`))![1]!;
    for (const ink of ['text', 'body', 'muted', 'dim', 'warn']) for (const surface of ['bg', 'panel2', 'panel3']) {
      assert.ok(contrast(color(ink), color(surface)) >= 4.5, `${id}: ${ink} on ${surface}`);
    }
    for (const diff of ['diff-add', 'diff-del']) assert.ok(contrast(color(diff), color(`${diff}-bg`)) >= 4.5, `${id}: ${diff}`);
  }
});
