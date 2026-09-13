import { describe, it, expect } from 'vitest';
import { pickWinner } from '../src/report';
import type { ModelRoleAggregate } from '../src/types';

const A = (model: string, quality: number, ci: [number, number], costUsd: number): ModelRoleAggregate => ({
  model,
  runs: 10,
  quality,
  ci,
  primary: quality / 100,
  costUsd,
  latencyMs: 1000,
});

describe('pickWinner', () => {
  it('a clear margin (CI-low above the runner-up) → top wins outright', () => {
    const w = pickWinner([A('claude-opus-4-8', 92, [89, 95], 0.4), A('gpt-5.5', 80, [75, 85], 0.3)]);
    expect(w.model).toBe('claude-opus-4-8');
    expect(w.note).toContain('clear margin');
  });
  it('overlapping CIs within the margin → the cheaper level model wins on value', () => {
    const w = pickWinner([A('claude-opus-4-8', 91, [87, 94], 0.22), A('gemini-3.5-flash', 90, [86, 93], 0.02)]);
    expect(w.model).toBe('gemini-3.5-flash');
    expect(w.note).toContain('value decides it');
  });
  it('a cheaper but clearly-worse model (outside the margin) does NOT win despite CI touch', () => {
    // 100 vs 86: CI upper of the cheap one touches the top CI-low, but it's >3 points worse
    const w = pickWinner([A('claude-opus-4-8', 100, [93, 100], 0.02), A('gemini-3.1-flash-lite', 86, [74, 93], 0.0001)]);
    expect(w.model).toBe('claude-opus-4-8');
  });
});
