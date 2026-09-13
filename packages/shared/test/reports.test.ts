// The report parse (docs/design/marketing-os-2026-08): the honesty spine as a shape check.
// A doc is a report ONLY with a Score head and the gaps section — the guard and the card
// both read this one parse, so a gapless report can neither ship nor wear a dial.
import { describe, expect, it } from 'vitest';
import { parseReportRef, reportFacts, reportFrom, reportTrend } from '../src/reports';

const REPORT = `# Site & funnel audit — joinflowe.com
2026-08-20 · Score: 72/100 · Basis: live site, pricing, top post

## The one thing
Every conversion finding traces back to a headline that never names who this is for.

## Scorecard
| Dimension | Score | Weight | Verdict |
|---|---|---|---|
| Messaging | 64 | 25% | generic |
| Conversion | 58 | 20% | leaking |
| Search | 71 | 20% | functional |
| Competitive | 78 | 15% | strong |
| Trust | 82 | 10% | strong |
| Growth | 70 | 10% | functional |

## Fix these first
1. Replace the headline with one that names the audience.
2. One primary CTA; demote the second.
3. Move the proof beside the claim it supports.

## What's already working
- The pricing table is legible.

## What I couldn't determine
- Pricing-page conversion path (gated).
- Paid-traffic quality (no ads data attached).
`;

describe('reportFrom', () => {
  it('parses the shape contract: score head, dims table, fix-first count, gaps text', () => {
    const r = reportFrom('audit-report.md', REPORT)!;
    expect(r.title).toBe('Site & funnel audit — joinflowe.com');
    expect(r.score).toBe(72);
    expect(r.basis).toBe('live site, pricing, top post');
    expect(r.dims.map((d) => `${d.label}:${d.score}`)).toEqual([
      'Messaging:64', 'Conversion:58', 'Search:71', 'Competitive:78', 'Trust:82', 'Growth:70',
    ]);
    expect(r.fixFirst).toBe(3);
    expect(r.gaps).toContain('Pricing-page conversion path');
    expect(reportFacts(r)).toBe('basis: live site, pricing, top post · scores are heuristics, not measured performance');
  });

  it('refuses a doc with no gaps section — the guard and the card share this refusal', () => {
    const gapless = REPORT.replace(/## What I couldn't determine[\s\S]*$/, '');
    expect(reportFrom('r.md', gapless)).toBeNull();
  });

  it('refuses a doc with no score head, a late score, or an out-of-range score', () => {
    expect(reportFrom('r.md', '# T\n\nprose\n\n## What I couldn’t determine\nnone')).toBeNull();
    const late = '# T\n\nprose\n\nmore\n\nlines\n\nScore: 70/100\n\n## What I couldn’t determine\nnone';
    expect(reportFrom('r.md', late)).toBeNull();
    expect(reportFrom('r.md', '# T\nScore: 140/100\n\n## What I couldn’t determine\nnone')).toBeNull();
  });

  it('accepts the curly-apostrophe gaps heading and an empty gaps body', () => {
    const curly = '# T\nAug · Score: 50/100 · Basis: x\n\n## What I couldn’t determine\n';
    const r = reportFrom('r.md', curly)!;
    expect(r.score).toBe(50);
    expect(r.gaps).toBe('');
  });
});

describe('parseReportRef', () => {
  it('lifts the marker and keeps the prose — the wb/article anatomy', () => {
    expect(parseReportRef('Done — the report.\n\n‹report:a91f›')).toEqual({ id: 'a91f', prose: 'Done — the report.' });
    expect(parseReportRef('no marker')).toBeNull();
  });
});

describe('reportTrend', () => {
  it('latest + delta vs previous; a first run wears no delta', () => {
    const t = reportTrend([
      { id: 'b', created_at: '2026-08-20T00:00:00Z', score: 72 },
      { id: 'a', created_at: '2026-07-20T00:00:00Z', score: 63 },
    ]);
    expect(t.latest?.id).toBe('b');
    expect(t.delta).toBe(9);
    expect(t.prevAt).toBe('2026-07-20T00:00:00Z');
    expect(t.runs.map((r) => r.id)).toEqual(['a', 'b']);
    expect(reportTrend([{ id: 'a', created_at: '2026-07-20T00:00:00Z', score: 63 }]).delta).toBeNull();
    expect(reportTrend([]).latest).toBeNull();
  });
});
