import { isUnrecoverableUploadError } from './api';
import { uploadCrudEntry, type UploadIdentity } from './crud-upload';
import { SYNC_LONG_POLL_S, type ReplicaBatch, type ReplicaDatabase, type ReplicaResult, type ReplicaStatus } from './replica';
import { SQLiteStore, type SQLiteDriver, type SQLiteResult } from './sqlite-store';
export type { SQLiteDriver, SQLiteResult } from './sqlite-store';
export { quoteIdentifier } from './sqlite-store';
import { controlApiRequestUrl } from '@neuramesh/shared';

export interface ReplicaConnection {
  apiUrl: string;
  identity(forceRefresh?: boolean): Promise<UploadIdentity>;
  fetchImpl?: typeof fetch;
  pollMs?: number;
  beforeSync?: () => Promise<void>;
  onUploadRejected?(reason: string, data: Record<string, unknown>): void;
  /** Browser tabs serialize feed/download/ACK passes while still allowing concurrent reads. */
  exclusiveSync?<T>(work: () => Promise<T>): Promise<T>;
}
type Outbox = { sequence: number; table_name: string; row_id: string; operation: 'PUT' | 'PATCH' | 'DELETE'; row_data: string; owner: string };
type Watch = { sql: string; params: unknown[]; handlers: { onResult(r: ReplicaResult): void; onError?(e: Error): void }; previous?: string };
const result = ({ rows, rowsAffected = 0 }: SQLiteResult): ReplicaResult => ({ rows: { _array: rows, length: rows.length, item: i => rows[i]! }, rowsAffected });
const errorOf = (e: unknown): Error => e instanceof Error ? e : new Error(String(e));

export class SQLiteReplica extends SQLiteStore implements ReplicaDatabase {
  private readonly watches = new Set<Watch>();
  private readonly listeners = new Set<{ statusChanged?(s: ReplicaStatus): void }>();
  private readonly changes = new Set<() => void>();
  private connection?: ReplicaConnection;
  private abort?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private inflight?: Promise<void>;
  private generation = 0;
  private failures = 0;
  private refreshCredentials = false;
  /** the server's long-poll capability, from its last batch (ReplicaBatch.wait): 0 means poll every pollMs */
  private longPollS = 0;
  /** the loop's owner: schedule() moves it, and a chain holding an older one stops */
  private ticket = 0;
  /** ends the long-poll in flight: a local write, a reconnect or a disconnect pulls it */
  private newsAbort?: AbortController;
  /** a local write since the current pass began: the loop must not start waiting */
  private dirty = false;
  private readonly closeWaiters = new Set<() => void>();
  private readonly rejectedRows = new Set<string>();

  constructor(driver: SQLiteDriver) { super(driver); }
  onChangeWithCallback(listener: { onChange(): void }, _options?: { tables?: string[] }): () => void {
    this.changes.add(listener.onChange);
    return () => { this.changes.delete(listener.onChange); };
  }
  async execute(sql: string, params: unknown[] = []): Promise<ReplicaResult> {
    const value = await this.run(() => this.transaction(() => this.driver.query(sql, params)));
    this.notifyWatches();
    this.kick();
    return result(value);
  }
  watch(sql: string, params: unknown[], handlers: Watch['handlers'], options?: { signal?: AbortSignal }): void {
    if (options?.signal?.aborted) return;
    const watch = { sql, params, handlers };
    this.watches.add(watch);
    options?.signal?.addEventListener('abort', () => this.watches.delete(watch), { once: true });
    void this.notifyWatch(watch);
  }
  private async notifyWatch(watch: Watch): Promise<void> {
    try {
      const rows = await this.getAll(watch.sql, watch.params);
      if (!this.watches.has(watch)) return;
      const serialized = JSON.stringify(rows);
      if (watch.previous === serialized) return;
      watch.previous = serialized;
      watch.handlers.onResult(result({ rows }));
    } catch (e) { if (this.watches.has(watch)) watch.handlers.onError?.(errorOf(e)); }
  }
  notifyWatches(): void { for (const watch of this.watches) void this.notifyWatch(watch); for (const changed of this.changes) changed(); }
  registerListener(listener: { statusChanged?(s: ReplicaStatus): void }): () => void {
    this.listeners.add(listener); listener.statusChanged?.(this.currentStatus);
    return () => { this.listeners.delete(listener); };
  }
  async waitForStatus(predicate: (status: ReplicaStatus) => boolean): Promise<void> {
    await this.ready;
    if (predicate(this.currentStatus)) return;
    if (this.closed) throw new Error('Replica is closed');
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { this.listeners.delete(listener); this.closeWaiters.delete(onClose); };
      const onClose = () => { cleanup(); reject(new Error('Replica is closed')); };
      const listener = { statusChanged: (status: ReplicaStatus) => { if (predicate(status)) { cleanup(); resolve(); } } };
      this.listeners.add(listener); this.closeWaiters.add(onClose);
    });
  }
  protected setStatus(patch: Partial<ReplicaStatus>): void {
    this.currentStatus = { ...this.currentStatus, ...patch };
    for (const listener of this.listeners) listener.statusChanged?.(this.currentStatus);
  }
  async waitForFirstSync(): Promise<void> {
    await this.waitForStatus(status => !!status.lastSyncedAt);
  }
  waitForRowSync(table: string, id: string): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    return new Promise(resolve => {
      const abort = new AbortController();
      const finish = (synced: boolean) => { abort.abort(); this.closeWaiters.delete(onClose); resolve(synced); };
      const onClose = () => finish(false);
      this.closeWaiters.add(onClose);
      this.watch('select (select count(*) from nm_outbox where table_name=? and row_id=?) pending, (select count(*) from nm_server_rows where table_name=? and row_id=?) synced', [table, id, table, id], {
        onResult: r => { const row = r.rows?._array[0] as { pending: number; synced: number }; if (!row.pending && (row.synced || this.rejectedRows.has(`${table}:${id}`))) { finish(!!row.synced); } },
        onError: () => finish(false),
      }, { signal: abort.signal });
    });
  }
  async connect(connection: ReplicaConnection): Promise<void> {
    await this.disconnect();
    await this.ready;
    this.connection = connection;
    this.abort = new AbortController();
    this.schedule(0);
  }
  async disconnect(): Promise<void> {
    this.connection = undefined; this.generation++; this.abort?.abort();
    this.newsAbort?.abort(); this.newsAbort = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.inflight?.catch(() => {});
    this.setStatus({ connected: false, dataFlowStatus: { downloading: false, uploading: false } });
  }
  async disconnectAndClear(): Promise<void> {
    await this.disconnect();
    await this.run(() => this.transaction(() => this.suppress(async () => {
      await this.clearVisible();
      await this.driver.query("delete from nm_sync_meta where key='owner'");
    })));
    this.currentStatus = { connected: false };
    this.setStatus({}); this.notifyWatches();
  }
  async close(): Promise<void> {
    await this.disconnect(); await this.ready; await this.queue;
    this.closed = true;
    for (const onClose of this.closeWaiters) onClose();
    this.closeWaiters.clear(); this.watches.clear(); this.listeners.clear(); this.changes.clear();
    await this.driver.close();
  }
  async syncNow(): Promise<void> {
    if (this.inflight) return this.inflight;
    if (!this.connection || this.closed) return;
    const connection = this.connection, generation = this.generation, signal = this.abort!.signal;
    const pass = () => this.sync(connection, generation, signal);
    this.inflight = (connection.exclusiveSync ? connection.exclusiveSync(pass) : pass()).catch(e => {
      this.setStatus({ connected: false, error: errorOf(e).message, dataFlowStatus: { downloading: false, uploading: false } });
      throw e;
    }).finally(() => { this.inflight = undefined; });
    return this.inflight;
  }
  private async sync(connection: ReplicaConnection, generation: number, signal: AbortSignal): Promise<void> {
    if (generation !== this.generation) return;
    // this pass reads the outbox after its first download: a write before that read rides this pass,
    // and a write after it sets the flag again, so the loop runs another pass instead of a long-poll
    this.dirty = false;
    const identity = await connection.identity(this.refreshCredentials);
    this.refreshCredentials = false;
    const owner = JSON.stringify(identity.defaultActor);
    if (generation !== this.generation) return;
    await this.activate(identity.defaultActor);
    const fetchImpl = connection.fetchImpl ?? fetch;
    const headers = { ...(identity.authHeaders ?? {}), 'x-nm-actor': JSON.stringify(identity.defaultActor) };
    const download = async () => {
      let again = true;
      while (again && generation === this.generation) {
        const cursor = await this.run(() => this.meta('cursor'));
        let bootstrap = !cursor;
        const request = async (path: string) => {
          // Hermes does not expose AbortSignal.any/timeout on every supported iOS build.
          const requestAbort = new AbortController();
          const cancel = () => requestAbort.abort();
          signal.addEventListener('abort', cancel, { once: true });
          const timeout = setTimeout(cancel, 30_000);
          try {
            if (signal.aborted) cancel();
            const response = await fetchImpl(controlApiRequestUrl(connection.apiUrl, `/v1/brain/replica/${path}`), { headers, signal: requestAbort.signal });
            return { status: response.status, ok: response.ok, batch: response.ok ? await response.json() as ReplicaBatch : null };
          } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
        };
        let response = await request(bootstrap ? 'bootstrap' : `changes?cursor=${encodeURIComponent(cursor!)}`);
        if (response.status === 409 && !bootstrap) { bootstrap = true; response = await request('bootstrap'); }
        if (!response.ok) { if (response.status === 401) this.refreshCredentials = true; throw new Error(`Sync failed (${response.status})`); }
        const batch = response.batch!;
        if (generation !== this.generation) return;
        await this.applyBatch(batch, bootstrap);
        this.longPollS = typeof batch.wait === 'number' && batch.wait > 0 ? batch.wait : 0;
        again = batch.hasMore;
      }
    };
    this.setStatus({ dataFlowStatus: { downloading: true, uploading: false } });
    await download();
    await connection.beforeSync?.();
    if (generation !== this.generation) return;
    this.setStatus({ dataFlowStatus: { downloading: false, uploading: true } });
    const allowed = new Set(JSON.parse((await this.run(() => this.meta('workspaces'))) ?? '[]') as string[]);
    const pending = await this.getAll<Outbox>('select * from nm_outbox where owner=? order by sequence', [owner]);
    for (const row of pending) {
      if (generation !== this.generation) return;
      const data = JSON.parse(row.row_data) as Record<string, unknown>;
      if (!allowed.has(String(data['workspace_id'] ?? ''))) continue;
      const uploadFetch: typeof fetch = async (input, init) => {
        const controller = new AbortController();
        const cancel = () => controller.abort();
        signal.addEventListener('abort', cancel, { once: true });
        const timeout = setTimeout(cancel, 30_000);
        try {
          if (signal.aborted) cancel();
          const response = await fetchImpl(input, { ...init, signal: controller.signal });
          // Authentication failures must never be treated as an unwriteable board and dropped.
          if (response.status === 401) { this.refreshCredentials = true; throw new Error('Sync upload requires a refreshed session (401)'); }
          const bytes = await response.arrayBuffer();
          return new Response(response.status === 204 ? null : bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
        } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
      };
      let outcome: Awaited<ReturnType<typeof uploadCrudEntry>>;
      let refusal: string | undefined;
      try { outcome = await uploadCrudEntry({ ...identity, fetchImpl: uploadFetch }, { id: row.row_id, table: row.table_name, op: row.operation, opData: data }); }
      catch (error) {
        if (!isUnrecoverableUploadError(error)) throw error;
        refusal = errorOf(error).message; outcome = 'skipped';
      }
      if (outcome === 'unhandled') throw new Error(`Unsupported queued write: ${row.table_name} ${row.operation}`);
      if (generation !== this.generation) return;
      await this.run(() => this.transaction(() => this.suppress(async () => {
        if (refusal) await this.driver.query('insert or replace into nm_failed_uploads values (?,?,?,?,?,?,?)', [row.sequence, row.table_name, row.row_id, row.operation, row.row_data, row.owner, refusal]);
        await this.driver.query('delete from nm_outbox where sequence=?', [row.sequence]);
        const canonical = (await this.driver.query('select row_data from nm_server_rows where table_name=? and row_id=?', [row.table_name, row.row_id])).rows[0];
        if (canonical || outcome === 'skipped') await this.applyChange({ table: row.table_name, id: row.row_id, row: canonical ? JSON.parse(String(canonical['row_data'])) : null });
        await this.overlay(owner, allowed);
      })));
      if (outcome === 'skipped') this.rejectedRows.add(`${row.table_name}:${row.row_id}`);
      if (refusal) connection.onUploadRejected?.(refusal, data);
      this.notifyWatches();
    }
    await download();
    if (generation !== this.generation) return;
    const stamp = new Date();
    await this.run(() => this.setMeta('lastSyncedAt', stamp.toISOString()));
    this.setStatus({ connected: true, error: undefined, lastSyncedAt: stamp, dataFlowStatus: { downloading: false, uploading: false } });
  }
  private schedule(delay: number): void {
    if (!this.connection || this.closed) return;
    // a newer schedule owns the loop: an older chain (a wait cut short, a pass that was already running)
    // sees its ticket go stale and never schedules again, so one connection has one loop
    const ticket = ++this.ticket;
    this.newsAbort?.abort();
    this.newsAbort = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.syncNow().then(() => { this.failures = 0; return this.pause(ticket); }, (e: unknown) => this.failed(e))
        .catch((e: unknown) => this.failed(e))
        .then((next) => { if (ticket === this.ticket) this.schedule(next); });
    }, delay);
    this.timer.unref?.();
  }
  /** a failed pass or long-poll: report it and back off, pollMs doubling up to 30 s */
  private failed(e: unknown): number {
    this.failures++; this.setStatus({ connected: false, dataFlowStatus: { downloading: false, uploading: false } });
    if (!this.abort?.signal.aborted) console.error('replica_sync_failed', errorOf(e).message);
    return Math.min(30_000, (this.connection?.pollMs ?? 1000) * 2 ** Math.min(this.failures, 5));
  }
  /** a local write wants its pass now: end the current wait or sleep */
  private kick(): void {
    this.dirty = true;
    this.schedule(0);
  }
  /** The delay before the next pass. Against a server that holds long-polls (ReplicaBatch.wait), one
   *  long-poll instead of a pollMs sleep. A local write since the pass began means no wait at all. */
  private async pause(ticket: number): Promise<number> {
    const pollMs = this.connection?.pollMs ?? 1000;
    if (this.dirty) return 0;
    if (!(this.longPollS > 0)) return pollMs;
    return this.waitForNews(ticket, pollMs);
  }
  /**
   * THE LONG-POLL (Cloud Run round 6, design §10.2). GET changes?cursor=…&wait=25: the server answers at
   * once when anything is newer, else holds the request until a commit's NOTIFY or the wait ends. It
   * returns the delay before the next pass: 0 when something is newer (or a local write came), the
   * server's retryMs when it already holds as many waits as it may, pollMs when the "wait" came back
   * at once (a server that does not really hold one must not make this spin). News is applied here
   * only when no pass is running, the cursor is still the one asked with, and no exclusiveSync lock
   * guards the passes (browser tabs): otherwise the next pass reads it, one request later.
   * Hermes: no AbortSignal.any or AbortSignal.timeout, so the signals are linked by hand.
   */
  private async waitForNews(ticket: number, pollMs: number): Promise<number> {
    const connection = this.connection, generation = this.generation, outer = this.abort?.signal;
    if (!connection || !outer) return pollMs;
    const fetchImpl = connection.fetchImpl ?? fetch;
    for (;;) {
      if (ticket !== this.ticket || generation !== this.generation || this.dirty || this.refreshCredentials) return 0;
      const cursor = await this.run(() => this.meta('cursor'));
      if (!cursor) return 0;
      const identity = await connection.identity(false);
      // checked again after the awaits, with nothing async between here and arming the abort: a write
      // that came meanwhile must not wait behind a 25 s request
      if (ticket !== this.ticket || generation !== this.generation || this.dirty) return 0;
      const wait = Math.min(SYNC_LONG_POLL_S, this.longPollS);
      const headers = { ...(identity.authHeaders ?? {}), 'x-nm-actor': JSON.stringify(identity.defaultActor) };
      const stop = new AbortController();
      const cancel = () => stop.abort();
      this.newsAbort = stop;
      outer.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(cancel, (wait + 15) * 1000);
      timeout.unref?.();
      const started = Date.now();
      let status: number, batch: ReplicaBatch | null;
      try {
        if (outer.aborted) cancel();
        const response = await fetchImpl(controlApiRequestUrl(connection.apiUrl, `/v1/brain/replica/changes?cursor=${encodeURIComponent(cursor)}&wait=${wait}`), { headers, signal: stop.signal });
        status = response.status;
        batch = response.ok ? await response.json() as ReplicaBatch : null;
      } catch (error) {
        if (stop.signal.aborted) return 0;
        throw error;
      } finally {
        clearTimeout(timeout);
        outer.removeEventListener('abort', cancel);
        if (this.newsAbort === stop) this.newsAbort = undefined;
      }
      if (stop.signal.aborted || ticket !== this.ticket || generation !== this.generation) return 0;
      // a reset is the pass's to handle (it bootstraps), and so is a credential refresh
      if (status === 409) return 0;
      if (status === 401) { this.refreshCredentials = true; return 0; }
      if (!batch) throw new Error(`Sync wait failed (${status})`);
      this.longPollS = typeof batch.wait === 'number' && batch.wait > 0 ? batch.wait : 0;
      if (batch.cursor !== cursor || batch.hasMore || batch.changes.length) {
        if (batch.hasMore || this.inflight || connection.exclusiveSync || this.dirty) return 0;
        if (await this.run(() => this.meta('cursor')) !== cursor) return 0;
        await this.applyBatch(batch, false);
        const stamp = new Date();
        await this.run(() => this.setMeta('lastSyncedAt', stamp.toISOString()));
        this.setStatus({ connected: true, error: undefined, lastSyncedAt: stamp });
        continue;
      }
      if (typeof batch.retryMs === 'number' && batch.retryMs > 0) return batch.retryMs;
      if (!this.longPollS || Date.now() - started < 1000) return pollMs;
    }
  }
}
