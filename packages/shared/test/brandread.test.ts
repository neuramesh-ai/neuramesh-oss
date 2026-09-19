// The brand read (brandread.ts), one for the desktop's researcher and the public door: the declared
// ground, ink and accent before the tally, so a paper-and-ember site never gets a card in its chart
// colors, and the researcher's summary starts from what the site says it is.
import { describe, expect, it } from 'vitest';
import { brandSummary, brandTokens, customProperties, tallyPalette, themeColors  } from '../src/brandread';

// neuramesh.app's own tokens, both themes, as its stylesheet declares them (2026-09-18)
const NM_CSS = `:root{--paper:#f5f4f2;--ink:#0c0b0a;--accent:#834a2b;--accent2:#b4713f;--accent-soft:#f1e3d2;--viz-1:#77ac8d;--viz-2:#4f7bb0}
@media (prefers-color-scheme: dark){:root{--paper:#0d0d0d;--ink:#e8e6e3;--accent:#c58a63;--accent2:#d9a87e}}
.chart{fill:#4f7bb0}.x{color:#6a63bc}`;
const NM_HTML = `<head><meta name="theme-color" media="(prefers-color-scheme: light)" content="#f5f4f2" /><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0d0d0d" /></head>`;

describe('brandTokens', () => {
  it('reads every declared property, both themes, in order', () => {
    const p = customProperties(NM_CSS);
    expect(p.get('paper')).toEqual(['#f5f4f2', '#0d0d0d']);
    expect(p.get('accent')).toEqual(['#834a2b', '#c58a63']);
    expect(p.get('accent-soft')).toEqual(['#f1e3d2']);
  });
  it('reads the theme-color metas', () => {
    expect(themeColors(NM_HTML)).toEqual(['#f5f4f2', '#0d0d0d']);
  });
  it('neuramesh.app: the dark ground, the light ink, the ember that reads on it', () => {
    expect(brandTokens(NM_CSS, NM_HTML)).toEqual({ bg: '#0d0d0d', ink: '#e8e6e3', accent: '#c58a63' });
  });
  it('a light-only site: its ground is the light paper, its ink the dark text, and the accent still reads', () => {
    expect(brandTokens(':root{--bg:#fffdf8;--text:#1a1a1a;--primary:#0f62fe}', '')).toEqual({ bg: '#fffdf8', ink: '#1a1a1a', accent: '#0f62fe' });
  });
  it('a site with no tokens declares nothing, and the theme-color alone gives a ground', () => {
    expect(brandTokens('.a{color:#123456}', '')).toEqual({});
    expect(brandTokens('', '<meta name="theme-color" content="#101820">')).toEqual({ bg: '#101820' });
  });
  it('an accent-soft or accent-ink never stands in for the accent, and a grey accent is no accent', () => {
    expect(brandTokens(':root{--paper:#0d0d0d;--ink:#e8e6e3;--accent-soft:#2b211a;--accent:#333333}', '')).toEqual({ bg: '#0d0d0d', ink: '#e8e6e3' });
  });
  it('the researcher\'s summary leads with the declared set, then the tally, then the fonts', () => {
    const read = { tokens: brandTokens(NM_CSS, NM_HTML), palette: tallyPalette(NM_CSS, 3), fonts: ['NeuraMesh Sans'] };
    expect(brandSummary(read).split('\n')).toEqual(['declared: ground #0d0d0d · ink #e8e6e3 · accent #c58a63', 'painted most: #4f7bb0, #6a63bc, #77ac8d', 'fonts: NeuraMesh Sans']);
    expect(brandSummary({ tokens: {}, palette: [], fonts: [] })).toBe('');
  });
});

describe('the scans cost the input once (CodeQL js/polynomial-redos, 2026-09-19)', () => {
  it('customProperties: the index scan agrees with the regex it replaced, and a flood of `--a` is fast', () => {
    const css = ':root{--accent: #E63946; --bg:#fff;--ink : #0a0a0a; --not-a-color: 12px; --x:#12345g; --Y:#ABC}';
    const want = new Map<string, string[]>();
    for (const m of css.matchAll(/--([a-z][a-z0-9-]*)\s*:\s*(#(?:[0-9a-f]{3}|[0-9a-f]{6}))\b/gi)) {
      const name = m[1]!.toLowerCase();
      const hex = m[2]!.length === 4 ? `#${m[2]![1]}${m[2]![1]}${m[2]![2]}${m[2]![2]}${m[2]![3]}${m[2]![3]}`.toLowerCase() : m[2]!.toLowerCase();
      const list = want.get(name) ?? [];
      if (!list.includes(hex)) list.push(hex);
      want.set(name, list);
    }
    expect(customProperties(css)).toEqual(want);
    const t0 = performance.now();
    expect(customProperties('--a'.repeat(30_000)).size).toBe(0);
    expect(performance.now() - t0).toBeLessThan(200);
  });
  it('themeColors: one meta tag at a time, and a flood of names without a closing bracket is fast', () => {
    expect(themeColors('<meta charset="utf-8"><META name="theme-color" content="#F7EFE2"><meta name=\'theme-color\' content=\'#101010\'><metadata name="theme-color" content="#123456">')).toEqual(['#f7efe2', '#101010']);
    const t0 = performance.now();
    expect(themeColors('<meta ' + 'name="theme-color"'.repeat(20_000))).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

