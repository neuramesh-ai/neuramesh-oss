/** The shared SQLite read model and durable outbox on web, desktop, machines and iOS. */
export interface ReplicaStatus {
  connected: boolean;
  error?: string;
  lastSyncedAt?: Date;
  dataFlowStatus?: { downloading?: boolean; uploading?: boolean };
}
export interface ReplicaResult<T = unknown> {
  rows?: { _array: T[]; length: number; item: (index: number) => T };
  rowsAffected?: number;
}
export interface ReplicaDatabase {
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T>;
  getAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<ReplicaResult>;
  watch(sql: string, params: unknown[], handlers: { onResult: (result: ReplicaResult) => void; onError?: (error: Error) => void }, options?: { signal?: AbortSignal }): void;
  readonly currentStatus: ReplicaStatus;
  registerListener(listener: { statusChanged?: (status: ReplicaStatus) => void }): () => void;
  waitForReady(): Promise<void>;
  waitForFirstSync(): Promise<void>;
  /** Local optimistic rows are visible to the UI before they are safe to trigger server work. */
  waitForRowSync?(table: string, id: string): Promise<boolean>;
  disconnect(): Promise<void>;
  disconnectAndClear(): Promise<void>;
  close(): Promise<void>;
}

export const LOCAL_SYNC_SCHEMA_VERSION = 1;
export interface ReplicaChange {
  table: string;
  id: string;
  row: Record<string, unknown> | null;
}
export interface ReplicaBatch {
  schemaVersion: number;
  cursor: string;
  workspaces: string[];
  changes: ReplicaChange[];
  hasMore: boolean;
}
