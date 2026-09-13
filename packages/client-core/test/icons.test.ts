import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ICON_PATHS } from '../src/icons';

// Parity tripwire for the icon sheet: every entry the phone draws must be the desktop icon's
// inner markup, verbatim. A glyph redrawn on one side fails here until both agree — the same
// contract tokens.test.ts holds for colors.
const src = readFileSync(fileURLToPath(new URL('../../../apps/desktop/src/renderer/src/ui/icons.tsx', import.meta.url)), 'utf8');

function desktopIcon(name: string): string | null {
  const pascal = name.charAt(0).toUpperCase() + name.slice(1);
  const m = src.match(new RegExp(`export const Icon${pascal} = \\(\\{ s \\}: \\{ s\\?: number \\}\\) => <Svg s=\\{s\\}>([\\s\\S]*?)</Svg>;`));
  return m ? m[1]!.trim() : null;
}

describe('client-core icon sheet parity with the desktop', () => {
  it('every entry is the desktop icon, verbatim', () => {
    const names = Object.keys(ICON_PATHS);
    // the positive control: a matcher that finds nothing would satisfy any per-entry check
    expect(names.length).toBeGreaterThan(40);
    for (const name of names) {
      expect(desktopIcon(name), `Icon${name} on the desktop`).toBe(ICON_PATHS[name as keyof typeof ICON_PATHS]);
    }
  });
  it('uses only the three primitives the phone parses', () => {
    for (const [name, markup] of Object.entries(ICON_PATHS)) {
      const tags = [...markup.matchAll(/<(\w+)/g)].map((m) => m[1]);
      expect(tags.every((t) => t === 'path' || t === 'circle' || t === 'rect'), `${name}: ${tags.join(',')}`).toBe(true);
    }
  });
});
