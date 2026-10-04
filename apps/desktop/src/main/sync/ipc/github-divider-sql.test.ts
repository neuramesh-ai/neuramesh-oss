// THE GRANT'S DIVIDER IS NO REPLY (docs/design/repo-connect-2026-10). when GitHub connects, the server
// posts `‹github:connected:owner/repo›` as the person where each open GitHub card was (github-resume.ts).
// it is a record, never the person's word: a gate blocked for another reason must stay in Needs you,
// and an open free-text card must stay unanswered. the desktop's two watches and its routine-runs read,
// on the replica's own tables, the same rows as client-core's and hq's github-divider tests.
//   pnpm exec tsx --test src/main/sync/ipc/github-divider-sql.test.ts
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import Database from 'better-sqlite3';
import { TABLE_COLUMNS } from '@neuramesh/client-core';
import { sessionRunLines, type SessionRunRowsByThread as Rows } from '@neuramesh/shared';
import { scheduleRunsFor } from './session-runs';

// watch-board.ts imports `electron` at the top level; the constants under test do not need it
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const realLoad = loader._load;
loader._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === 'electron') return { ipcMain: { handle: () => {} } };
  return realLoad.call(this, request, ...rest);
};
let TASKS_ALL_SQL = '';
let DECISIONS_ALL_SQL = '';
before(async () => { ({ TASKS_ALL_SQL, DECISIONS_ALL_SQL } = await import('./watch-board')); });

const skip = !(() => { try { return new Database(':memory:'); } catch { return null; } })() && 'better-sqlite3 unavailable';
const at = (hm: string): string => `2026-10-03T${hm}:00.000Z`;
const NOW = Date.parse(at('12:00'));
const DIVIDER = '‹github:connected:acme/site›';

function replica() {
  const db = new Database(':memory:');
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

const stamps = (rows: unknown[], key: string): Record<string, unknown> =>
  Object.fromEntries((rows as Array<Record<string, unknown>>).map((r) => [r['id'] ?? r['message_id'], r[key]]));

test('the task watch and the card watch read the person\'s own last word, in every conversation shape', { skip }, () => {
  const db = replica();
  // a subtask reads its parent's thread too: the person's 09:00 word, never the 11:00 divider
  assert.deepEqual(stamps(db.prepare(TASKS_ALL_SQL).all('w'), 'last_human_msg_at'), { t1: at('09:00'), s2: at('09:00') });
  assert.deepEqual(stamps(db.prepare(DECISIONS_ALL_SQL).all('w'), 'human_replied_at'), { 'd-thread': null, 'd-room': null, 'd-task': at('09:00'), 'd-sub': at('09:00') });
});

test('a routine\'s run reads the same stamp for its unit, and its strip still needs the person for the gate and for the card', { skip }, async () => {
  const db = replica();
  const out = await scheduleRunsFor({ getAll: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as T[] }, 'w', 's1');
  assert.deepEqual(out.runs.map((r) => r.id), ['open']);
  assert.deepEqual(stamps(out.units, 'last_human_msg_at'), { t1: at('09:00') });
  // the strip reads a card's answer in the run's own messages, never the cards' SQL stamp (shared session-runs.ts).
  // the gate and the open card each hold the run at Needs you on their own
  const rows = out as unknown as Rows;
  const state = (only: Partial<Rows>) => sessionRunLines(out.runs, { ...rows, ...only }, 's1', NOW)[0]!.strip?.state;
  assert.deepEqual([state({}), state({ units: [] }), state({ cards: [] })], ['needs', 'needs', 'needs']);
});
