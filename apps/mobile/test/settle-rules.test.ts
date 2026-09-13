import { describe, expect, it } from 'vitest';
import { laterOf, shouldPeek } from '../src/settle-rules';

describe('laterOf', () => {
  it('takes the newer stamp, and tolerates either side missing', () => {
    expect(laterOf('2026-09-08T10:00:00Z', '2026-09-08T11:00:00Z')).toBe('2026-09-08T11:00:00Z');
    expect(laterOf('2026-09-08T11:00:00Z', '2026-09-08T10:00:00Z')).toBe('2026-09-08T11:00:00Z');
    expect(laterOf(null, '2026-09-08T10:00:00Z')).toBe('2026-09-08T10:00:00Z');
    expect(laterOf('2026-09-08T10:00:00Z', undefined)).toBe('2026-09-08T10:00:00Z');
    expect(laterOf(null, null)).toBeNull();
  });
});

describe('shouldPeek', () => {
  const base = { reduceMotion: false, settledOnce: false, peekedThisLaunch: false, rows: 3 };
  it('peeks on the first needs-you list of a launch, until the person has settled once', () => {
    expect(shouldPeek(base)).toBe(true);
    expect(shouldPeek({ ...base, settledOnce: true })).toBe(false);
    expect(shouldPeek({ ...base, peekedThisLaunch: true })).toBe(false);
  });
  it('never peeks an empty list, and never under reduced motion', () => {
    expect(shouldPeek({ ...base, rows: 0 })).toBe(false);
    expect(shouldPeek({ ...base, reduceMotion: true })).toBe(false);
  });
});
