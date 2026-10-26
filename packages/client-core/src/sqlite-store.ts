import { TABLE_COLUMNS, TABLES } from './schema';
import type { UploadIdentity } from './crud-upload';
import { LOCAL_SYNC_SCHEMA_VERSION, type ReplicaBatch, type ReplicaChange, type ReplicaStatus } from './replica';
import type { LegacyReplica } from './replica-upgrade';

export interface SQLiteResult { rows: Record<string, unknown>[]; rowsAffected?: number }
/** Adapters own only SQLite I/O. Transactions, watches, authorization and the durable outbox
 * are identical in the browser worker, native SQLite and the desktop/machine runtime. */
export interface SQLiteDriver {
  journalMode?: 'wal' | 'delete';
  query(sql: string, params?: unknown[]): Promise<SQLiteResult>;
  close(): Promise<void>;
}
export const quoteIdentifier = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const q = quoteIdentifier;

type Outbox = { sequence: number; table_name: string; row_id: string; operation: 'PUT' | 'PATCH' | 'DELETE'; row_data: string; owner: string };

/** Atomic schema, cache and outbox operations shared by every SQLite adapter. */
export abstract class SQLiteStore {
  protected readonly ready: Promise<void>;
  protected queue: Promise<unknown> = Promise.resolve();
  protected closed = false;
  currentStatus: ReplicaStatus = { connected: false };
  protected abstract setStatus(patch: Partial<ReplicaStatus>): void;
  abstract notifyWatches(): void;
  constructor(protected readonly driver: SQLiteDriver) {
    this.ready = this.initialize();
    void this.ready.catch(() => {});
  }
  protected run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => { await this.ready; if (this.closed) throw new Error('Replica is closed'); return work(); });
    this.queue = next.catch(() => {});
    return next;
  }
  protected async transaction<T>(work: () => Promise<T>): Promise<T> {
    await this.driver.query('begin immediate');
    try { const value = await work(); await this.driver.query('commit'); return value; }
    catch (error) { await this.driver.query('rollback'); throw error; }
  }
  private async initialize(): Promise<void> {
    await this.driver.query(`pragma journal_mode = ${this.driver.journalMode ?? 'wal'}`);
    await this.driver.query('pragma synchronous = FULL');
    await this.transaction(async () => {
      await this.driver.query('create table if not exists nm_sync_meta (key text primary key, value text not null)');
      await this.driver.query("insert or ignore into nm_sync_meta values ('suppress','0')");
      await this.driver.query("create table if not exists nm_outbox (sequence integer primary key autoincrement, table_name text not null, row_id text not null, operation text not null, row_data text not null, owner text not null default '')");
      const outboxColumns = await this.driver.query('pragma table_info(nm_outbox)');
      if (!outboxColumns.rows.some(c => c['name'] === 'owner')) {
        await this.driver.query("alter table nm_outbox add column owner text not null default ''");
        await this.setMeta('unownedLegacyOutbox', '1');
      }
      await this.driver.query('create table if not exists nm_failed_uploads (sequence integer primary key, table_name text not null, row_id text not null, operation text not null, row_data text not null, owner text not null, reason text not null)');
      await this.driver.query('create table if not exists nm_server_rows (table_name text not null, row_id text not null, row_data text not null, primary key(table_name,row_id))');
      for (const [table, fields] of Object.entries(TABLE_COLUMNS)) {
        await this.driver.query(`create table if not exists ${q(table)} (id text primary key)`);
        const existing = new Set((await this.driver.query(`pragma table_info(${q(table)})`)).rows.map(c => c['name']));
        for (const [column, type] of Object.entries(fields)) {
          if (!existing.has(column)) await this.driver.query(`alter table ${q(table)} add column ${q(column)} ${type}`);
          if (column.endsWith('_id') || column.endsWith('_at')) await this.driver.query(`create index if not exists ${q(`nm_${table}_${column}`)} on ${q(table)} (${q(column)})`);
        }
        for (const index of TABLES[table as keyof typeof TABLES].indexes) await this.driver.query(`create index if not exists ${q(`nm_${table}_${index.name}`)} on ${q(table)} (${index.columns.map(c => q(c.name)).join(',')})`);
        if (!['messages', 'artifacts', 'whiteboards'].includes(table)) continue;
        for (const [event, operation, alias] of [['insert', 'PUT', 'new'], ['update', 'PATCH', 'new'], ['delete', 'DELETE', 'old']]) {
          const name = q(`nm_outbox_${table}_${event}`);
          await this.driver.query(`drop trigger if exists ${name}`);
          const json = `json_object(${['id', ...Object.keys(fields)].map(key => `'${key}',${alias}.${q(key)}`).join(',')})`;
          await this.driver.query(`create trigger ${name} after ${event} on ${q(table)} when (select value from nm_sync_meta where key='suppress')='0' begin
            select case when coalesce((select value from nm_sync_meta where key='owner'),'')='' then raise(abort,'Sign in before editing the replica') end;
            insert into nm_outbox(table_name,row_id,operation,row_data,owner) values ('${table}',${alias}.id,'${operation}',${json},coalesce((select value from nm_sync_meta where key='owner'),'')); end`);
        }
      }
    });
    const stamp = await this.meta('lastSyncedAt');
    if (stamp) this.currentStatus = { connected: false, lastSyncedAt: new Date(stamp) };
  }
  async waitForReady(): Promise<void> { await this.ready; }
  async importLegacy(source: LegacyReplica, owner: UploadIdentity['defaultActor'], name: string): Promise<void> {
    await this.run(() => this.transaction(() => this.suppress(async () => {
      const marker = `import:${name}`;
      if (await this.meta(marker)) return;
      const key = JSON.stringify(owner);
      const previous = await this.meta('owner');
      if (previous && previous !== key) throw new Error('Cannot import a cache into another account');
      await this.setMeta('owner', key);
      if (!(await this.meta('cursor'))) for (const row of source.rows) await this.applyChange(row);
      for (const entry of source.pending) await this.driver.query('insert into nm_outbox(table_name,row_id,operation,row_data,owner) values (?,?,?,?,?)', [entry.table, entry.id, entry.op, JSON.stringify(entry.opData ?? {}), key]);
      const allowed = new Set(JSON.parse((await this.meta('workspaces')) ?? '[]') as string[]);
      await this.overlay(key, allowed);
      await this.setMeta(marker, '1');
    })));
    this.notifyWatches();
  }
  getAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.run(async () => (await this.driver.query(sql, params)).rows as T[]);
  }
  async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.getAll<T>(sql, params);
    if (!rows.length) throw new Error('No row found');
    return rows[0]!;
  }
  async getOptional<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> { return (await this.getAll<T>(sql, params))[0] ?? null; }
  /** Bind cached reads before a signed-in UI is rendered. Foreign outboxes stay quarantined. */
  async activate(actor: UploadIdentity['defaultActor']): Promise<void> {
    const owner = JSON.stringify(actor);
    let changed = false;
    await this.run(async () => {
      const previous = await this.meta('owner');
      if (previous === owner) return;
      await this.transaction(() => this.suppress(async () => {
        const upgradingLocal = !previous && await this.meta('unownedLegacyOutbox');
        if (upgradingLocal) {
          await this.driver.query("update nm_outbox set owner=? where owner=''", [owner]);
          await this.driver.query("delete from nm_sync_meta where key='unownedLegacyOutbox'");
        } else {
          await this.clearVisible();
          this.currentStatus = { connected: false };
        }
        await this.setMeta('owner', owner);
        changed = true;
      }));
    });
    if (changed) { this.setStatus({}); this.notifyWatches(); }
  }
  protected async clearVisible(): Promise<void> {
    for (const table of Object.keys(TABLE_COLUMNS)) await this.driver.query(`delete from ${q(table)}`);
    await this.driver.query('delete from nm_server_rows');
    await this.driver.query("delete from nm_sync_meta where key in ('cursor','workspaces','lastSyncedAt')");
  }
  async applyBatch(batch: ReplicaBatch, bootstrap: boolean): Promise<void> {
    if (batch.schemaVersion !== LOCAL_SYNC_SCHEMA_VERSION || !batch.cursor || !Array.isArray(batch.changes) || !Array.isArray(batch.workspaces)) throw new Error('Unsupported sync response');
    if (!bootstrap && !batch.changes.length && await this.run(() => this.meta('cursor')) === batch.cursor) return;
    await this.run(() => this.transaction(() => this.suppress(async () => {
      if (bootstrap) await this.clearVisible();
      for (const change of batch.changes) {
        await this.applyChange(change);
        if (change.row) await this.driver.query('insert into nm_server_rows values (?,?,?) on conflict(table_name,row_id) do update set row_data=excluded.row_data', [change.table, change.id, JSON.stringify(change.row)]);
        else await this.driver.query('delete from nm_server_rows where table_name=? and row_id=?', [change.table, change.id]);
      }
      await this.overlay((await this.meta('owner')) ?? '', new Set(batch.workspaces));
      await this.setMeta('cursor', batch.cursor);
      await this.setMeta('workspaces', JSON.stringify(batch.workspaces));
    })));
    if (bootstrap || batch.changes.length) this.notifyWatches();
  }
  protected async overlay(owner: string, allowed: Set<string>): Promise<void> {
    const pending = (await this.driver.query('select * from nm_outbox where owner=? order by sequence', [owner])).rows as unknown as Outbox[];
    for (const entry of pending) {
      const row = JSON.parse(entry.row_data) as Record<string, unknown>;
      if (allowed.has(String(row['workspace_id'] ?? ''))) await this.applyChange({ table: entry.table_name, id: entry.row_id, row: entry.operation === 'DELETE' ? null : row });
    }
  }
  protected async applyChange(change: ReplicaChange): Promise<void> {
    const columns = TABLE_COLUMNS[change.table];
    if (!columns || typeof change.id !== 'string') throw new Error('Unknown sync table or row');
    if (!change.row) { await this.driver.query(`delete from ${q(change.table)} where id=?`, [change.id]); return; }
    const keys = ['id', ...Object.keys(columns)];
    await this.driver.query(`insert into ${q(change.table)} (${keys.map(q).join(',')}) values (${keys.map(() => '?').join(',')}) on conflict(id) do update set ${keys.slice(1).map(key => `${q(key)}=excluded.${q(key)}`).join(',')}`, keys.map(key => key === 'id' ? change.id : change.row![key] ?? null));
  }
  protected async suppress<T>(work: () => Promise<T>): Promise<T> {
    await this.setMeta('suppress', '1');
    try { return await work(); } finally { await this.setMeta('suppress', '0'); }
  }
  protected async meta(key: string): Promise<string | undefined> { return (await this.driver.query('select value from nm_sync_meta where key=?', [key])).rows[0]?.['value'] as string | undefined; }
  protected async setMeta(key: string, value: string): Promise<void> { await this.driver.query('insert into nm_sync_meta values (?,?) on conflict(key) do update set value=excluded.value', [key, value]); }
}
