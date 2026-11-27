// The wait estimate (thread-wait-and-plan round): one count for every place a machine start shows.
import { describe, expect, it } from 'vitest';
import { MACHINE_WAKE_ESTIMATE_MS, MACHINE_WAKE_MAX_MS, waitClock, waitCountable, waitStartMs, wakeEstimateMs, wakeEta } from '../src/machine-wait';

const T0 = Date.parse('2026-11-17T11:20:00Z');

describe('wakeEta', () => {
  it('counts down from the measured wake', () => {
    const e = wakeEta(T0, T0 + 10_000, 57_000);
    expect(e).toMatchObject({ late: false, clock: '0:47', text: 'Ready in about 0:47' });
  });

  it('counts down from 60 s when the machine has no measured wake', () => {
    expect(wakeEta(T0, T0, null).clock).toBe('1:00');
    expect(wakeEta(T0, T0 + 29_000, undefined).text).toBe('Ready in about 0:31');
  });

  it('rounds the time left up, so the last second reads 0:01 and never 0:00', () => {
    expect(wakeEta(T0, T0 + 59_400, null)).toMatchObject({ late: false, clock: '0:01' });
  });

  it('turns around at the estimate and counts the time spent', () => {
    expect(wakeEta(T0, T0 + 60_000, null)).toMatchObject({ late: true, clock: '1:00', text: 'Taking longer than usual · 1:00' });
    expect(wakeEta(T0, T0 + 72_500, null)).toMatchObject({ late: true, clock: '1:12' });
  });

  it('never gives a negative number', () => {
    // a start in the future (a server clock ahead of this one) counts as now
    const ahead = wakeEta(T0 + 5_000, T0, 40_000);
    expect(ahead).toMatchObject({ late: false, clock: '0:40' });
    expect(wakeEta(Number.NaN, T0, null).clock).toBe('1:00');
    expect(waitClock(-5_000)).toBe('0:00');
    expect(waitClock(Number.NaN)).toBe('0:00');
  });

  it('ignores a measured wake that is not usable', () => {
    expect(wakeEstimateMs(0)).toBe(MACHINE_WAKE_ESTIMATE_MS);
    expect(wakeEstimateMs(-3)).toBe(MACHINE_WAKE_ESTIMATE_MS);
    expect(wakeEstimateMs(MACHINE_WAKE_MAX_MS + 1)).toBe(MACHINE_WAKE_ESTIMATE_MS);
    expect(wakeEstimateMs(Number.POSITIVE_INFINITY)).toBe(MACHINE_WAKE_ESTIMATE_MS);
    expect(wakeEstimateMs(42_000)).toBe(42_000);
  });

  it('writes minutes past ten without padding them', () => {
    expect(waitClock(754_000)).toBe('12:34');
  });
});

describe('waitStartMs', () => {
  const started = '2026-11-17T11:19:30.000Z';
  const sent = '2026-11-17T11:20:00.000Z';
  it('a waking machine counts from its own start', () => {
    expect(waitStartMs('waking', started, sent)).toBe(Date.parse(started));
  });
  it('any other state counts from the waiting message, because the poll can be stale', () => {
    expect(waitStartMs('asleep', started, sent)).toBe(Date.parse(sent));
    expect(waitStartMs('unreachable', started, sent)).toBe(Date.parse(sent));
    expect(waitStartMs('waking', null, sent)).toBe(Date.parse(sent));
  });
  it('a restart keeps an old started_at, so a start long before the message is not this wait', () => {
    const old = '2026-11-17T08:00:00.000Z';
    expect(waitStartMs('waking', old, sent)).toBe(Date.parse(sent));
    // with no message to compare (the pill), the start stands, and waitCountable drops the count
    expect(waitStartMs('waking', old, null)).toBe(Date.parse(old));
    expect(waitCountable(Date.parse(old), Date.parse(sent))).toBe(false);
    expect(waitCountable(Date.parse(started), Date.parse(sent))).toBe(true);
    expect(waitCountable(Number.NaN, Date.parse(sent))).toBe(false);
  });
  it('NaN when nothing is known', () => {
    expect(Number.isNaN(waitStartMs('asleep', null, null))).toBe(true);
  });
});
