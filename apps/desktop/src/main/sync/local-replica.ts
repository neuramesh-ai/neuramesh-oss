import type Database from 'better-sqlite3';
import { openLocalDatabase, readLegacyCache, quote } from './local-schema';
export { pendingPowerSyncWrites } from './local-schema';
import { existsSync } from 'node:fs';
import { TABLE_COLUMNS } from '@neuramesh/client-core/schema';
import { LOCAL_SYNC_SCHEMA_VERSION, type ReplicaBatch, type ReplicaChange, type ReplicaDatabase, type ReplicaResult, type ReplicaStatus } from '@neuramesh/client-core/replica';
import { uploadCrudEntry, type UploadIdentity } from '@neuramesh/client-core/crud-upload';
import type { CrudEntry } from '@powersync/common';

type OutboxRow = { sequence: number; table_name: string; row_id: string; operation: 'PUT' | 'PATCH' | 'DELETE'; row_data: string };
type Watch = { sql: string; params: unknown[]; result: (r: ReplicaResult) => void; error?: (e: Error) => void; previous?: string };
export interface LocalSyncConnection {
  apiUrl: string;
  identity: () => Promise<UploadIdentity>;
  fetchImpl?: typeof fetch;
  pollMs?: number;
  /** Idempotent upgrade work. A failure stays retryable and leaves cached rows readable. */
  beforeSync?: () => Promise<void>;
}
const result = (rows: Record<string, unknown>[], rowsAffected = 0): ReplicaResult => ({ rows: { _array: rows, length: rows.length, item: (i) => rows[i]! }, rowsAffected });

/** A real SQLite read model. Local edits and their durable outbox entries share one SQLite
 * transaction. Downloaded batches and their cursor also share a transaction. Neither a network
 * error nor a process restart can acknowledge an edit or advance a cursor prematurely. */
export class LocalReplica implements ReplicaDatabase {
  private readonly sqlite: Database.Database;
  private readonly watches = new Set<Watch>();
  private readonly listeners = new Set<{ statusChanged?: (s: ReplicaStatus) => void }>();
  private connection?: LocalSyncConnection;
  private timer?: ReturnType<typeof setTimeout>;
  private inflight?: Promise<void>;
  private closed = false;
  private generation = 0;
  private failures = 0;
  private firstWaiters: Array<() => void> = [];
  private rowWaiters = new Map<string, { promise: Promise<boolean>; finish: (synced: boolean) => void }>();
  currentStatus: ReplicaStatus = { connected: false };

  constructor(filename: string) {
    this.sqlite = openLocalDatabase(filename);
    const stamp = this.meta('lastSyncedAt');
    if (stamp) this.currentStatus.lastSyncedAt = new Date(stamp);
  }

  async getAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.sqlite.prepare(sql).all(...params) as T[];
  }
  /** Import only public read views for the first offline boot. The old file remains intact.
   * Its upload queue is drained through the original validated HTTP path before connect. */
  adoptPowerSyncCache(filename: string): void {
    if (!existsSync(filename) || this.meta('legacyCacheImported')) return;
    this.sqlite.transaction(() => this.suppress(() => {
      readLegacyCache(filename, (change) => this.applyChange(change));
      this.setMeta('legacyCacheImported', '1');
    }))();
  }

  async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.getAll<T>(sql, params);
    if (!rows.length) throw new Error('No row found');
    return rows[0]!;
  }
  async execute(sql: string, params: unknown[] = []): Promise<ReplicaResult> {
    const statement = this.sqlite.prepare(sql);
    if (statement.reader) return result(statement.all(...params) as Record<string, unknown>[]);
    const changed = this.sqlite.transaction(() => statement.run(...params))();
    this.notifyWatches();
    this.schedule(0);
    return result([], changed.changes);
  }
  watch(sql: string, params: unknown[], handlers: { onResult: (r: ReplicaResult) => void; onError?: (error: Error) => void }, options?: { signal?: AbortSignal }): void {
    if (options?.signal?.aborted) return;
    const watch: Watch = { sql, params, result: handlers.onResult, error: handlers.onError };
    this.watches.add(watch);
    options?.signal?.addEventListener('abort', () => this.watches.delete(watch), { once: true });
    queueMicrotask(() => { if (this.watches.has(watch)) this.notifyWatch(watch); });
  }
  registerListener(listener: { statusChanged?: (s: ReplicaStatus) => void }): () => void {
    this.listeners.add(listener);
    listener.statusChanged?.(this.currentStatus);
    return () => { this.listeners.delete(listener); };
  }
  async waitForReady(): Promise<void> {}
  async waitForFirstSync(): Promise<void> {
    if (this.currentStatus.lastSyncedAt) return;
    await new Promise<void>((resolve) => this.firstWaiters.push(resolve));
  }
  waitForRowSync(table: string, id: string): Promise<boolean> {
    const key = JSON.stringify([table, id]);
    const existing = this.rowWaiters.get(key);
    if (existing) return existing.promise;
    if (this.closed) return Promise.resolve(false);
    let finish!: (synced: boolean) => void;
    const promise = new Promise<boolean>((resolve) => { finish = resolve; });
    const abort = new AbortController();
    this.rowWaiters.set(key, { promise, finish: (synced) => { abort.abort(); this.rowWaiters.delete(key); finish(synced); } });
    this.watch(`select
      (select count(*) from nm_outbox where table_name = ? and row_id = ?) as pending,
      (select count(*) from nm_server_rows where table_name = ? and row_id = ?) as synced`, [table, id, table, id], {
      onResult: (r) => {
        const row = r.rows?._array[0] as { pending: number; synced: number };
        if (!row.pending) this.rowWaiters.get(key)?.finish(!!row.synced);
      },
      onError: () => this.rowWaiters.get(key)?.finish(false),
    }, { signal: abort.signal });
    return promise;
  }
  async connect(connection: LocalSyncConnection): Promise<void> {
    await this.disconnect();
    this.connection = connection;
    this.generation++;
    // A cached replica is readable before the first network call completes.
    this.schedule(0);
  }
  async disconnect(): Promise<void> {
    this.connection = undefined;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.inflight?.catch(() => {});
    this.setStatus({ connected: false });
  }
  async disconnectAndClear(): Promise<void> {
    await this.disconnect();
    // Never discard the outbox on workspace changes. A bootstrap retains only still-authorized
    // pending rows in the visible cache, and quarantines the rest in this durable queue.
    this.sqlite.transaction(() => {
      this.suppress(() => { for (const table of Object.keys(TABLE_COLUMNS)) this.sqlite.exec(`delete from ${quote(table)}`); });
      this.sqlite.exec('delete from nm_server_rows');
      this.sqlite.prepare("delete from nm_sync_meta where key != 'suppress'").run();
    })();
    this.currentStatus = { connected: false };
    this.notifyWatches();
  }
  async close(): Promise<void> {
    await this.disconnect();
    this.closed = true;
    for (const waiter of this.rowWaiters.values()) waiter.finish(false);
    this.watches.clear();
    this.sqlite.close();
  }

  /** One awaited pass is also the integration-test seam. Production uses the same pass. */
  async syncNow(): Promise<void> {
    if (this.inflight) return this.inflight;
    const connection = this.connection;
    if (!connection || this.closed) return;
    const generation = this.generation;
    this.inflight = this.sync(connection, generation).finally(() => { this.inflight = undefined; });
    return this.inflight;
  }
  private async sync(connection: LocalSyncConnection, generation: number): Promise<void> {
    const fetchImpl = connection.fetchImpl ?? fetch;
    const identity = await connection.identity();
    await connection.beforeSync?.();
    if (generation !== this.generation) return;
    const headers = { ...(identity.authHeaders ?? {}), 'x-nm-actor': JSON.stringify(identity.defaultActor) };
    this.setStatus({ dataFlowStatus: { downloading: true, uploading: false } });
    const download = async () => {
      let again = true;
      while (again && generation === this.generation) {
        const cursor = this.meta('cursor');
        let bootstrap = !cursor;
        let response = await fetchImpl(`${connection.apiUrl}/v1/sync/${bootstrap ? 'bootstrap' : `changes?cursor=${encodeURIComponent(cursor!)}`}`, { headers, signal: AbortSignal.timeout(30_000) });
        if (response.status === 409 && !bootstrap) {
          bootstrap = true;
          response = await fetchImpl(`${connection.apiUrl}/v1/sync/bootstrap`, { headers, signal: AbortSignal.timeout(30_000) });
        }
        if (!response.ok) throw new Error(`Local sync failed (${response.status})`);
        const batch = await response.json() as ReplicaBatch;
        if (generation !== this.generation) return;
        this.applyBatch(batch, bootstrap);
        again = batch.hasMore;
      }
    };
    // Refresh authorization before upload. A membership change purges old visible rows before
    // any pending write can be sent under a stale assumption.
    await download();
    if (generation !== this.generation) return;
    this.setStatus({ dataFlowStatus: { downloading: false, uploading: true } });
    const allowed = new Set(JSON.parse(this.meta('workspaces') ?? '[]') as string[]);
    const pending = this.sqlite.prepare('select * from nm_outbox order by sequence').all() as OutboxRow[];
    for (const row of pending) {
      if (generation !== this.generation) return;
      const data = JSON.parse(row.row_data) as Record<string, unknown>;
      if (!allowed.has(String(data['workspace_id'] ?? ''))) continue;
      const outcome = await uploadCrudEntry({ ...identity, fetchImpl }, { id: row.row_id, table: row.table_name, op: row.operation, opData: data } as CrudEntry);
      if (outcome === 'unhandled') throw new Error(`Unsupported local write: ${row.table_name} ${row.operation}`);
      if (generation !== this.generation) return;
      // ACK each operation, never a whole snapshot of the queue. Edits made during a request
      // remain pending and overlay the server echo until their own request succeeds.
      this.sqlite.transaction(() => this.suppress(() => {
        this.sqlite.prepare('delete from nm_outbox where sequence = ?').run(row.sequence);
        const canonical = this.sqlite.prepare('select row_data from nm_server_rows where table_name = ? and row_id = ?').get(row.table_name, row.row_id) as { row_data: string } | undefined;
        if (canonical || outcome === 'skipped') this.applyChange({ table: row.table_name, id: row.row_id, row: canonical ? JSON.parse(canonical.row_data) : null });
        // A write made while its predecessor was uploading must stay visible even if the
        // following download fails. Its own ACK is the only event that can remove its overlay.
        for (const newer of this.sqlite.prepare('select * from nm_outbox where table_name = ? and row_id = ? order by sequence').all(row.table_name, row.row_id) as OutboxRow[]) {
          this.applyChange({ table: newer.table_name, id: newer.row_id, row: newer.operation === 'DELETE' ? null : JSON.parse(newer.row_data) });
        }
      }))();
    }
    await download();
    if (generation !== this.generation) return;
    const stamp = new Date();
    this.setMeta('lastSyncedAt', stamp.toISOString());
    this.setStatus({ connected: true, lastSyncedAt: stamp, dataFlowStatus: { downloading: false, uploading: false } });
    for (const resolve of this.firstWaiters.splice(0)) resolve();
  }

  applyBatch(batch: ReplicaBatch, bootstrap: boolean): void {
    if (batch.schemaVersion !== LOCAL_SYNC_SCHEMA_VERSION || !batch.cursor || !Array.isArray(batch.changes) || !Array.isArray(batch.workspaces)) throw new Error('Unsupported local sync response');
    this.sqlite.transaction(() => this.suppress(() => {
      if (bootstrap) {
        for (const table of Object.keys(TABLE_COLUMNS)) this.sqlite.exec(`delete from ${quote(table)}`);
        this.sqlite.exec('delete from nm_server_rows');
      }
      for (const change of batch.changes) {
        this.applyChange(change);
        if (change.row) this.sqlite.prepare('insert into nm_server_rows values (?,?,?) on conflict(table_name,row_id) do update set row_data=excluded.row_data').run(change.table, change.id, JSON.stringify(change.row));
        else this.sqlite.prepare('delete from nm_server_rows where table_name = ? and row_id = ?').run(change.table, change.id);
      }
      const allowed = new Set(batch.workspaces);
      for (const pending of this.sqlite.prepare('select * from nm_outbox order by sequence').all() as OutboxRow[]) {
        const row = JSON.parse(pending.row_data) as Record<string, unknown>;
        if (allowed.has(String(row['workspace_id'] ?? ''))) this.applyChange({ table: pending.table_name, id: pending.row_id, row: pending.operation === 'DELETE' ? null : row });
      }
      this.setMeta('cursor', batch.cursor);
      this.setMeta('workspaces', JSON.stringify(batch.workspaces));
    }))();
    this.notifyWatches();
  }
  private applyChange(change: ReplicaChange): void {
    const columns = TABLE_COLUMNS[change.table];
    if (!columns || typeof change.id !== 'string') throw new Error('Unknown local sync table or row');
    if (!change.row) { this.sqlite.prepare(`delete from ${quote(change.table)} where id = ?`).run(change.id); return; }
    const keys = ['id', ...Object.keys(columns)];
    const values = keys.map((key) => key === 'id' ? change.id : change.row![key] ?? null);
    this.sqlite.prepare(`insert into ${quote(change.table)} (${keys.map(quote).join(',')}) values (${keys.map(() => '?').join(',')})
      on conflict(id) do update set ${keys.slice(1).map((key) => `${quote(key)}=excluded.${quote(key)}`).join(',')}`).run(...values);
  }
  private suppress(work: () => void): void {
    this.setMeta('suppress', '1');
    try { work(); } finally { this.setMeta('suppress', '0'); }
  }
  private meta(key: string): string | undefined { return (this.sqlite.prepare('select value from nm_sync_meta where key = ?').get(key) as { value: string } | undefined)?.value; }
  private setMeta(key: string, value: string): void { this.sqlite.prepare('insert into nm_sync_meta values (?,?) on conflict(key) do update set value=excluded.value').run(key, value); }
  private notifyWatch(watch: Watch): void {
    try {
      const rows = this.sqlite.prepare(watch.sql).all(...watch.params) as Record<string, unknown>[];
      const serialized = JSON.stringify(rows);
      if (watch.previous === serialized) return;
      watch.previous = serialized;
      watch.result(result(rows));
    } catch (error) { watch.error?.(error instanceof Error ? error : new Error(String(error))); }
  }
  private notifyWatches(): void { for (const watch of this.watches) this.notifyWatch(watch); }
  private setStatus(patch: Partial<ReplicaStatus>): void { this.currentStatus = { ...this.currentStatus, ...patch }; for (const l of this.listeners) l.statusChanged?.(this.currentStatus); }
  private schedule(delay: number): void {
    if (!this.connection || this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.syncNow().then(() => { this.failures = 0; }).catch((error: unknown) => {
        this.failures++;
        this.setStatus({ connected: false, dataFlowStatus: { downloading: false, uploading: false } });
        console.error('local_sync_failed', error instanceof Error ? error.message : error);
      }).finally(() => this.schedule(Math.min(30_000, (this.connection?.pollMs ?? 1000) * 2 ** Math.min(this.failures, 5))));
    }, delay);
    this.timer.unref?.();
  }
}
