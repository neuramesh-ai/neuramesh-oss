import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { SQLiteReplica, type SQLiteDriver } from '@neuramesh/client-core/sqlite-replica';
import { readLegacyReplica } from '@neuramesh/client-core/replica-upgrade';
import type { UploadIdentity } from '@neuramesh/client-core/crud-upload';

export function openNativeSQLite(filename: string, readonly = false): Database.Database {
  return new Database(filename, { readonly, fileMustExist: readonly });
}

export function sqliteDriver(filename: string, options: { readonly?: boolean; nodeSqlite?: boolean } = {}): SQLiteDriver {
  if (options.nodeSqlite) {
    // Headless Node 24 needs no Electron ABI rebuild. Electron keeps its packaged SQLite.
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(filename, { readOnly: options.readonly ?? false });
    return { async query(sql, params = []) {
      const statement = db.prepare(sql);
      return statement.columns().length ? { rows: statement.all(...params as never[]) } : { rows: [], rowsAffected: Number(statement.run(...params as never[]).changes) };
    }, async close() { db.close(); } };
  }
  const db = openNativeSQLite(filename, options.readonly ?? false);
  return { async query(sql, params = []) {
    const statement = db.prepare(sql);
    return statement.reader ? { rows: statement.all(...params) as Record<string, unknown>[] } : { rows: [], rowsAffected: statement.run(...params).changes };
  }, async close() { db.close(); } };
}

export async function upgradeReplica(db: SQLiteReplica, legacyPath: string, owner: UploadIdentity['defaultActor'], nodeSqlite = false): Promise<void> {
  if (!existsSync(legacyPath) || await db.getOptional('select value from nm_sync_meta where key=?', [`import:${legacyPath}`])) return;
  const source = sqliteDriver(legacyPath, { readonly: true, nodeSqlite });
  try { await db.importLegacy(await readLegacyReplica(source), owner, legacyPath); }
  finally { await source.close(); }
}
