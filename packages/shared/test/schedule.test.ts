// nextScheduleRun — the one cadence brain both the server (arm time) and the daemon
// (each advance) call, so they can't drift. July dates: America/Vancouver is PDT (UTC-7).
import { describe, expect, it } from 'vitest';
import { nextScheduleRun } from '../src/schedule';

const TZ = 'America/Vancouver';
const at = (iso: string) => new Date(iso);

describe('nextScheduleRun — tz-correct cadence math', () => {
  it('daily: later today if the time is still ahead, else tomorrow', () => {
    // 08:00 PDT Mon Jul 20 → today 09:00 PDT = 16:00Z
    expect(nextScheduleRun({ cadence: 'daily', atTime: '09:00', tz: TZ, after: at('2026-07-20T15:00:00Z') })!.toISOString())
      .toBe('2026-07-20T16:00:00.000Z');
    // 10:00 PDT Mon → tomorrow 09:00 PDT
    expect(nextScheduleRun({ cadence: 'daily', atTime: '09:00', tz: TZ, after: at('2026-07-20T17:00:00Z') })!.toISOString())
      .toBe('2026-07-21T16:00:00.000Z');
  });

  it('the boundary is STRICTLY after — a run at exactly 09:00 advances to the next day', () => {
    expect(nextScheduleRun({ cadence: 'daily', atTime: '09:00', tz: TZ, after: at('2026-07-20T16:00:00Z') })!.toISOString())
      .toBe('2026-07-21T16:00:00.000Z');
  });

  it('weekdays: Friday evening skips the weekend to Monday 09:00', () => {
    // Fri Jul 24 18:00 PDT = Sat 01:00Z Jul 25
    expect(nextScheduleRun({ cadence: 'weekdays', atTime: '09:00', tz: TZ, after: at('2026-07-25T01:00:00Z') })!.toISOString())
      .toBe('2026-07-27T16:00:00.000Z'); // Mon Jul 27
  });

  it('weekly: fires only on the requested weekday', () => {
    // after Mon Jul 20, weekly on Thursday (4) at 08:30 PDT = 15:30Z Jul 23
    expect(nextScheduleRun({ cadence: 'weekly', atTime: '08:30', tz: TZ, weekday: 4, after: at('2026-07-20T17:00:00Z') })!.toISOString())
      .toBe('2026-07-23T15:30:00.000Z');
  });

  it("'once' has no next (the client supplies its exact runAt), bad time/tz → null", () => {
    expect(nextScheduleRun({ cadence: 'once', atTime: '09:00', tz: TZ, after: at('2026-07-20T15:00:00Z') })).toBeNull();
    expect(nextScheduleRun({ cadence: 'daily', atTime: '9am', tz: TZ, after: at('2026-07-20T15:00:00Z') })).toBeNull();
    expect(nextScheduleRun({ cadence: 'daily', atTime: '09:00', tz: 'Not/AZone', after: at('2026-07-20T15:00:00Z') })).toBeNull();
  });

  it('UTC works and a different tz shifts the instant', () => {
    expect(nextScheduleRun({ cadence: 'daily', atTime: '09:00', tz: 'UTC', after: at('2026-07-20T10:00:00Z') })!.toISOString())
      .toBe('2026-07-21T09:00:00.000Z');
  });
});

// The calendar's projection (the mobile-cloud round, S4) — one walk over nextScheduleRun for both clients.
import { cadenceLine, nextRunLabel, scheduleFirings } from '../src/schedule';

describe('scheduleFirings', () => {
  const week = { from: at('2026-07-20T07:00:00Z'), to: at('2026-07-27T07:00:00Z') }; // Mon 00:00 PDT → next Mon 00:00 PDT
  const daily = { id: 'd', cadence: 'daily', at_time: '09:00', tz: TZ, next_run_at: null };
  const weekdays = { id: 'w', cadence: 'weekdays', at_time: '09:00', tz: TZ, next_run_at: null };
  const weekly = { id: 'k', cadence: 'weekly', at_time: '17:00', tz: TZ, weekday: 5, next_run_at: null };
  const once = { id: 'o', cadence: 'once', at_time: '08:00', tz: TZ, next_run_at: '2026-07-22T15:00:00Z' };

  it('a daily schedule fires seven times in a week, in order', () => {
    const f = scheduleFirings([daily], week.from, week.to);
    expect(f).toHaveLength(7);
    expect(f[0]!.at.toISOString()).toBe('2026-07-20T16:00:00.000Z');
    expect(f[6]!.at.toISOString()).toBe('2026-07-26T16:00:00.000Z');
  });

  it('weekdays skips the weekend; weekly lands on its day', () => {
    expect(scheduleFirings([weekdays], week.from, week.to)).toHaveLength(5);
    const k = scheduleFirings([weekly], week.from, week.to);
    expect(k).toHaveLength(1);
    expect(k[0]!.at.toISOString()).toBe('2026-07-25T00:00:00.000Z'); // Fri Jul 24 17:00 PDT
  });

  it('once rides its stored next_run_at and only inside the window', () => {
    expect(scheduleFirings([once], week.from, week.to).map((f) => f.key)).toEqual(['o:once']);
    expect(scheduleFirings([once], at('2026-08-01T00:00:00Z'), at('2026-08-08T00:00:00Z'))).toEqual([]);
  });

  it('the merged projection is sorted by instant across schedules', () => {
    const all = scheduleFirings([weekly, once, daily], week.from, week.to);
    for (let i = 1; i < all.length; i++) expect(all[i]!.at.getTime()).toBeGreaterThanOrEqual(all[i - 1]!.at.getTime());
  });
});

describe('the routine card words', () => {
  it('cadenceLine', () => {
    expect(cadenceLine({ cadence: 'once', at_time: '09:00' })).toBe('Once · 09:00');
    expect(cadenceLine({ cadence: 'weekdays', at_time: '09:00' })).toBe('Weekdays · 09:00');
    expect(cadenceLine({ cadence: 'weekly', at_time: '17:00', weekday: 5 })).toBe('Fris · 17:00');
  });
  it('nextRunLabel', () => {
    const now = Date.parse('2026-07-20T16:00:00Z');
    expect(nextRunLabel(null, now)).toBe('');
    expect(nextRunLabel('2026-07-20T16:00:30Z', now)).toBe('now');
    expect(nextRunLabel('2026-07-20T16:30:00Z', now)).toBe('in 30m');
    expect(nextRunLabel('2026-07-20T19:00:00Z', now)).toBe('in 3h');
    expect(nextRunLabel('2026-07-23T16:00:00Z', now)).toBe('in 3d');
  });
});
