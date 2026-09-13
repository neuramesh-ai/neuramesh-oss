// The type ramp and the radius scale are the desktop's, by construction (docs/33 §5, §6): the
// radius tokens are read from the desktop's tokens.css, the family names compose to the cuts
// fonts.ts registers, and no screen sets a fontWeight, a system 'monospace' or a positive
// letterSpacing — each of those escapes the ramp silently on iOS.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { F, R } from '../src/type';

const here = resolve(__dirname, '..');
const tokensCss = readFileSync(resolve(here, '../desktop/src/renderer/src/tokens.css'), 'utf8');
const fontsTs = readFileSync(join(here, 'src/fonts.ts'), 'utf8');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name) && name !== 'terminal-html.ts') out.push(p);
  }
  return out;
}
const screens = ['app', 'src', 'components'].flatMap((d) => sources(join(here, d)));

describe('the radius scale is the desktop ramp', () => {
  const token = (name: string) => Number(tokensCss.match(new RegExp(`--r-${name}:\\s*(\\d+)px`))?.[1]);
  it('reads every step from tokens.css', () => {
    expect(R.xs).toBe(token('xs'));
    expect(R.sm).toBe(token('sm'));
    expect(R.md).toBe(token('md'));
    expect(R.lg).toBe(token('lg'));
    expect(R.pill).toBe(token('pill'));
    expect(R.full).toBe(token('full'));
  });
  it('never exceeds 8 except what must be round', () => {
    for (const p of screens) {
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/border(?:Top|Bottom)?(?:Left|Right)?Radius: (\d+)\b/g)) {
        const v = Number(m[1]);
        // a literal above 8 is a circle: half of a stated width on the same line
        if (v > 8) expect(src.slice(m.index! - 200, m.index!), `${p}: radius ${v}`).toMatch(new RegExp(`width: ${v * 2}\\b|size`));
      }
    }
  });
});

describe('the type ramp composes the registered cuts', () => {
  it('names the families fonts.ts registers', () => {
    expect(F.body(500).fontFamily).toBe('NeuraMeshSans_500Medium');
    expect(F.mono(400).fontFamily).toBe('GeistMono_400Regular');
    expect(F.display().fontFamily).toBe('NeuraMeshSans_500Medium');
    for (const w of [400, 500, 600] as const) {
      expect(fontsTs).toContain(F.body(w).fontFamily);
      expect(fontsTs).toContain(F.mono(w).fontFamily);
    }
  });
  it('tracks tight, never letterspaced', () => {
    expect(F.track).toBeLessThan(0);
    expect(F.tight(24)).toBe(-0.48);
    expect(F.tight(10)).toBe(-0.2);
  });
  it('is the only way a screen picks a face or a weight', () => {
    for (const p of screens) {
      const src = readFileSync(p, 'utf8');
      expect(src, p).not.toMatch(/fontWeight:\s*['"]/);
      expect(src, p).not.toMatch(/fontFamily:\s*['"]/);
      expect(src, p).not.toMatch(/letterSpacing:\s*0\.\d/);
      expect(src, p).not.toMatch(/fontStyle:\s*'italic'/);
      expect(src, p).not.toMatch(/F\.serif/);
    }
  });
});
