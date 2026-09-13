import { describe, it, expect } from 'vitest';
import { scoreReviews } from '../src/grade/reviewer';
import { parseReviewVerdict } from '@neuramesh/shared';
import { benchReviewUserPrompt, reviewVerdictSystem } from '../src/contracts';

describe('scoreReviews (positive class = changes)', () => {
  it('a perfect reviewer → F1 1, no false approves', () => {
    const s = scoreReviews([
      { label: 'changes', verdict: 'changes' },
      { label: 'approve', verdict: 'approve' },
      { label: 'changes', verdict: 'changes' },
    ]);
    expect(s.f1).toBe(1);
    expect(s.falseApproveRate).toBe(0);
    expect(s.accuracy).toBe(1);
  });
  it('a missed defect is a false approve and dents recall', () => {
    const s = scoreReviews([
      { label: 'changes', verdict: 'approve' }, // missed defect
      { label: 'changes', verdict: 'changes' },
      { label: 'approve', verdict: 'approve' },
    ]);
    expect(s.fn).toBe(1);
    expect(s.falseApproveRate).toBeCloseTo(0.5);
    expect(s.recall).toBeCloseTo(0.5);
  });
  it('a rubber-stamp approver catches nothing (F1 0, false-approve 1)', () => {
    const s = scoreReviews([
      { label: 'changes', verdict: 'approve' },
      { label: 'changes', verdict: 'approve' },
      { label: 'approve', verdict: 'approve' },
    ]);
    expect(s.f1).toBe(0);
    expect(s.falseApproveRate).toBe(1);
  });
});

describe('parseReviewVerdict — strict, never fail-open', () => {
  it('parses a clean verdict', () => {
    expect(parseReviewVerdict('{"verdict":"changes","reason":"x"}').verdict).toBe('changes');
  });
  it('parses a verdict embedded in prose', () => {
    expect(parseReviewVerdict('Sure: {"verdict":"approve","reason":"ok"} done').verdict).toBe('approve');
  });
  it('recovers the verdict from a truncated reply (reason cut off at max_tokens)', () => {
    // a ```json fence + verdict, but the reason ran out of tokens (no closing quote/brace)
    const truncated = '```json\n{"verdict":"changes","reason":"The off-by-one in lastPage means exact multiples yield an ext';
    expect(parseReviewVerdict(truncated).verdict).toBe('changes');
  });
  it('THROWS on unparseable output instead of silently approving', () => {
    expect(() => parseReviewVerdict('lgtm, ship it')).toThrow();
    expect(() => parseReviewVerdict('{"verdict":"maybe"}')).toThrow();
    expect(() => parseReviewVerdict('')).toThrow();
  });
});

describe('benchReviewUserPrompt — composed from the SHIPPED reviewer contract', () => {
  it('gates on the Definition of Done and lists the delivered artifacts', () => {
    const p = benchReviewUserPrompt({
      definitionOfDone: 'DoD-XYZ',
      artifacts: [{ kind: 'diff', name: 'a.patch' }],
      workerSummary: 'did it',
    });
    expect(p).toContain('AUTHORITATIVE acceptance contract');
    expect(p).toContain('DoD-XYZ');
    expect(p).toContain('[diff] a.patch');
    expect(p).not.toContain('${'); // every contract placeholder substituted
  });
  it('the system prompt is the live contract, drift-proof clauses included', () => {
    const sys = reviewVerdictSystem();
    expect(sys).toContain('strict reviewer');
    // the clause the stale shared copy famously LACKED — proving we read the real file
    expect(sys).toContain('If team lessons are listed below');
  });
});
