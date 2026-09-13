// What a watch module needs from startSync. Declared once so the three watch modules cannot
// drift on it, and so the registry's ownership is stated: `watchers` belongs to the SESSION —
// a watch registers an abort handle there and the renderer's unsubscribe finds it by subId.
import type { PowerSyncDatabase } from '@powersync/node';

export interface WatchDeps {
  db: () => PowerSyncDatabase;
  /** subId → abort handle. Owned by startSync; a watch only ever adds to it. */
  watchers: Map<string, AbortController>;
  /** one place to report a query that failed, so a dead watch is visible rather than silent */
  watchFailed: (err: unknown) => void;
  loadRoster: () => Promise<{ machines: unknown[]; agents: unknown[]; members: unknown[] }>;
  ws: () => string;
}
