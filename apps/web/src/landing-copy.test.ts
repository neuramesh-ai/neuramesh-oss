// The copy gate: every string a visitor reads on the landing page, checked as a page.
// CLAUDE.md #11 (ASD-STE100) and the 2026-09-07 naming rule (house model names in public).
import { describe, expect, it } from 'vitest';
import * as copy from './copy';

function leaves(v: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof v === 'string') out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) leaves(x, `${path}.${k}`, out);
}

const STRINGS: Array<[string, string]> = [];
for (const [name, value] of Object.entries(copy)) leaves(value, name, STRINGS);
// urls, alt text and glyph names are not read as prose
const PROSE = STRINGS.filter(([p]) => !/\.url$|\.alt$|\.icon$|\.tone$|\.initial$|HQ_URL|APP_STORE_URL|links\[\d+\]\[0\]/.test(p));

describe('landing copy', () => {
  it('reads every string from copy.ts', () => {
    expect(PROSE.length).toBeGreaterThan(80);
  });
  it('carries no em dash and no semicolon', () => {
    for (const [p, s] of PROSE) {
      expect(s, p).not.toMatch(/—|;/);
    }
  });
  it('never names the vendor model behind a house brain', () => {
    const vendorModel = /gemini\s*(3\.5\s*)?flash|flash[\s-]?lite|gpt-?\d|claude-\d|sonnet|opus|haiku/i;
    for (const [p, s] of PROSE) expect(s, p).not.toMatch(vendorModel);
    expect(copy.PROOF.house).toBe('neuramesh Starter');
  });
  it('avoids the present continuous and present perfect', () => {
    for (const [p, s] of PROSE) {
      expect(s, p).not.toMatch(/\b(is|are)\s+\w+ing\b/);
      expect(s, p).not.toMatch(/\b(has|have)\s+\w+ed\b/);
    }
  });
  // Free is your Mac, Pro is the cloud (docs/design/oss-release-2026-09, D3 and artboard F).
  it('keeps the approved hero and the two plans', () => {
    expect(copy.HERO.headline.join(' ')).toBe('From ask to done in minutes.');
    expect(copy.HERO.cta).toBe('Download for Mac');
    expect(copy.HERO.ctaPro).toBe('Get Pro');
    expect(copy.HERO.facts).toEqual(['Free on your Mac', 'Your keys', 'No limits', 'No account']);
    expect(copy.PRICING.title).toBe('Free is your Mac.');
    expect(copy.PRICING.titleMuted).toBe('Pro is the cloud.');
    expect(copy.PRICING.plans.map((p) => `${p.name} ${p.chip} ${p.price}`)).toEqual(['Free Desktop $0', 'Pro Cloud $22']);
    expect(copy.PRICING.plans.map((p) => p.cta)).toEqual(['Download for Mac', 'Get Pro']);
    expect(copy.PRICING.plans.map((p) => p.featured)).toEqual([false, true]);
    const feats = copy.PRICING.plans.map((p) => p.feats.join(' '));
    expect(feats[0]).toContain('The app sets up a small local stack for you');
    expect(feats[1]).toContain('Everything in Free');
    expect(copy.CLOSE.cta).toBe('Download for Mac');
    expect(copy.NAV.start).toBe('Download');
  });
  it('says source available, never open source, and links the public repo', () => {
    expect(copy.FOOTER.source.line).toBe('Source available under the Elastic License 2.0');
    expect(copy.FOOTER.source.url).toBe('https://github.com/neuramesh-ai/neuramesh-oss');
    for (const [p, s] of PROSE) expect(s, p).not.toMatch(/open[\s-]source/i);
  });
  it('retired the old plan names, the credit grant, and the cloud machine at signup', () => {
    for (const [p, s] of PROSE) expect(s, p).not.toMatch(/\bIndividual\b|\bTeam\b|500 credits|500 free credits|No install|at signup/);
  });
  it('links the iPhone row to a live App Store listing', () => {
    expect(copy.APP_STORE_URL).toMatch(/^https:\/\/apps\.apple\.com\/app\/id\d+$/);
  });
  it('shows no placeholder or sample device from the mockups', () => {
    for (const [p, s] of PROSE) expect(s, p).not.toMatch(/\[N min\]|SAMPLE|03:12/i);
  });
});
