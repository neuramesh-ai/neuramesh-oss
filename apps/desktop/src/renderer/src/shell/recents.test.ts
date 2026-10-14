import assert from 'node:assert/strict';
import { test } from 'node:test';
import { historyRows } from '@neuramesh/shared';
import { makeRecentMarks, recentGroups } from './recents';
import { makeRowMarks } from './rowstatus';
import type { HistoryThreadRow } from '../bridge/rows-rooms';
import type { DecisionAllRow, TaskAllRow } from '../bridge/rows-board';

const T0 = '2026-10-10T10:00:00.000Z';
const T1 = '2026-10-10T10:01:00.000Z';
const T2 = '2026-10-10T10:02:00.000Z';
function fixture({ stamp = null, when = T0, connectionAt = when, author = 'agent', kind = 'coding', state = 'completed', live = false, decisionAt }: {
  stamp?: string | null; when?: string; connectionAt?: string; author?: string; kind?: string; state?: string; live?: boolean; decisionAt?: string;
} = {}) {
  const threads: HistoryThreadRow[] = [{ id: 'th', channel_id: 'c', channel_slug: 'dev', task_id: null, title: 'Plan the endpoint', updated_at: when, last_at: when, last_author_kind: author, settled_at: stamp, kind }];
  const codeSessions = kind === 'coding' ? [{ id: 'th', thread_id: 'th', state, updated_at: connectionAt }] : [];
  const liveIds = new Set(live ? ['th'] : []);
  const decisions = decisionAt ? [{ id: 'd', thread_id: 'th', task_id: null, status: 'open', created_at: decisionAt }] as DecisionAllRow[] : [];
  const row = historyRows<TaskAllRow>({ threads, tasks: [], codeSessions, channelId: null, channelSlug: '', query: '' })[0]!;
  const mark = makeRecentMarks({ threads, liveIds, marksOf: makeRowMarks({ threads, liveIds, codeSessions, decisions }) });
  return mark(row);
}

test('an answered coding or chat thread is idle until a human settles it', () => {
  for (const kind of ['coding', 'chat']) {
    assert.equal(fixture({ kind }).group, 'idle');
    assert.equal(fixture({ kind }).settle, true);
    assert.equal(fixture({ kind, stamp: T1 }).group, 'settled');
    assert.equal(fixture({ kind, stamp: T1 }).settle, false);
    assert.equal(fixture({ kind, stamp: null }).group, 'idle', 'Undo restores Idle');
  }
});

test('a new coding turn leaves Settled for Working, then rests in Idle', () => {
  assert.equal(fixture({ stamp: T1, when: T2, state: 'streaming' }).group, 'working');
  assert.equal(fixture({ stamp: T1, when: T2, state: 'completed' }).group, 'idle');
  assert.equal(fixture({ kind: 'chat', stamp: T1, when: T2, author: 'human' }).group, 'working');
  assert.equal(fixture({ kind: 'chat', stamp: T1, when: T2 }).group, 'idle');
});

test('opening and closing a settled coding connection does not reopen the conversation', () => {
  assert.equal(fixture({ stamp: T1, connectionAt: T2, state: 'idle' }).group, 'settled');
  assert.equal(fixture({ stamp: T1, connectionAt: T2, state: 'resumable' }).group, 'settled');
});

test('live work stays visible and offers no settle until the agent pauses', () => {
  for (const marks of [fixture({ stamp: T1, state: 'streaming' }), fixture({ kind: 'chat', stamp: T1, live: true })]) {
    assert.equal(marks.group, 'working');
    assert.equal(marks.settle, false);
  }
});

test('approval rows can be settled without approval and a new approval reopens them', () => {
  const waiting = fixture({ state: 'awaiting_approval' });
  assert.equal(waiting.group, 'working');
  assert.equal(waiting.status, 'needs_you');
  assert.equal(waiting.settle, true);
  assert.equal(fixture({ state: 'awaiting_approval', stamp: T1 }).group, 'settled');
  assert.equal(fixture({ state: 'awaiting_approval', stamp: T1, when: T2 }).group, 'working');
  // A new card may arrive without a new message or a new thread timestamp.
  assert.equal(fixture({ kind: 'chat', stamp: T1, decisionAt: T2 }).group, 'working');
  assert.equal(fixture({ kind: 'chat', stamp: T1, decisionAt: T0 }).group, 'settled');
});

test('timestamp formats and malformed settle stamps do not hide a thread', () => {
  assert.equal(fixture({ stamp: '2026-10-10 10:01:00+00' }).group, 'settled');
  assert.equal(fixture({ stamp: 'broken' }).group, 'idle');
  assert.equal(fixture({ stamp: T0 }).group, 'settled');
});

test('each group sorts newest first without letting settled history bury active work', () => {
  const rows = [...Array.from({ length: 70 }, (_, i) => ({ id: String(i), group: 'settled' as const, when: T1 })),
    { id: 'older', group: 'working' as const, when: T0 }, { id: 'newer', group: 'working' as const, when: T2 },
    { id: 'quiet', group: 'idle' as const, when: T0 }];
  const groups = recentGroups(rows, (row) => row.group);
  assert.deepEqual(groups.working.map((row) => row.id), ['newer', 'older']);
  assert.deepEqual(groups.idle.map((row) => row.id), ['quiet']);
  assert.equal(groups.settled.length, 70);
  assert.equal(rows[70]?.id, 'older', 'group sorting must not mutate the input');
});
