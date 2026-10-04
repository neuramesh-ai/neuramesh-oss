// ONE SESSION PER ROUTINE, THE THREAD STATUS (docs/design/routine-sessions-2026-09/plan.md, PR 2).
//
// a routine's opener is posted as its owner, so it is a human message. once one session holds every
// run, two thread-level reads took it as the person's word: `human_replied_at` read the next run's
// opener as the answer to an older run's open card, and "who spoke last" kept a session whose newest
// run got no answer in progress until a settle. a message that carries a schedule opens a run, and
// it is never the person's word. these run the desktop's two watches and the two client-core queries
// (the phone's rail) on the same rows.
//   pnpm exec tsx --test src/main/sync/ipc/schedule-status-sql.test.ts
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import Database from 'better-sqlite3';
import { OPEN_DECISIONS_FOR_WORKSPACE, SESSION_THREADS_FOR_WORKSPACE } from '@neuramesh/client-core';

// the two watch modules import `electron` at the top level; the constants under test do not need it
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const realLoad = loader._load;
loader._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === 'electron') return { ipcMain: { handle: () => {}, on: () => {} } };
  return realLoad.call(this, request, ...rest);
};
let DECISIONS_ALL_SQL = '';
let HISTORY_ALL_SQL = '';
before(async () => {
  ({ DECISIONS_ALL_SQL } = await import('./watch-board'));
  ({ HISTORY_ALL_SQL } = await import('./watch-rooms'));
});

const sqlite = (() => { try { return new Database(':memory:'); } catch { return null; } })();
const skip = !sqlite && 'better-sqlite3 unavailable';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    create table channels (id text primary key, workspace_id text, slug text, kind text);
    create table schedules (id text primary key, channel_id text, payload text);
    create table tasks (id text primary key, workspace_id text, number integer, parent_task_id text);
    create table threads (id text primary key, workspace_id text, channel_id text, title text, task_id text, updated_at text, created_at text,
      schedule_id text, settled_at text, kind text, archived_at text, machine_id text, origin text, mode text);
    create table messages (id text primary key, workspace_id text, channel_id text, task_id text, thread_id text, author_kind text, body text,
      created_at text, schedule_id text);
    create table decisions (id text primary key, workspace_id text, channel_id text, task_id text, message_id text, asker_kind text, asker_id text,
      question text, options text, allow_other integer, status text, answer text, created_at text, answered_at text);
  `);
  const ins = (t: string, row: Record<string, unknown>) =>
    db.prepare(`insert into ${t} (${Object.keys(row).join(',')}) values (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
  ins('channels', { id: 'c1', workspace_id: 'w', slug: 'dev', kind: 'build' });
  ins('schedules', { id: 's1', channel_id: 'c1', payload: '{"prompt":"Check the deps.","routine":true}' });
  // a routine's session: run one asked a question, run two opened, and nobody answered either
  ins('threads', { id: 'th-r', workspace_id: 'w', channel_id: 'c1', title: 'Morning dependency audit', schedule_id: 's1', created_at: '2026-09-26T09:00', updated_at: '2026-09-28T09:00' });
  ins('messages', { id: 'r-open-1', workspace_id: 'w', channel_id: 'c1', thread_id: 'th-r', author_kind: 'human', body: 'Routine · audit', created_at: '2026-09-27T09:00', schedule_id: 's1' });
  ins('messages', { id: 'r-card', workspace_id: 'w', channel_id: 'c1', thread_id: 'th-r', author_kind: 'agent', body: 'Which package first?', created_at: '2026-09-27T09:05' });
  ins('messages', { id: 'r-open-2', workspace_id: 'w', channel_id: 'c1', thread_id: 'th-r', author_kind: 'human', body: 'Routine · audit', created_at: '2026-09-28T09:00', schedule_id: 's1' });
  // a person's conversation: the reply after the card IS the answer, and the person spoke last
  ins('threads', { id: 'th-p', workspace_id: 'w', channel_id: 'c1', title: 'Drawer focus', created_at: '2026-09-27T10:00', updated_at: '2026-09-27T10:10' });
  ins('messages', { id: 'p-ask', workspace_id: 'w', channel_id: 'c1', thread_id: 'th-p', author_kind: 'human', body: 'why?', created_at: '2026-09-27T10:00' });
  ins('messages', { id: 'p-card', workspace_id: 'w', channel_id: 'c1', thread_id: 'th-p', author_kind: 'agent', body: 'iPad or iPhone?', created_at: '2026-09-27T10:05' });
  ins('messages', { id: 'p-reply', workspace_id: 'w', channel_id: 'c1', thread_id: 'th-p', author_kind: 'human', body: 'iPad', created_at: '2026-09-27T10:10' });
  const dec = (id: string, message_id: string, created_at: string) =>
    ins('decisions', { id, workspace_id: 'w', channel_id: 'c1', task_id: null, message_id, asker_kind: 'agent', asker_id: 'a', question: '?', options: '[]', allow_other: 1, status: 'open', answer: null, created_at, answered_at: null });
  dec('d-r', 'r-card', '2026-09-27T09:05');
  dec('d-p', 'p-card', '2026-09-27T10:05');
  return db;
}

const byId = <R extends { id: string }>(rows: R[]) => Object.fromEntries(rows.map((r) => [r.id, r]));

test('a run\'s opener never answers an older run\'s card: the desktop watch and the phone\'s query', { skip }, () => {
  const db = fixture();
  for (const sql of [DECISIONS_ALL_SQL, OPEN_DECISIONS_FOR_WORKSPACE]) {
    const at = byId(db.prepare(sql).all('w') as Array<{ id: string; human_replied_at: string | null }>);
    assert.equal(at['d-r']!.human_replied_at, null, 'the next opener is no answer');
    assert.equal(at['d-p']!.human_replied_at, '2026-09-27T10:10', 'a person\'s reply still answers');
  }
});

test('who spoke last skips a run\'s opener: a run nobody answered is no work in flight', { skip }, () => {
  const db = fixture();
  for (const [sql, params] of [[HISTORY_ALL_SQL, ['w']], [SESSION_THREADS_FOR_WORKSPACE, ['w', 25]]] as const) {
    const rows = byId(db.prepare(sql).all(...params) as Array<{ id: string; last_author_kind: string | null; last_at: string | null }>);
    assert.deepEqual([rows['th-r']!.last_author_kind, rows['th-r']!.last_at], ['agent', '2026-09-27T09:05']);
    assert.deepEqual([rows['th-p']!.last_author_kind, rows['th-p']!.last_at], ['human', '2026-09-27T10:10']);
  }
});

test('a history row carries its schedule\'s payload and the kind of that schedule\'s room: the plan card\'s approver test', { skip }, () => {
  const rows = byId(fixture().prepare(HISTORY_ALL_SQL).all('w') as Array<{ id: string; schedule_payload: string | null; schedule_room_kind: string | null }>);
  assert.deepEqual([rows['th-r']!.schedule_payload, rows['th-r']!.schedule_room_kind], ['{"prompt":"Check the deps.","routine":true}', 'build']);
  assert.deepEqual([rows['th-p']!.schedule_payload, rows['th-p']!.schedule_room_kind], [null, null]);
});
