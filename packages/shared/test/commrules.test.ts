// The workspace voice (docs/design/agent-comm-rules-2026-08): defaults, the block, the scrub.
import { describe, expect, it } from 'vitest';
import { COMM_RULE_CAPS, commRulesFrom, houseStyleBlock, scrubEmdash, withHouseStyle } from '../src/commrules';

describe('commRulesFrom — defaults ON, opt-out stored explicitly', () => {
  it('null / garbage / empty all mean the defaults', () => {
    for (const raw of [null, undefined, 'nope', 42, {}]) {
      expect(commRulesFrom(raw)).toEqual({ ste100: true, noEmdash: true, custom: [] });
    }
  });
  it('explicit false turns a rule off; custom rules are trimmed, capped, and length-clamped', () => {
    const r = commRulesFrom({ ste100: false, custom: ['  a rule  ', '', 'x'.repeat(500), ...Array(20).fill('more')] });
    expect(r.ste100).toBe(false);
    expect(r.noEmdash).toBe(true);
    expect(r.custom[0]).toBe('a rule');
    expect(r.custom[1]!.length).toBe(COMM_RULE_CAPS.chars);
    expect(r.custom.length).toBe(COMM_RULE_CAPS.rules);
  });
});

describe('houseStyleBlock — the exact text every surface agrees on', () => {
  it('renders enabled rules + custom lines, and says it supersedes', () => {
    const b = houseStyleBlock(commRulesFrom({ custom: ['Dates are absolute.'] }))!;
    expect(b).toContain('supersedes');
    expect(b).toContain('em dashes');
    expect(b).toContain('STE-100');
    expect(b).toContain('- Dates are absolute.');
  });
  it('all-off renders nothing at all — no empty header ever reaches a prompt', () => {
    expect(houseStyleBlock(commRulesFrom({ ste100: false, noEmdash: false }))).toBeNull();
    expect(withHouseStyle('sys', null)).toBe('sys');
  });
  it('withHouseStyle appends LAST', () => {
    const out = withHouseStyle('sys', houseStyleBlock(commRulesFrom(null)));
    expect(out.indexOf('sys')).toBe(0);
    expect(out.endsWith('three words.')).toBe(true);
  });
});

describe('scrubEmdash — teeth for prose, hands off code', () => {
  it('mid-sentence dash becomes a comma; dash before a capital becomes a period', () => {
    expect(scrubEmdash('fast — safe — Done')).toBe('fast, safe. Done');
  });
  it('fences and inline code are untouched', () => {
    const s = 'before — after `a — b` and\n```\nx — y\n```\nend — Z';
    const out = scrubEmdash(s);
    expect(out).toContain('`a — b`');
    expect(out).toContain('x — y');
    expect(out).toContain('before, after');
    expect(out).toContain('end. Z');
  });
  it('en dashes are covered too', () => {
    expect(scrubEmdash('2020 – 2021')).toBe('2020, 2021');
  });
});
