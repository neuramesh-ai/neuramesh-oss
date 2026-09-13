import { describe, it, expect } from 'vitest';
import { wilson, median, mean, normalize, valueScore } from '../src/stats';

describe('wilson', () => {
  it('is [0,0] at n=0', () => {
    const w = wilson(0, 0);
    expect(w.lo).toBe(0);
    expect(w.hi).toBe(0);
  });
  it('brackets the point estimate and stays in [0,1]', () => {
    const w = wilson(8, 10);
    expect(w.p).toBeCloseTo(0.8);
    expect(w.lo).toBeGreaterThan(0);
    expect(w.lo).toBeLessThan(0.8);
    expect(w.hi).toBeGreaterThan(0.8);
    expect(w.hi).toBeLessThanOrEqual(1);
  });
  it('narrows as n grows', () => {
    const a = wilson(8, 10);
    const b = wilson(80, 100);
    expect(b.hi - b.lo).toBeLessThan(a.hi - a.lo);
  });
});

describe('median / mean', () => {
  it('median of odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
  it('mean', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(mean([])).toBe(0);
  });
});

describe('normalize / valueScore', () => {
  it('normalizes to 0..100; invert flips', () => {
    expect(normalize([0, 5, 10])).toEqual([0, 50, 100]);
    expect(normalize([0, 5, 10], true)).toEqual([100, 50, 0]);
  });
  it('all-equal field → 100 each', () => {
    expect(normalize([5, 5, 5])).toEqual([100, 100, 100]);
  });
  it('valueScore honors the weights', () => {
    expect(valueScore(100, 0, 0, { quality: 1, cost: 0, speed: 0 })).toBe(100);
    expect(valueScore(0, 100, 0, { quality: 0, cost: 1, speed: 0 })).toBe(100);
    expect(valueScore(100, 0, 0, { quality: 0.6, cost: 0.25, speed: 0.15 })).toBe(60);
  });
});
