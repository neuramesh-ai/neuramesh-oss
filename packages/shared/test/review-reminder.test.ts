// A reminder that fires for a post which has already gone teaches a person to ignore the one
// channel meant to catch something before it left the building. The window is the whole feature.
import { describe, expect, it } from 'vitest';
import { reviewPushFor, snippet } from '../src/review-reminder';

const NOW = new Date('2026-09-07T16:30:00Z');
const at = (iso: string) => new Date(iso);
const post = (iso: string) => ({ id: 'p1', platform: 'linkedin', body: 'Easy website analytics without tracking people.', at: at(iso) });

describe('the review reminder', () => {
  it('fires inside the half hour, and names the network and the time', () => {
    const out = reviewPushFor(post('2026-09-07T17:00:00Z'), NOW)!;
    expect(out.title).toBe('LinkedIn post publishes in 30 minutes');
    expect(out.body).toContain('Easy website analytics');
    expect(out.dedupeKey).toBe('review:p1:2026-09-07T17:00');
  });

  it('is silent about a post that has already gone', () => {
    expect(reviewPushFor(post('2026-09-07T16:29:00Z'), NOW)).toBeNull();
    expect(reviewPushFor(post('2026-09-07T16:30:00Z'), NOW)).toBeNull();
  });

  it('is silent about one still far off', () => {
    expect(reviewPushFor(post('2026-09-07T17:01:00Z'), NOW)).toBeNull();
  });

  it('includes the boundary itself, so a cron minute cannot fall through the gap', () => {
    expect(reviewPushFor(post('2026-09-07T17:00:00Z'), NOW)).not.toBeNull();
  });

  it('one key per item and scheduled minute: a cron that runs every minute sends once, a moved post earns one more', () => {
    // the same post, seen by two cron minutes: one key
    const a = reviewPushFor(post('2026-09-07T16:50:00Z'), NOW)!;
    const b = reviewPushFor(post('2026-09-07T16:50:00Z'), new Date('2026-09-07T16:35:00Z'))!;
    expect(a.dedupeKey).toBe(b.dedupeKey);
    // the post moved to another minute: a new last chance, so a new key
    const moved = reviewPushFor(post('2026-09-07T16:45:00Z'), NOW)!;
    expect(moved.dedupeKey).not.toBe(a.dedupeKey);
  });

  it('keeps a snippet readable rather than complete', () => {
    expect(snippet('a'.repeat(200))).toHaveLength(90);
    expect(snippet('short one')).toBe('short one');
  });
});
