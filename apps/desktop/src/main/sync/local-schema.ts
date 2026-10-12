import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { TABLE_COLUMNS, TABLES } from '@neuramesh/client-core/schema';
import type { ReplicaChange } from '@neuramesh/client-core/replica';

export const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const writableTables = new Set(['messages', 'artifacts', 'whiteboards']);

/** Schema and upload triggers are installed atomically before any read or local edit. */
export function openLocalDatabase(filename: string): Database.Database {
  const sqlite = new Database(filename);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = FULL');
  sqlite.exec(`create table if not exists nm_sync_meta (key text primary key, value text not null);
    insert or ignore into nm_sync_meta values ('suppress', '0');
    create table if not exists nm_outbox (sequence integer primary key autoincrement, table_name text not null,
      row_id text not null, operation text not null, row_data text not null);
    create table if not exists nm_server_rows (table_name text not null, row_id text not null, row_data text not null,
      primary key(table_name, row_id));
    create view if not exists ps_crud as select sequence as id from nm_outbox;`);
  sqlite.transaction(() => {
    for (const [table, fields] of Object.entries(TABLE_COLUMNS)) {
      sqlite.exec(`create table if not exists ${quote(table)} (id text primary key)`);
      const existing = new Set((sqlite.prepare(`pragma table_info(${quote(table)})`).all() as Array<{ name: string }>).map((x) => x.name));
      for (const [column, type] of Object.entries(fields)) {
        if (!existing.has(column)) sqlite.exec(`alter table ${quote(table)} add column ${quote(column)} ${type}`);
        if (column.endsWith('_id') || column.endsWith('_at')) sqlite.exec(`create index if not exists ${quote(`nm_${table}_${column}`)} on ${quote(table)} (${quote(column)})`);
      }
      for (const index of TABLES[table as keyof typeof TABLES].indexes) {
        sqlite.exec(`create index if not exists ${quote(`nm_${table}_${index.name}`)} on ${quote(table)} (${index.columns.map((column) => quote(column.name)).join(',')})`);
      }
      if (!writableTables.has(table)) continue;
      const json = (alias: string) => `json_object(${['id', ...Object.keys(fields)].map((key) => `'${key}', ${alias}.${quote(key)}`).join(',')})`;
      for (const [event, op, alias] of [['insert', 'PUT', 'new'], ['update', 'PATCH', 'new'], ['delete', 'DELETE', 'old']] as const) {
        sqlite.exec(`drop trigger if exists ${quote(`nm_outbox_${table}_${event}`)};
          create trigger ${quote(`nm_outbox_${table}_${event}`)} after ${event} on ${quote(table)}
          when (select value from nm_sync_meta where key = 'suppress') = '0' begin
            insert into nm_outbox(table_name,row_id,operation,row_data) values ('${table}',${alias}.id,'${op}',${json(alias)});
          end;`);
      }
    }
  })();
  return sqlite;
}

/** Read public views only; PowerSync retains ownership of its original durable upload queue. */
export function readLegacyCache(filename: string, apply: (change: ReplicaChange) => void): void {
  const source = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    source.transaction(() => {
      const tables = new Set((source.prepare("select name from sqlite_master where type in ('view','table')").all() as Array<{ name: string }>).map((r) => r.name));
      for (const table of Object.keys(TABLE_COLUMNS)) {
        if (!tables.has(table)) continue;
        for (const row of source.prepare(`select * from ${quote(table)}`).all() as Array<Record<string, unknown>>) {
          apply({ table, id: String(row['id']), row });
        }
      }
    })();
  } finally { source.close(); }
}

/** Read-only migration guard. A pending PowerSync queue must reach the existing HTTP command
 * lane before a Local replica can publish any new writes. No SDK internal state is imported. */
export function pendingPowerSyncWrites(filename: string): number {
  if (!existsSync(filename)) return 0;
  const source = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    if (!source.prepare("select 1 from sqlite_master where name='ps_crud'").get()) return 0;
    return Number((source.prepare('select count(*) n from ps_crud').get() as { n: number }).n);
  } finally { source.close(); }
}
