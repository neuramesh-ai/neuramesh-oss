import { describe, expect, it } from 'vitest';
import {
  levelOf,
  levelProgress,
  rateDeltaPoints,
  rateOrNull,
  retroWindow,
  xpForLevel,
  xpOf,
} from '../src/retro';

const DAY = 86_400_000;
// a fixed local midnight anchor — the math never calls Date.now()
const DAY0 = Date.parse('2026-07-01T00:00:00Z');

describe('retro xp/levels (docs/13 §4)', () => {
  it('weights the improvement signals deterministically', () => {
    expect(xpOf({ accepted: 0, reviews: 0, plansApproved: 0, lessons: 0, skillsProposed: 0 })).toBe(0);
    expect(xpOf({ accepted: 3, reviews: 2, plansApproved: 1, lessons: 4, skillsProposed: 1 })).toBe(
      3 * 10 + 2 * 3 + 1 * 5 + 4 * 2 + 1 * 5,
    );
  });

  it('levels follow the 10·n² thresholds and never regress between thresholds', () => {
    expect(levelOf(0)).toBe(0);
    expect(levelOf(9)).toBe(0);
    expect(levelOf(10)).toBe(1);
    expect(levelOf(39)).toBe(1);
    expect(levelOf(40)).toBe(2);
    expect(levelOf(90)).toBe(3);
    expect(levelOf(89)).toBe(2);
    expect(xpForLevel(levelOf(160))).toBe(160);
  });

  it('progress-to-next stays in [0,1] and hits the edges', () => {
    expect(levelProgress(10)).toBe(0); // exactly lv1
    expect(levelProgress(25)).toBeCloseTo((25 - 10) / (40 - 10));
    expect(levelProgress(0)).toBe(0);
    expect(levelProgress(39.999)).toBeLessThan(1);
  });

  it('a "leveled up this window" comparison is just two derivations', () => {
    const before = levelOf(xpOf({ accepted: 3, reviews: 0, plansApproved: 0, lessons: 0, skillsProposed: 0 })); // 30xp → lv1
    const after = levelOf(xpOf({ accepted: 4, reviews: 0, plansApproved: 0, lessons: 0, skillsProposed: 0 })); // 40xp → lv2
    expect(after).toBeGreaterThan(before);
  });
});

describe('retro windows (docs/13 §3 — rolling, Home semantics)', () => {
  it('this week = trailing 7 days ending after today', () => {
    const w = retroWindow('week', DAY0);
    expect(w.to - w.from).toBe(7 * DAY);
    expect(w.to).toBe(DAY0 + DAY);
    expect(w.prevTo).toBe(w.from);
    expect(w.prevTo - w.prevFrom).toBe(7 * DAY);
  });

  it('last week sits directly before this week with no gap or overlap', () => {
    const cur = retroWindow('week', DAY0);
    const last = retroWindow('lastweek', DAY0);
    expect(last.to).toBe(cur.from);
    expect(last.to - last.from).toBe(7 * DAY);
  });

  it('quarter uses weekly buckets, the rest daily', () => {
    expect(retroWindow('quarter', DAY0).bucketMs).toBe(7 * DAY);
    expect(retroWindow('month', DAY0).bucketMs).toBe(DAY);
    expect(retroWindow('week', DAY0).bucketMs).toBe(DAY);
  });
});

describe('rate honesty (docs/13 §3 — denominator floors)', () => {
  it('refuses to be a percentage under the floor', () => {
    expect(rateOrNull(2, 2)).toBeNull();
    expect(rateOrNull(0, 0)).toBeNull();
    expect(rateOrNull(2, 3)).toBeCloseTo(2 / 3);
  });

  it('deltas between noisy windows are null, real ones are points', () => {
    expect(rateDeltaPoints({ n: 2, d: 2 }, { n: 3, d: 4 })).toBeNull();
    expect(rateDeltaPoints({ n: 3, d: 4 }, { n: 1, d: 4 })).toBe(50);
    expect(rateDeltaPoints({ n: 1, d: 4 }, { n: 3, d: 4 })).toBe(-50);
  });
});
