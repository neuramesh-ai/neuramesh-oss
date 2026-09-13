// the refill date the credit ring SHOWS must be the one the server actually acts on. the server's
// worklist is `period_start < date_trunc('month', today)` — a calendar boundary — so any
// anniversary-shaped derivation is wrong for every workspace not created on the 1st.
import { describe, expect, it } from 'vitest';
import { nextRefillOn } from '../src/rates.js';

const on = (periodStart: string, today: string, plan?: string | null): string | null =>
  nextRefillOn(periodStart, new Date(`${today}T12:00:00Z`), plan)?.toISOString().slice(0, 10) ?? null;

describe('the monthly refill date', () => {
  it('is the 1st of next month, whatever day the workspace started on', () => {
    // the regression this test exists for: an anniversary rule would say 2026-09-15 here
    expect(on('2026-08-15', '2026-08-28')).toBe('2026-09-01');
    expect(on('2026-08-01', '2026-08-28')).toBe('2026-09-01');
    expect(on('2026-08-31', '2026-08-31')).toBe('2026-09-01');
  });

  it('rolls the year at december without landing on a month 13', () => {
    expect(on('2026-12-09', '2026-12-20')).toBe('2027-01-01');
  });

  it('names no date for a period that has already rolled over', () => {
    // the sweep grants these on its next pass; a future date would be a false promise
    expect(on('2026-07-15', '2026-08-28')).toBeNull();
  });

  it('drops the clause rather than guessing when the period start is absent or malformed', () => {
    expect(on('', '2026-08-28')).toBeNull();
    expect(on('not-a-date', '2026-08-28')).toBeNull();
  });

  // source release (2026-09-12): nothing refills on Free — the server's worklist filters
  // plan = 'cloud' — so a Free workspace has no date to name, and a client that knows the plan
  // must not print one. A caller that does not pass the plan keeps the pre-release answer.
  it('names no date on Free, the date on Pro, and the pre-release answer when the plan is not passed', () => {
    expect(on('2026-08-15', '2026-08-28', 'free')).toBeNull();
    expect(on('2026-08-15', '2026-08-28', null)).toBeNull();
    expect(on('2026-08-15', '2026-08-28', 'cloud')).toBe('2026-09-01');
    expect(on('2026-08-15', '2026-08-28')).toBe('2026-09-01');
  });
});
