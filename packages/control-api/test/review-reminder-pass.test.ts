// The pass that carries rows between the store and the words. It decides nothing itself, so what is
// worth pinning is what it must NOT do: fail the cron, skip the rest of the list, or need a column.
import { describe, expect, it, vi } from 'vitest';
import { remindDuePosts } from '../src/cron-routes';
import type { PushService } from '../src/push';
import type { Store } from '../src/store';

const item = (id: string, at: string) => ({ id, workspace: 'ws1', channel: 'c1', threadId: null, platform: 'x', body: `body ${id}`, scheduledAt: at });
const NOW = new Date('2026-09-07T16:30:00Z');

const storeWith = (items: ReturnType<typeof item>[]) =>
  ({ upcomingContentItems: vi.fn(async () => items) } as unknown as Store);

describe('the review reminder pass', () => {
  it('asks for exactly the next half hour', async () => {
    const store = storeWith([]);
    await remindDuePosts(store, { notifyPostReview: vi.fn() } as unknown as PushService, NOW);
    const [from, to] = (store.upcomingContentItems as unknown as { mock: { calls: string[][] } }).mock.calls[0]!;
    expect(from).toBe('2026-09-07T16:30:00.000Z');
    expect(to).toBe('2026-09-07T17:00:00.000Z');
  });

  it('tells the push lane about every row', async () => {
    const notify = vi.fn();
    const sent = await remindDuePosts(
      storeWith([item('a', '2026-09-07T16:45:00Z'), item('b', '2026-09-07T16:50:00Z')]),
      { notifyPostReview: notify } as unknown as PushService, NOW,
    );
    expect(sent).toBe(2);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  // the publish pass runs in the same request, and a post landing matters more than a reminder
  it('keeps going when one push throws, and never fails the cron', async () => {
    const notify = vi.fn().mockRejectedValueOnce(new Error('expo said no'));
    const sent = await remindDuePosts(
      storeWith([item('a', '2026-09-07T16:45:00Z'), item('b', '2026-09-07T16:50:00Z')]),
      { notifyPostReview: notify } as unknown as PushService, NOW,
    );
    expect(sent).toBe(1);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('is a no-op with no push service, which is how tests and a keyless deploy run', async () => {
    await expect(remindDuePosts(storeWith([item('a', '2026-09-07T16:45:00Z')]), undefined, NOW)).resolves.toBe(0);
  });
});
