import { describe, it, expect } from 'vitest';
import { PRICING, costUsd, isPriced } from '../src/pricing';
import { LABELS, isLabeled } from '../src/labels';
import { JUDGES } from '../src/judge';
import { resolveModels, allCurrentModels } from '../src/catalog';
import { AGENT_ROLES, MODEL_RATES, PACK_ORDER, STARTER_MODEL, providerForModel } from '@neuramesh/shared';
import { SUITE_VERSION, assembleReport } from '../src/report';
import { mergeSkips } from '../src/merge';

describe('pricing', () => {
  it('THROWS on an unpriced model instead of costing zero', () => {
    // a $0 row wins pickWinner's value tiebreak outright, so a forgotten PRICING entry used to
    // crown the newest model silently. The throw is the whole point of this test.
    expect(() => costUsd('claude-imaginary-9', 1000, 1000)).toThrow(/no PRICING row/);
  });

  it('prices a known model per million tokens', () => {
    expect(costUsd('claude-sonnet-5', 1e6, 0)).toBeCloseTo(2, 6);
    expect(costUsd('claude-sonnet-5', 0, 1e6)).toBeCloseTo(10, 6);
  });

  it('every model the catalog OFFERS carries a price and a label', () => {
    // the pre-flight the CLI runs, asserted here so CI catches a catalog add that skipped a mirror
    for (const m of allCurrentModels()) {
      expect(isPriced(m.id), `no PRICING row for ${m.id}`).toBe(true);
      expect(isLabeled(m.id), `no LABELS row for ${m.id}`).toBe(true);
    }
  });

  it('resolveModels refuses a model it cannot price or label', () => {
    expect(() => resolveModels('claude-sonnet-5')).not.toThrow();
    expect(() => resolveModels('gemini-2.5-pro')).toThrow(/no PRICING row|no LABELS row/);
  });

  it('every judge is priced, labeled, and one per family', () => {
    const families = Object.keys(JUDGES) as (keyof typeof JUDGES)[];
    expect(families.sort()).toEqual(['anthropic', 'gemini', 'openai']);
    for (const f of families) {
      expect(providerForModel(JUDGES[f])).toBe(f);
      expect(isPriced(JUDGES[f])).toBe(true);
      expect(isLabeled(JUDGES[f])).toBe(true);
    }
  });

  it('labels every model it prices', () => {
    for (const id of Object.keys(PRICING)) expect(LABELS[id], `no label for ${id}`).toBeTruthy();
  });
});

describe('suite version', () => {
  it('is the version the report stamps', () => {
    const r = assembleReport(
      { reviewer: [{ model: 'claude-sonnet-5', runs: 1, quality: 90, ci: [80, 95], primary: 0.9, costUsd: 0.01, latencyMs: 1000 }] },
      { runsPerTask: 1, suiteSha: 'abc1234', generatedAt: '2026-09-07' },
    ) as { meta: { version: string; judges: Record<string, string>; skipped: unknown[]; settings: Record<string, string> } };
    expect(r.meta.version).toBe(SUITE_VERSION);
    // provenance the page reads: who judged, what was skipped, what settings ran
    expect(r.meta.judges).toEqual(JUDGES);
    expect(r.meta.skipped).toEqual([]);
    expect(Object.keys(r.meta.settings).sort()).toEqual(['anthropic', 'gemini', 'openai']);
  });

  it('projects EVERY pack seat, not a hard-coded four', () => {
    const r = assembleReport(
      { reviewer: [{ model: 'claude-sonnet-5', runs: 1, quality: 90, ci: [80, 95], primary: 0.9, costUsd: 0.01, latencyMs: 1000 }] },
      { runsPerTask: 1, suiteSha: 'abc1234', generatedAt: '2026-09-07' },
    ) as { packs: { id: string; roles: Record<string, string> }[] };
    // a pack that gains a seat, or a whole new pack, must reach the page without a code change
    expect(r.packs.map((p) => p.id)).toEqual([...PACK_ORDER]);
    for (const p of r.packs) {
      expect(Object.keys(p.roles).sort()).toEqual([...AGENT_ROLES].sort());
    }
  });
});

describe('skipped records survive a multi-invocation run', () => {
  const agg = (model: string) => ({ model, runs: 5, quality: 90, ci: [80, 95] as [number, number], primary: 0.9, costUsd: 0.01, latencyMs: 1000 });

  it('carries a first invocation\'s skip into the last one\'s report', () => {
    // the objective run lost a model; the judged run knows nothing about it, and writes the file
    const prior = [{ model: 'gpt-6-astra', role: 'developer' as const, reason: 'ran out of output budget' }];
    const out = mergeSkips(prior, [], { developer: [agg('claude-sonnet-5')], research: [agg('gpt-6-astra')] });
    expect(out).toEqual(prior);
  });

  it('drops a skip once that pair has produced a row', () => {
    const prior = [{ model: 'gpt-6-astra', role: 'developer' as const, reason: 'ran out of output budget' }];
    const out = mergeSkips(prior, [], { developer: [agg('gpt-6-astra')] });
    expect(out).toEqual([]);
  });

  it('a fresh reason replaces a stale one for the same pair', () => {
    const prior = [{ model: 'gpt-6-astra', role: 'developer' as const, reason: 'old reason' }];
    const fresh = [{ model: 'gpt-6-astra', role: 'developer' as const, reason: 'new reason' }];
    expect(mergeSkips(prior, fresh, {})).toEqual(fresh);
  });

  it('keeps skips for different roles of the same model apart', () => {
    const prior = [
      { model: 'gpt-6-astra', role: 'developer' as const, reason: 'a' },
      { model: 'gpt-6-astra', role: 'research' as const, reason: 'b' },
    ];
    const out = mergeSkips(prior, [], { developer: [agg('gpt-6-astra')] });
    expect(out).toEqual([{ model: 'gpt-6-astra', role: 'research', reason: 'b' }]);
  });
});

describe('prices are pinned to what the vendor page said, per model', () => {
  // Verified against each vendor's own pricing page on 2026-09-07. This test exists because the
  // same pass got 3.1 Flash-Lite wrong by reading the row BELOW it: the two Flash-Lite rows sit
  // together on Google's page and are NOT the same price, and the newer one is dearer. A price
  // decides a seat through the value tiebreak, so an unverified edit should have to argue with a
  // failing test rather than slip through.
  const VERIFIED: [string, number, number][] = [
    ['claude-fable-5-1', 10, 50],
    ['claude-opus-5', 5, 25],
    ['claude-sonnet-5', 2, 10], // the 2026-09-01 rise to 3/15 was cancelled
    ['claude-haiku-4-5', 1, 5],
    ['gpt-6-astra', 10, 50],
    ['gpt-5.6-sol', 4, 20], // promotional at least through 2026-11-21
    ['gpt-5.6-terra', 2, 12],
    ['gpt-5.4-mini', 0.75, 4.5],
    ['gemini-3.8-flash', 0.75, 3.75], // introductory through 2026-12-31, then 1.50 / 7.50
    ['gemini-3.5-flash', 1.5, 9],
    ['gemini-3.1-pro-preview', 2, 12],
    ['gemini-3.1-flash-lite', 0.25, 1.5],
    ['gemini-3.5-flash-lite', 0.3, 2.5],
  ];

  for (const [id, inPer1M, outPer1M] of VERIFIED) {
    it(`${id} is $${inPer1M} / $${outPer1M}`, () => {
      expect(PRICING[id]).toEqual({ inPer1M, outPer1M });
    });
  }

  it('the two Flash-Lite tiers are priced apart, newer being dearer', () => {
    // the exact confusion this suite made once: they are adjacent rows, not one row
    expect(PRICING['gemini-3.5-flash-lite']!.inPer1M).toBeGreaterThan(PRICING['gemini-3.1-flash-lite']!.inPer1M);
    expect(PRICING['gemini-3.5-flash-lite']!.outPer1M).toBeGreaterThan(PRICING['gemini-3.1-flash-lite']!.outPer1M);
  });

  it('the starter brain price matches the ledger that meters it', () => {
    // rates.ts bills real credits at these numbers; a drift here silently misprices the free tier
    expect(PRICING[STARTER_MODEL]).toEqual({ inPer1M: MODEL_RATES[STARTER_MODEL]!.inPerMTok / 1e6, outPer1M: MODEL_RATES[STARTER_MODEL]!.outPerMTok / 1e6 });
  });
});
