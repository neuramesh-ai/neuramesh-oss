// THE GRANT'S DIVIDER IS NO REPLY (docs/design/repo-connect-2026-10). when GitHub connects, the server
// posts `‹github:connected:owner/repo›` as the person where each open GitHub card was (github-resume.ts).
// it is a record, never the person's word: a gate blocked for another reason must stay in Needs you,
// and an open free-text card must stay unanswered. the phone's reads, on the replica's own tables
// (node:sqlite), the same rows as the desktop's and hq's github-divider tests.
import { DatabaseSync } from 'node:sqlite';
import { sessionRunLines, type SessionRunRowsByThread as Rows } from '@neuramesh/shared';
import { describe, expect, it } from 'vitest';
import * as q from '../src/queries';
import { queueItems, type QueueDecision, type QueueTask } from '../src/queue';
import { TABLE_COLUMNS } from '../src/schema';

const at = (hm: string): string => `2026-10-03T${hm}:00.000Z`;
const NOW = Date.parse(at('12:00'));
const DIVIDER = '‹github:connected:acme/site›';

function replica(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const [name, cols] of Object.entries(TABLE_COLUMNS)) db.exec(`create table ${name} (id text primary key, ${Object.entries(cols).map(([c, t]) => `${c} ${t}`).join(', ')})`);
  const ins = (t: string, row: Record<string, string | number | null>) =>
    db.prepare(`insert into ${t} (${Object.keys(row).join(',')}) values (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
  ins('channels', { id: 'c1', workspace_id: 'w', slug: 'build' });
  // a routine's session owns #1, which the worker blocked on legal at 10:00 after the person spoke at 09:00
  ins('threads', { id: 'th1', workspace_id: 'w', channel_id: 'c1', title: 'Morning audit', schedule_id: 's1', created_at: at('07:00'), updated_at: at('11:00') });
  ins('tasks', { id: 't1', workspace_id: 'w', channel_id: 'c1', number: 1, title: 'Legal sign-off', state: 'blocked', origin_thread_id: 'th1', created_at: at('08:30'), updated_at: at('10:00') });
  ins('tasks', { id: 's2', workspace_id: 'w', channel_id: 'c1', number: 2, title: 'Clause check', state: 'todo', parent_task_id: 't1', created_at: at('08:45'), updated_at: at('08:45') });
  const msg = (id: string, where: { thread_id?: string; task_id?: string; schedule_id?: string }, author_kind: string, body: string, hm: string) =>
    ins('messages', { id, workspace_id: 'w', channel_id: 'c1', thread_id: null, task_id: null, schedule_id: null, ...where, author_kind, author_id: author_kind === 'human' ? 'george' : 'rex', body, created_at: at(hm) });
  msg('open', { thread_id: 'th1', schedule_id: 's1' }, 'human', 'Routine · audit', '07:00');
  msg('ask-thread', { thread_id: 'th1' }, 'agent', 'Which repository?', '08:00');
  msg('ask-room', {}, 'agent', 'Which room?', '08:00');
  msg('said', { task_id: 't1' }, 'human', 'Ask legal first.', '09:00');
  msg('ask-task', { task_id: 't1' }, 'agent', 'Which clause?', '09:30');
  msg('ask-sub', { task_id: 's2' }, 'agent', 'Which page?', '09:30');
  // the person connects GitHub at 11:00: the divider lands in the session, the room's feed and the task's thread
  msg('div-thread', { thread_id: 'th1' }, 'human', DIVIDER, '11:00');
  msg('div-room', {}, 'human', DIVIDER, '11:00');
  msg('div-task', { task_id: 't1' }, 'human', DIVIDER, '11:00');
  for (const [id, task_id, message_id, hm] of [['d-thread', null, 'ask-thread', '08:00'], ['d-room', null, 'ask-room', '08:00'], ['d-task', 't1', 'ask-task', '09:30'], ['d-sub', 's2', 'ask-sub', '09:30']] as const) {
    ins('decisions', { id, workspace_id: 'w', channel_id: 'c1', task_id, message_id, asker_kind: 'agent', asker_id: 'rex', question: '?', options: '[]', allow_other: 1, status: 'open', created_at: at(hm) });
  }
  return db;
}

const all = <T,>(db: DatabaseSync, sql: string, ...params: Array<string | number>): T[] => db.prepare(sql).all(...params) as T[];
const byId = <T extends { id: string }>(rows: T[]): Record<string, T> => Object.fromEntries(rows.map((r) => [r.id, r]));

describe('the grant\'s divider is no reply', () => {
  it('the gate reads the person\'s own last word, and the queue keeps the gate and every card', () => {
    const db = replica();
    const gates = all<QueueTask>(db, q.NEEDS_YOU, 'w');
    expect(gates.map((t) => [t.id, t.last_human_msg_at])).toEqual([['t1', at('09:00')]]);
    const cards = all<QueueDecision>(db, q.OPEN_DECISIONS_FOR_WORKSPACE, 'w');
    expect(Object.fromEntries(cards.map((d) => [d.id, d.human_replied_at]))).toEqual({ 'd-thread': null, 'd-room': null, 'd-task': at('09:00'), 'd-sub': null });
    expect(queueItems(gates, cards).map((i) => (i.kind === 'gate' ? i.task.id : i.decision.id)).sort()).toEqual(['d-room', 'd-sub', 'd-task', 'd-thread', 't1']);
  });

  it('the session list reads the same stamp, and a run\'s strip still needs the person for the gate and for the card', () => {
    const db = replica();
    expect(byId(all<{ id: string; last_human_msg_at: string | null }>(db, q.SESSION_TASKS_FOR_WORKSPACE, 'w', 25))['t1']!.last_human_msg_at).toBe(at('09:00'));
    const units = all<Rows['units'][number] & { id: string }>(db, q.SESSION_RUN_UNITS, '["th1"]', '');
    expect(units.map((u) => [u.id, u.last_human_msg_at])).toEqual([['t1', at('09:00')]]);
    // the strip reads a card's answer in the run's own messages, never the cards' SQL stamp (shared session-runs.ts).
    // the gate and the open card each hold the run at Needs you on their own
    const rows: Rows = {
      messages: all<Rows['messages'][number]>(db, q.SESSION_RUN_MESSAGES, '["th1"]', ''), units,
      cards: all<Rows['cards'][number]>(db, q.SESSION_RUN_CARDS, '["th1"]', ''), drafts: [], files: [], openRuns: [],
    };
    const state = (only: Partial<Rows>) => sessionRunLines([{ id: 'open', thread_id: 'th1' }], { ...rows, ...only }, 's1', NOW)[0]!.strip?.state;
    expect([state({}), state({ units: [] }), state({ cards: [] })]).toEqual(['needs', 'needs', 'needs']);
  });
});
