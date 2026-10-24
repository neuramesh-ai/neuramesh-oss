import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteReplica } from '@neuramesh/client-core/sqlite-replica';
import { openNativeSQLite, sqliteDriver } from './sqlite-driver';

/** Run inside the packaged Electron process, with its actual native module and ABI. */
export function verifyNativeSQLite(): void {
  const dir = mkdtempSync(join(tmpdir(), 'nm-native-sqlite-'));
  try {
    const file = join(dir, 'probe.sqlite');
    const writer = openNativeSQLite(file);
    try { writer.exec("create table probe(value text); insert into probe values ('persisted')"); }
    finally { writer.close(); }
    const reader = openNativeSQLite(file, true);
    try {
      assert.deepEqual(reader.prepare('select value from probe').get(), { value: 'persisted' });
      assert.throws(() => reader.exec("insert into probe values ('forbidden')"), /readonly/i);
    } finally { reader.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Importing machined cannot prove its database opens. Exercise the actual default driver. */
export async function verifyReplica(): Promise<void> {
  verifyNativeSQLite();
  const dir = mkdtempSync(join(tmpdir(), 'nm-replica-smoke-'));
  let db: SQLiteReplica | undefined;
  try {
    const file = join(dir, 'replica.sqlite');
    db = new SQLiteReplica(sqliteDriver(file));
    await db.waitForReady();
    await db.execute('insert into nm_sync_meta(key,value) values (?,?)', ['smoke', 'persisted']);
    await db.close();
    db = undefined;
    db = new SQLiteReplica(sqliteDriver(file));
    await db.waitForReady();
    assert.deepEqual(await db.getOptional('select value from nm_sync_meta where key=?', ['smoke']), { value: 'persisted' });
  } finally {
    try { await db?.close(); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  }
}
