import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sqliteDriver } from './sqlite-driver';
import { verifyReplica } from './sqlite-smoke';

test('the production SQLite driver opens, initializes and reopens a persisted replica', verifyReplica);

for (const nodeSqlite of [false, true]) {
  test(`SQLite driver preserves disk data and refuses read-only writes (nodeSqlite=${nodeSqlite})`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nm-sqlite-driver-'));
    try {
      const file = join(dir, 'data.sqlite');
      const writer = sqliteDriver(file, { nodeSqlite });
      try {
        await writer.query('create table data(value text)');
        await writer.query('insert into data values (?)', ['original']);
      } finally { await writer.close(); }
      const reader = sqliteDriver(file, { nodeSqlite, readonly: true });
      try {
        assert.deepEqual((await reader.query('select value from data')).rows.map(r => ({ ...r })), [{ value: 'original' }]);
        await assert.rejects(reader.query('insert into data values (?)', ['forbidden']), /readonly/i);
        assert.equal((await reader.query('select count(*) as count from data')).rows[0]!.count, 1);
      } finally { await reader.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
