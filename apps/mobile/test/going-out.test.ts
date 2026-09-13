// THE WINDOW IS THE WHOLE FEATURE. "Today" that leaks into tomorrow puts a post on Home a day
// early; "today" that starts at midnight puts one there that has already gone out. Both read as
// the band being wrong about the thing it exists to be right about.
import { describe, expect, it } from 'vitest';
import { todaySlots } from '../src/going-out-slots';

const NOW = new Date('2026-09-07T14:00:00');
const post = (id: string, at: string | null, status = 'scheduled') => ({
  id, channel_id: 'c1', thread_id: null, task_id: null, platform: 'x', body: `post ${id}`,
  media: null, status, scheduled_at: at, published_at: null, external_url: null, created_at: '',
});

describe('what lands today', () => {
  it('keeps a post later today and drops one that has passed', () => {
    const out = todaySlots([], [post('a', '2026-09-07T16:30:00'), post('b', '2026-09-07T09:00:00')], NOW);
    expect(out.map((s) => s.id)).toEqual(['a']);
  });

  it('drops tomorrow, however early', () => {
    expect(todaySlots([], [post('a', '2026-09-08T00:05:00')], NOW)).toEqual([]);
  });

  it('ignores a draft, which has no time to be early or late for', () => {
    expect(todaySlots([], [post('a', '2026-09-07T16:30:00', 'draft')], NOW)).toEqual([]);
    expect(todaySlots([], [post('a', null)], NOW)).toEqual([]);
  });

  // a published post has already gone: warning somebody about it is worse than saying nothing
  it('ignores one that already published', () => {
    expect(todaySlots([], [post('a', '2026-09-07T16:30:00', 'published')], NOW)).toEqual([]);
  });

  it('sorts both lanes together by time', () => {
    const out = todaySlots([], [post('late', '2026-09-07T19:00:00'), post('soon', '2026-09-07T15:00:00')], NOW);
    expect(out.map((s) => s.id)).toEqual(['soon', 'late']);
  });

  it('names the room through the lookup it is given', () => {
    const out = todaySlots([], [post('a', '2026-09-07T16:30:00')], NOW, () => '#marketing');
    expect(out[0]!.sub).toContain('#marketing');
  });
});
