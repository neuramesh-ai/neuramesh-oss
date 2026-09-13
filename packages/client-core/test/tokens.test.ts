import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CSS_VAR, THEMES, type Theme, type ThemeName } from '../src/tokens';

// Parity tripwire for the brand palette: read tokens.css and assert every hex the
// mobile app ships matches the desktop stylesheet, per theme. A rebrand or a tweak
// on one side fails here until both agree.
const css = readFileSync(fileURLToPath(new URL('../../../apps/desktop/src/renderer/src/tokens.css', import.meta.url)), 'utf8');

// The { … } declaration block whose selector contains `marker`.
function blockVars(marker: string): Record<string, string> {
  const at = css.indexOf(marker);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  const vars: Record<string, string> = {};
  for (const m of css.slice(open + 1, close).matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]!] = m[2]!.trim();
  // resolve single-level var(--x) aliases to the block's own value, so a token defined as
  // `--accent: var(--text)` compares against THEMES' concrete hex (mobile ships hexes, the
  // desktop stylesheet may alias one brand token to another).
  for (const k of Object.keys(vars)) {
    const ref = vars[k]!.match(/^var\(--([\w-]+)\)$/);
    if (ref && vars[ref[1]!] !== undefined) vars[k] = vars[ref[1]!]!;
  }
  return vars;
}

const MARKERS: Record<ThemeName, string> = {
  dark: "[data-theme='dark']",
  light: "[data-theme='light']",
  'soft-dark': "[data-theme='soft-dark']",
  'cream-oak': "[data-theme='cream-oak']",
};

describe('client-core theme tokens parity with tokens.css', () => {
  for (const name of Object.keys(MARKERS) as ThemeName[]) {
    it(`${name}: every hex token matches the stylesheet`, () => {
      const declared = blockVars(MARKERS[name]);
      const theme = THEMES[name];
      for (const key of Object.keys(theme) as (keyof Theme)[]) {
        expect(declared[CSS_VAR[key]]).toBe(theme[key]);
      }
    });
  }
});
