import { describe, expect, it } from 'vitest';
import { decisionOptions, queueItems, type QueueDecision, type QueueTask } from '../src/queue';

const at = (min: number) => new Date(Date.parse('2026-09-05T10:00:00Z') + min * 60_000).toISOString();
const task = (o: Partial<QueueTask> = {}): QueueTask => ({ id: 't1', number: 1, title: 'a', state: 'done', channel_id: 'c', updated_at: at(0), last_human_msg_at: null, ...o });
const ask = (o: Partial<QueueDecision> = {}): QueueDecision => ({
  id: 'd1', channel_id: 'c', task_id: null, message_id: 'm', asker_id: 'a', question: 'Which room?', options: '[{"label":"#general"},{"label":"#marketing"}]',
  allow_other: 1, created_at: at(0), thread_id: 'th', human_replied_at: null, ...o,
});

describe('queueItems', () => {
  it('merges gates and open questions, newest ask first', () => {
    const out = queueItems([task({ id: 't1', updated_at: at(1) }), task({ id: 't2', updated_at: at(5) })], [ask({ id: 'd1', created_at: at(3) })]);
    expect(out.map((i) => (i.kind === 'gate' ? i.task.id : i.decision.id))).toEqual(['t2', 'd1', 't1']);
  });

  it('a gate the human already answered in the thread is waiting on an agent, not on you', () => {
    expect(queueItems([task({ state: 'plan_review', updated_at: at(0), last_human_msg_at: at(2) })], [])).toEqual([]);
    // …but done is cleared by the Accept button, never by prose
    expect(queueItems([task({ state: 'done', updated_at: at(0), last_human_msg_at: at(2) })], [])).toHaveLength(1);
  });

  it('a subtask never queues — its gates belong to its parent', () => {
    expect(queueItems([task({ parent_task_id: 'p' })], [])).toEqual([]);
  });

  it('a free-text card answered in prose is handled; a strict card is not', () => {
    expect(queueItems([], [ask({ allow_other: 1, human_replied_at: at(1) })])).toEqual([]);
    expect(queueItems([], [ask({ allow_other: 0, human_replied_at: at(1) })])).toHaveLength(1);
  });

  it('the card carries its option labels', () => {
    const [item] = queueItems([], [ask()]);
    expect(item?.kind === 'question' && item.options).toEqual(['#general', '#marketing']);
  });
});

describe('decisionOptions', () => {
  it('reads nmq objects, bare strings, and shrugs at garbage', () => {
    expect(decisionOptions('["a","b"]')).toEqual(['a', 'b']);
    expect(decisionOptions('[{"label":"x","description":"y"}]')).toEqual(['x']);
    expect(decisionOptions('nope')).toEqual([]);
    expect(decisionOptions(null)).toEqual([]);
  });
});
