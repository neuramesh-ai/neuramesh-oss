// The rule one beat bills by (machine-beat.ts beatCharge), without a database. The SQL that reads the
// window runs against the real schema in test/always-on-billing.pg.test.ts.
import { describe, expect, it } from 'vitest';
import { ALWAYS_ON_MAX_WINDOW_S, beatCharge } from './machine-beat.js';

describe('beatCharge: what one heartbeat bills', () => {
  it('a normal machine: the active seconds only, whatever the window', () => {
    expect(beatCharge(0, false, 30)).toEqual({ billedSeconds: 0, alwaysOnSeconds: 0 });
    expect(beatCharge(12, false, 30)).toEqual({ billedSeconds: 12, alwaysOnSeconds: 0 });
  });

  it('an Always on machine idle for a beat: the whole window, priced as active', () => {
    expect(beatCharge(0, true, 30)).toEqual({ billedSeconds: 30, alwaysOnSeconds: 30 });
  });

  it('active seconds inside the window are not charged twice: max, never the sum', () => {
    expect(beatCharge(20, true, 30)).toEqual({ billedSeconds: 30, alwaysOnSeconds: 10 });
    // a beat that reports more work than wall time (a late beat): the work, and no Always on extra
    expect(beatCharge(35, true, 30)).toEqual({ billedSeconds: 35, alwaysOnSeconds: 0 });
  });

  it('a gap (down, a lost network) bills at most the cap, and a negative or empty window nothing', () => {
    expect(beatCharge(0, true, 3600)).toEqual({ billedSeconds: ALWAYS_ON_MAX_WINDOW_S, alwaysOnSeconds: ALWAYS_ON_MAX_WINDOW_S });
    expect(beatCharge(0, true, -5)).toEqual({ billedSeconds: 0, alwaysOnSeconds: 0 });
    expect(beatCharge(0, true, Number.NaN).billedSeconds).toBe(0);
  });
});
