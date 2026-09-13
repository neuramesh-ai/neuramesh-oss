// The support page reads as the landing does (CLAUDE.md #11, the house model rule). The FAQ
// answers are JSX, so this reads the source: every line a visitor can read, comments excluded.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRICING, PROOF } from './copy';

const src = readFileSync(resolve(__dirname, 'support.tsx'), 'utf8');
const visible = src.split('\n').filter((l) => !l.trim().startsWith('//'));
const faqStart = src.indexOf('export const SUPPORT_FAQ');
const faq = src.slice(faqStart, src.indexOf('];', faqStart));
const answers = [...faq.matchAll(/a: <>([\s\S]*?)<\/>,/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ''));

describe('support copy', () => {
  it('carries no em dash outside comments', () => {
    for (const l of visible) expect(l).not.toContain('—');
  });
  it('answers every question as STE', () => {
    expect(answers.length).toBeGreaterThanOrEqual(10);
    for (const a of answers) {
      expect(a).not.toMatch(/;|&[a-z]+;/);
      expect(a).not.toMatch(/\b(is|are)\s+\w+ing\b/);
      expect(a).not.toMatch(/\b(has|have)\s+\w+ed\b/);
      expect(a).not.toMatch(/gemini\s*(3\.5\s*)?flash|flash[\s-]?lite|gpt-?\d|claude-\d|sonnet|opus|haiku/i);
    }
  });
  it('states the plans and the house brain as the landing does', () => {
    const all = answers.join(' ');
    expect(all).toContain(PROOF.house);
    for (const p of PRICING.plans) expect(all).toContain(p.name);
    expect(all).toContain('$22 per seat per month');
    expect(all).toContain('The app sets up a small local stack for you');
    expect(all).toContain('1,500 credits per seat');
    expect(all).not.toMatch(/Local plan|BYOK|desktop app assembles|\bIndividual\b|\bTeam\b|500 credits a month|open[\s-]source/);
  });
});
