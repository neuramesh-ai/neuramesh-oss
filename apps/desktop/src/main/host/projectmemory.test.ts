// PROJECT MEMORY ON THE MACHINE (D15): the rules the sleep-time refresh (host/block.ts) and every context
// reader share, and the two replica reads, run on SQLite as the replica holds them.
// Run from apps/desktop: pnpm exec tsx --test src/main/host/projectmemory.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { STARTER_MODEL } from '@neuramesh/shared';
import { PROJECT_ACTIVITY_SQL, PROJECT_BLOCK_SQL, machineRefreshes, memoryRefreshMs, projectRefreshDue } from './projectmemory';

test('the rate limit comes from the env: one hour by default, 0 turns it off, never faster than 5 minutes', () => {
  assert.equal(memoryRefreshMs({}), 60 * 60_000);
  assert.equal(memoryRefreshMs({ NM_MEMORY_REFRESH_MINUTES: '0' }), 0);
  assert.equal(memoryRefreshMs({ NM_MEMORY_REFRESH_MINUTES: '2' }), 5 * 60_000);
  assert.equal(memoryRefreshMs({ NM_MEMORY_REFRESH_MINUTES: '30' }), 30 * 60_000);
});

test('the machine refreshes for an orchestrator on a vendor brain only: a starter seat is nm-api\'s', () => {
  assert.equal(machineRefreshes({ role: 'orchestrator', model: 'claude-sonnet-4-5' }), true);
  assert.equal(machineRefreshes({ role: 'orchestrator', model: STARTER_MODEL }), false);
  assert.equal(machineRefreshes({ role: 'worker', model: 'claude-sonnet-4-5' }), false);
});

test('a project is due when it has new messages and its block is older than the window', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const hour = 60 * 60_000;
  const due = (messages: number, basis: number, updatedAt: string | null, windowMs = hour) => projectRefreshDue({ messages, basis, updatedAt, now, windowMs });
  assert.equal(due(1, 0, null), true, 'the first message of a project with no block');
  assert.equal(due(0, 0, null), false, 'no messages, nothing to say');
  assert.equal(due(9, 9, '2026-11-05T09:00:00Z'), false, 'nothing new since the block');
  assert.equal(due(12, 9, '2026-11-05T11:30:00Z'), false, 'new messages, but inside the window');
  assert.equal(due(12, 9, '2026-11-05T10:59:00Z'), true, 'new messages, and the window passed');
  assert.equal(due(12, 9, '2026-11-05T10:00:00Z', 0), false, 'the refresh is off');
});

function replica(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`create table channels (id text, project_id text, slug text, created_at text);
    create table threads (id text, title text);
    create table messages (id text, channel_id text, thread_id text, task_id text, author_kind text, body text, created_at text);
    create table memory_blocks (id text, workspace_id text, channel_id text, project_id text, kind text, content text, basis_count integer, updated_at text);
    insert into channels values ('a1', 'pa', 'general', '1'), ('a2', 'pa', 'context', '2'), ('b1', 'pb', 'other', '3');
    insert into threads values ('t-home', 'Ask rex'), ('t-b', 'B chat');`);
  return db;
}
const read = (db: DatabaseSync, q: string, ...params: string[]) => db.prepare(q).all(...params) as Array<Record<string, unknown>>;

test('every channel of a project reads the project block, never another project\'s, and the legacy summary until one exists', () => {
  const db = replica();
  db.exec(`insert into memory_blocks values ('m1', 'w', 'a1', null, 'channel_summary', 'legacy a1 summary', 3, '1'),
    ('m2', 'w', 'b1', 'pb', 'project_summary', 'project B memory', 4, '2');`);
  assert.deepEqual(read(db, PROJECT_BLOCK_SQL, 'a1', 'a1').map((r) => r['content']), ['legacy a1 summary']);
  assert.deepEqual(read(db, PROJECT_BLOCK_SQL, 'a2', 'a2'), [], 'no project block for A yet, and a2 has no legacy summary');
  db.exec(`insert into memory_blocks values ('m3', 'w', 'a2', 'pa', 'project_summary', 'project A memory', 5, '3');`);
  for (const ch of ['a1', 'a2']) assert.deepEqual(read(db, PROJECT_BLOCK_SQL, ch, ch).map((r) => r['content']), ['project A memory'], ch);
  assert.deepEqual(read(db, PROJECT_BLOCK_SQL, 'b1', 'b1').map((r) => r['content']), ['project B memory']);
  // an empty block (a claim nm-api has not filled) is no memory
  db.exec(`update memory_blocks set content = '' where id = 'm3'`);
  assert.deepEqual(read(db, PROJECT_BLOCK_SQL, 'a1', 'a1').map((r) => r['content']), ['legacy a1 summary']);
});

test('the refresh reads every thread of the project: conversations, Agent Desk home threads and task threads, never another project', () => {
  const db = replica();
  db.exec(`insert into messages values
    ('1', 'a1', null, null, 'human', 'room message in general', '2026-11-05T10:00:00Z'),
    ('2', 'a2', 't-home', null, 'agent', 'home thread reply', '2026-11-05T10:01:00Z'),
    ('3', 'a1', null, 'task-7', 'agent', 'task thread progress', '2026-11-05T10:02:00Z'),
    ('4', 'b1', 't-b', null, 'human', 'project B secret', '2026-11-05T10:03:00Z'),
    ('5', 'a1', null, null, 'human', '   ', '2026-11-05T10:04:00Z');`);
  const rows = read(db, PROJECT_ACTIVITY_SQL, 'pa');
  assert.deepEqual(rows.map((r) => r['body']), ['task thread progress', 'home thread reply', 'room message in general']);
  assert.deepEqual(rows.map((r) => r['place']), ['#general', 'Ask rex', '#general']);
});
