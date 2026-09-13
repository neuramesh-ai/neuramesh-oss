// The row's status on the phone: the shared derivation, plus the one phone-only rule — a settle
// made here counts before the synced row carries it.
import { describe, expect, it } from 'vitest';
import { cardIndex, countStatuses, rowStatus, type StatusCtx } from '../src/session-status';

const T0 = '2026-09-08T10:00:00.000Z';
const T1 = '2026-09-08T10:05:00.000Z';
const ctx = (over: Partial<StatusCtx> = {}): StatusCtx => ({
  cardByThread: new Map(), cardByTask: new Map(), threadMeta: new Map(), ownedByThread: new Map(), agentName: () => 'rex', ...over,
});
const done = { id: 't1', state: 'done', updated_at: T0, pr_number: 58 };

describe('rowStatus', () => {
  it('a done task needs you, and says the word to say', () => {
    const r = rowStatus({ threadId: 'th1', task: done }, false, ctx());
    expect(r).toMatchObject({ status: 'needs_you', why: 'Review passed. Say merge to land PR #58.' });
  });
  it('a settle made on this phone settles the row before sync does', () => {
    const r = rowStatus({ threadId: 'th1', task: done }, false, ctx({ settledLocally: new Map([['th1', T1]]) }));
    expect(r.status).toBe('settled');
    expect(r.settledAt).toBe(T1);
  });
  it('a card on the task leads the why, named by its asker', () => {
    const card = { id: 'd', channel_id: 'c', task_id: 't1', message_id: null, asker_id: 'a', question: 'Post at 9?', options: null, allow_other: 1, created_at: T0, thread_id: null, human_replied_at: null };
    const idx = cardIndex([card]);
    const r = rowStatus({ threadId: 'th1', task: done }, false, ctx(idx));
    expect(r.why).toBe('rex asks: Post at 9?');
  });
  it('a chat where the agent spoke last is settled; a live one is in progress', () => {
    const meta = new Map([['th1', { settled_at: null, last_author_kind: 'agent', last_at: T0 }]]);
    expect(rowStatus({ threadId: 'th1', task: null }, false, ctx({ threadMeta: meta })).status).toBe('settled');
    expect(rowStatus({ threadId: 'th1', task: null }, true, ctx({ threadMeta: meta })).status).toBe('in_progress');
  });
});

describe('owned units', () => {
  it('a conversation that owns a done unit needs you, and the why names the unit\'s gate', () => {
    const meta = new Map([['th1', { settled_at: null, last_author_kind: 'agent', last_at: T0 }]]);
    const owned = new Map([['th1', [{ ...done, id: 'u1' }]]]);
    const r = rowStatus({ threadId: 'th1', task: null }, false, ctx({ threadMeta: meta, ownedByThread: owned }));
    expect(r).toMatchObject({ status: 'needs_you', why: 'Review passed. Say merge to land PR #58.' });
  });
});

describe('cardIndex / countStatuses', () => {
  it('keeps the newest card per key and tallies the three words', () => {
    const c = (id: string, created_at: string) => ({ id, channel_id: 'c', task_id: 't1', message_id: null, asker_id: 'a', question: id, options: null, allow_other: 1, created_at, thread_id: 'th1', human_replied_at: null });
    const idx = cardIndex([c('new', T1), c('old', T0)]);
    expect(idx.cardByTask.get('t1')?.id).toBe('new');
    expect(idx.cardByThread.get('th1')?.id).toBe('new');
    expect(countStatuses([{ status: 'settled' }, { status: 'needs_you' }, { status: 'settled' }])).toEqual({ needs_you: 1, in_progress: 0, settled: 2 });
  });
});
