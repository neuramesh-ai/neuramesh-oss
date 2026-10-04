// a routine's runs for the Automations panel (sync/ipc/session-runs.ts), the desktop twin of hq's lane,
// on real SQLite behind the replica's `getAll`: the openers newest first (a run opens at a message that
// keeps the schedule, or at the first message of a session from before 0145), and the rows each strip
// counts, read only as far back as the oldest listed run.
//   pnpm exec tsx --test src/main/sync/ipc/session-runs.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { scheduleRunsFor } from './session-runs';

const probe = (() => { try { return new Database(':memory:'); } catch { return null; } })();
const skip = !probe && 'better-sqlite3 unavailable';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    create table channels (id text primary key, workspace_id text, slug text);
    create table threads (id text primary key, workspace_id text, channel_id text, title text, schedule_id text, archived_at text, settled_at text);
    create table messages (id text primary key, thread_id text, task_id text, author_kind text, body text, created_at text, schedule_id text);
    create table tasks (id text primary key, number integer, title text, state text, kind text, parent_task_id text, plan_approved_at text, pr_number integer,
      created_at text, updated_at text, origin_thread_id text);
    create table decisions (id text primary key, message_id text, status text, created_at text, allow_other integer);
    create table content_items (id text primary key, thread_id text, body text, status text, created_at text, scheduled_at text, published_at text, last_error text);
    create table artifacts (id text primary key, message_id text, name text, created_at text);
    create table runs (id text primary key, thread_id text, state text, started_at text);
  `);
  const ins = (t: string, row: Record<string, unknown>) =>
    db.prepare(`insert into ${t} (${Object.keys(row).join(',')}) values (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
  ins('channels', { id: 'c1', workspace_id: 'w', slug: 'dev' });
  // the one session of s1: three runs. a legacy session of s1 from before 0145: one run, no column
  ins('threads', { id: 'th', workspace_id: 'w', channel_id: 'c1', title: 'Morning dependency audit', schedule_id: 's1' });
  ins('threads', { id: 'th-old', workspace_id: 'w', channel_id: 'c1', title: 'Routine · Morning dependency audit', schedule_id: 's1' });
  ins('threads', { id: 'th-gone', workspace_id: 'w', channel_id: 'c1', title: 'archived', schedule_id: 's1', archived_at: '2026-09-20' });
  ins('messages', { id: 'old-1', thread_id: 'th-old', author_kind: 'human', body: 'Routine · audit', created_at: '2026-09-20T09:00' });
  ins('messages', { id: 'r1', thread_id: 'th', author_kind: 'human', body: 'Routine · audit', created_at: '2026-09-26T09:00', schedule_id: 's1' });
  ins('messages', { id: 'a1', thread_id: 'th', author_kind: 'agent', body: 'I filed #7.', created_at: '2026-09-26T09:05' });
  ins('messages', { id: 'r2', thread_id: 'th', author_kind: 'human', body: 'Routine · audit', created_at: '2026-09-27T09:00', schedule_id: 's1' });
  ins('messages', { id: 'r3', thread_id: 'th', author_kind: 'human', body: 'Routine · audit', created_at: '2026-09-28T09:00', schedule_id: 's1' });
  ins('messages', { id: 'gone-1', thread_id: 'th-gone', author_kind: 'human', body: 'x', created_at: '2026-09-28T10:00', schedule_id: 's1' });
  ins('tasks', { id: 't7', number: 7, title: 'Bump undici', state: 'in_review', kind: 'chore', created_at: '2026-09-26T09:04', updated_at: '2026-09-26T09:04', origin_thread_id: 'th' });
  ins('tasks', { id: 't1', number: 1, title: 'too old', state: 'accepted', kind: 'chore', created_at: '2026-09-01T09:00', updated_at: '2026-09-01T09:00', origin_thread_id: 'th' });
  ins('decisions', { id: 'd1', message_id: 'a1', status: 'open', created_at: '2026-09-26T09:05', allow_other: 1 });
  ins('content_items', { id: 'ci1', thread_id: 'th', body: 'post', status: 'draft', created_at: '2026-09-27T09:02' });
  ins('artifacts', { id: 'f1', message_id: 'a1', name: 'audit.md', created_at: '2026-09-26T09:05' });
  ins('runs', { id: 'run1', thread_id: 'th', state: 'running', started_at: '2026-09-28T09:00' });
  return { getAll: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as T[] };
}

test('the runs of a schedule, newest first: its openers, a legacy session\'s first message, never an archived session', { skip }, async () => {
  const out = await scheduleRunsFor(fixture(), 'w', 's1');
  assert.deepEqual(out.runs.map((r) => r.id), ['r3', 'r2', 'r1', 'old-1']);
  assert.deepEqual(out.runs.map((r) => r.thread_id), ['th', 'th', 'th', 'th-old']);
  assert.equal(out.runs[0]!.channel_slug, 'dev');
});

test('the strips\' rows are read for those sessions, back to the oldest listed run only', { skip }, async () => {
  const out = await scheduleRunsFor(fixture(), 'w', 's1', 3);
  assert.deepEqual(out.runs.map((r) => r.id), ['r3', 'r2', 'r1']);
  assert.deepEqual((out.messages as Array<{ id: string }>).map((m) => m.id), ['r1', 'a1', 'r2', 'r3']);
  assert.deepEqual((out.units as Array<{ id: string }>).map((u) => u.id), ['t7'], 'a unit older than the oldest listed run is out');
  assert.equal(out.cards.length, 1);
  assert.equal(out.drafts.length, 1);
  assert.equal(out.files.length, 1);
  assert.equal(out.openRuns.length, 1);
});

test('a schedule with no runs reads nothing else', { skip }, async () => {
  const out = await scheduleRunsFor(fixture(), 'w', 's-none');
  assert.deepEqual(out, { runs: [], messages: [], units: [], cards: [], drafts: [], files: [], openRuns: [] });
});
