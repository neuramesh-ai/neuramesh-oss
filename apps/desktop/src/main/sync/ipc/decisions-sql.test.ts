// THE NEEDS-YOU READ, REWRITTEN FOR ITS INDEXES — and pinned to answer exactly what it answered.
//
// `human_replied_at` chose its conversation shape with a CASE inside the WHERE, which no index can
// serve, so every card scanned every message (0.5 s a run on a 1.7k-message replica). The rewrite
// is one branch per shape. These run the old form and the new one on the same rows, one fixture
// per branch, and hold the browser's copy to the desktop's word for word.
//   pnpm exec tsx --test src/main/sync/ipc/decisions-sql.test.ts
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import Database from 'better-sqlite3';

// watch-board.ts imports `electron` at the top level; the constant under test does not need it
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const realLoad = loader._load;
loader._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === 'electron') return { ipcMain: { handle: () => {} } };
  return realLoad.call(this, request, ...rest);
};
let DECISIONS_ALL_SQL = '';
before(async () => { ({ DECISIONS_ALL_SQL } = await import('./watch-board')); });

/** the form this replaced, kept as the reference answer */
const reference = (): string => DECISIONS_ALL_SQL.replace(/\(select max\(v\) from \([\s\S]*?\)\) as human_replied_at/, `(select max(m.created_at) from messages m
                where m.author_kind = 'human'
                  and (case when d.task_id is null then
                              case when (select m2.thread_id from messages m2 where m2.id = d.message_id) is null
                                   then m.channel_id = d.channel_id and m.task_id is null
                                   else m.thread_id = (select m2.thread_id from messages m2 where m2.id = d.message_id) end
                            else m.task_id = d.task_id
                                 or m.task_id = (select st.parent_task_id from tasks st where st.id = d.task_id)
                            end)) as human_replied_at`);

const sqlite = (() => { try { return new Database(':memory:'); } catch { return null; } })();

test('the rewrite answers what the CASE form answered, branch by branch', { skip: !sqlite && 'better-sqlite3 unavailable' }, () => {
  const REFERENCE = reference();
  assert.notEqual(REFERENCE, DECISIONS_ALL_SQL, 'the reference form was rebuilt');
  const db = sqlite!;
  db.exec(`
    create table channels (id text primary key, workspace_id text, slug text);
    create table tasks (id text primary key, workspace_id text, number integer, parent_task_id text);
    create table threads (id text primary key, task_id text, settled_at text, created_at text);
    create table messages (id text primary key, workspace_id text, channel_id text, task_id text, thread_id text, author_kind text, body text, created_at text, schedule_id text);
    create table decisions (id text primary key, workspace_id text, channel_id text, task_id text, message_id text, asker_kind text, asker_id text,
      question text, options text, allow_other integer, status text, answer text, created_at text, answered_at text);
  `);
  const ins = (t: string, row: Record<string, unknown>) =>
    db.prepare(`insert into ${t} (${Object.keys(row).join(',')}) values (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
  ins('channels', { id: 'c1', workspace_id: 'w', slug: 'general' });
  ins('channels', { id: 'c2', workspace_id: 'w', slug: 'build' });
  ins('tasks', { id: 'p', workspace_id: 'w', number: 1, parent_task_id: null });
  ins('tasks', { id: 's', workspace_id: 'w', number: 2, parent_task_id: 'p' });
  ins('tasks', { id: 'q', workspace_id: 'w', number: 3, parent_task_id: null });
  ins('threads', { id: 'th1', task_id: null, settled_at: null, created_at: '2026-09-01' });
  const msgs: Array<[string, string, string | null, string | null, string, string]> = [
    // id, channel, task, thread, author, at
    ['ask-room', 'c1', null, null, 'agent', '2026-09-01T01'],
    ['room-h1', 'c1', null, null, 'human', '2026-09-01T05'],
    ['room-h-task', 'c1', 'q', null, 'human', '2026-09-01T09'], // a task message in the room: the task's answer, not the room's
    ['ask-thread', 'c1', null, 'th1', 'agent', '2026-09-01T02'],
    ['thread-h1', 'c1', null, 'th1', 'human', '2026-09-01T06'],
    ['thread-a', 'c1', null, 'th1', 'agent', '2026-09-01T08'],
    ['ask-task', 'c2', 'q', null, 'agent', '2026-09-01T03'],
    ['task-h', 'c2', 'q', null, 'human', '2026-09-01T04'],
    ['ask-sub', 'c2', 's', null, 'agent', '2026-09-01T03'],
    ['parent-h', 'c2', 'p', null, 'human', '2026-09-01T07'], // the subtask's answer lives in its parent
    ['sub-h', 'c2', 's', null, 'human', '2026-09-01T02'],
    ['ask-quiet', 'c2', null, null, 'agent', '2026-09-01T01'],
  ];
  for (const [id, channel_id, task_id, thread_id, author_kind, created_at] of msgs) ins('messages', { id, workspace_id: 'w', channel_id, task_id, thread_id, author_kind, body: id, created_at });
  const dec = (id: string, channel_id: string, task_id: string | null, message_id: string) =>
    ins('decisions', { id, workspace_id: 'w', channel_id, task_id, message_id, asker_kind: 'agent', asker_id: 'a', question: '?', options: '[]', allow_other: 1, status: 'open', answer: null, created_at: `2026-09-02-${id}`, answered_at: null });
  dec('d-room', 'c1', null, 'ask-room');
  dec('d-thread', 'c1', null, 'ask-thread');
  dec('d-task', 'c2', 'q', 'ask-task');
  dec('d-sub', 'c2', 's', 'ask-sub');
  dec('d-quiet', 'c2', null, 'ask-quiet'); // a room with no human in it: null
  dec('d-lost', 'c2', null, 'no-such-message'); // the asking message never synced: the room rule

  const before = db.prepare(REFERENCE).all('w') as Array<{ id: string; human_replied_at: string | null }>;
  const after = db.prepare(DECISIONS_ALL_SQL).all('w');
  assert.deepEqual(after, before);
  // the fixtures really reach every branch (a test that compares two nulls proves nothing)
  const at = Object.fromEntries(before.map((r) => [r.id, r.human_replied_at]));
  assert.deepEqual(at, {
    'd-room': '2026-09-01T06', // the room rule counts every task-less message in the room, threads included
    'd-thread': '2026-09-01T06',
    'd-task': '2026-09-01T09', // the task rule reads the task's messages in any room
    'd-sub': '2026-09-01T07',
    'd-quiet': null,
    'd-lost': null,
  });
});

// "the browser's copy is the desktop's, word for word" retired at the hq split (2026-09-26): the
// browser client is apps/hq now, which owns its queries. the replica schema in client-core is the
// contract the two share, not the text of each other's SQL.
