// THE UNIT'S BIRTH (George, 2026-09-19: units of a web, phone or routine session run on the cloud
// runner too). `unitBirth` reads the owning conversation's origin and designation, a subtask reads
// its parent's, and a board-born task reads none. The SQL is the whole logic, so it runs on real
// SQLite behind a `get` that throws on an empty result, exactly as the PowerSync replica's does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import type { PowerSyncDatabase } from '@powersync/node';
import type { HostCtx } from './ctx';
import { makeLookups } from './lookups';

const sqlite = (() => { try { return new Database(':memory:'); } catch { return null; } })();
const skip = sqlite ? false : 'better-sqlite3 is built for Electron\'s ABI — run under pnpm test, which rebuilds it';

sqlite?.exec(`
  create table threads (id text primary key, origin text, machine_id text);
  create table tasks (id text primary key, origin_thread_id text, parent_task_id text);
  insert into threads values ('th-web', 'web', null), ('th-routine', 'routine', null), ('th-desktop', 'desktop', 'm-mac'), ('th-old', null, null);
  insert into tasks values
    ('t-web', 'th-web', null), ('t-routine', 'th-routine', null), ('t-desktop', 'th-desktop', null), ('t-old', 'th-old', null),
    ('t-sub', null, 't-web'), ('t-board', null, null), ('t-sub-of-board', null, 't-board');
`);

function replica(): PowerSyncDatabase {
  return {
    get: async (sql: string, params: unknown[] = []) => {
      const row = sqlite!.prepare(sql).get(...(params as never[]));
      if (row === undefined) throw new Error('no rows'); // the replica's contract
      return row;
    },
    getAll: async (sql: string, params: unknown[] = []) => sqlite!.prepare(sql).all(...(params as never[])),
  } as unknown as PowerSyncDatabase;
}

const lookups = () => makeLookups({ guards: { taskRunIds: new Map() } } as unknown as HostCtx, { db: replica(), machineId: 'm-self' });

test('a unit reads its conversation: web and routine are cloud-born, desktop carries its designation', { skip }, async () => {
  const { unitBirth } = lookups();
  assert.deepEqual(await unitBirth('t-web'), { origin: 'web', machineId: null });
  assert.deepEqual(await unitBirth('t-routine'), { origin: 'routine', machineId: null });
  assert.deepEqual(await unitBirth('t-desktop'), { origin: 'desktop', machineId: 'm-mac' });
});

test('a subtask reads its parent\'s conversation', { skip }, async () => {
  assert.deepEqual(await lookups().unitBirth('t-sub'), { origin: 'web', machineId: null });
});

test('a board-born task, a subtask of one, and a thread born before the column read nothing: today\'s ladder', { skip }, async () => {
  const { unitBirth } = lookups();
  assert.deepEqual(await unitBirth('t-board'), { origin: null, machineId: null });
  assert.deepEqual(await unitBirth('t-sub-of-board'), { origin: null, machineId: null });
  assert.deepEqual(await unitBirth('t-old'), { origin: null, machineId: null });
  assert.deepEqual(await unitBirth('t-missing'), { origin: null, machineId: null });
});

// THE RESUME GUARD: a unit another awake machine is running is not resumed here; a stale run on a
// machine that stopped beating is a crash, and the resume exists for that.
const NOW = Date.parse('2026-09-19T23:30:00Z');
sqlite?.exec(`
  create table machines (id text primary key, last_seen_at text);
  create table runs (id text primary key, task_id text, state text, machine_id text);
  insert into machines values ('m-self', '${new Date(NOW - 5_000).toISOString()}'), ('m-runner', '${new Date(NOW - 5_000).toISOString()}'), ('m-dead', '${new Date(NOW - 10 * 60_000).toISOString()}');
  insert into runs values
    ('r1', 't-web', 'running', 'm-runner'),      -- live on the runner
    ('r2', 't-routine', 'running', 'm-dead'),    -- its machine died mid-unit
    ('r3', 't-desktop', 'done', 'm-runner'),     -- settled
    ('r4', 't-old', 'running', 'm-self');        -- this very host
`);

test('held elsewhere: a running run on another awake machine holds the unit; a dead machine\'s, a settled one, or my own does not', { skip }, async () => {
  const { heldElsewhere } = makeLookups({ guards: { taskRunIds: new Map() } } as unknown as HostCtx, { db: replica(), machineId: 'm-self' });
  assert.equal(await heldElsewhere('t-web', NOW), true);
  assert.equal(await heldElsewhere('t-routine', NOW), false);
  assert.equal(await heldElsewhere('t-desktop', NOW), false);
  assert.equal(await heldElsewhere('t-old', NOW), false);
  assert.equal(await heldElsewhere('t-board', NOW), false);
});
