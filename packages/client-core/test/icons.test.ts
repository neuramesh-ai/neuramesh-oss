import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ICON_PATHS } from '../src/icons';

// Parity tripwire for the icon sheet: every entry the phone draws must be the inner markup of
// hq's icon, verbatim. A glyph redrawn on one side fails here until both agree — the same
// contract tokens.test.ts holds for colors.
// hq and the phone are private (docs/43), so the public tree has neither side of this parity, and
// there the check skips. A tree that has apps/hq and lost the file still fails.
const HQ = new URL('../../../apps/hq/', import.meta.url);
const hqHere = existsSync(fileURLToPath(HQ));
const src = hqHere ? readFileSync(fileURLToPath(new URL('src/ui/icons.tsx', HQ)), 'utf8') : '';

function hqIcon(name: string): string | null {
  const pascal = name.charAt(0).toUpperCase() + name.slice(1);
  const m = src.match(new RegExp(`export const Icon${pascal} = \\(\\{ s \\}: \\{ s\\?: number \\}\\) => <Svg s=\\{s\\}>([\\s\\S]*?)</Svg>;`));
  return m ? m[1]!.trim() : null;
}

describe('client-core icon sheet parity with hq', () => {
  it.runIf(hqHere)('every entry is hq\'s icon, verbatim', () => {
    const names = Object.keys(ICON_PATHS);
    // the positive control: a matcher that finds nothing would satisfy any per-entry check
    expect(names.length).toBeGreaterThan(40);
    for (const name of names) {
      expect(hqIcon(name), `Icon${name} in hq`).toBe(ICON_PATHS[name as keyof typeof ICON_PATHS]);
    }
  });
  it('uses only the three primitives the phone parses', () => {
    for (const [name, markup] of Object.entries(ICON_PATHS)) {
      const tags = [...markup.matchAll(/<(\w+)/g)].map((m) => m[1]);
      expect(tags.every((t) => t === 'path' || t === 'circle' || t === 'rect'), `${name}: ${tags.join(',')}`).toBe(true);
    }
  });
});
