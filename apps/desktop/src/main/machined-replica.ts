// THE MACHINE REPLICA (upstream 2026-11: PowerSync is gone from machined). Every machine reads control-api's
// committed change feed (`/v1/brain/replica/*`, the same route as `/v1/sync/*`) into the SQLite replica the
// desktop runs (client-core sqlite-replica.ts), with the machine token, as the machine's owner. The server
// scopes the feed to the machine row's workspace whatever the actor header says.
//
// What machined adds around upstream's replica (it replaces machined-feed.ts, the NM_SYNC=feed path):
//   - THE FIRST-SYNC HOLD. The replica's poll timer is unref'd, because a desktop window keeps that
//     process alive. A headless daemon that waits for its first sync has nothing else on the event loop,
//     so with stdin closed (Cloud Run, any spawned process) node simply exited at "waiting for first
//     sync" (found 2026-10-26 on the feed replica). A ref'd timer holds the loop until the first sync.
//     machined's own beats hold it after that.
//   - THE TOKEN AT EVERY CALL. A Cloud Run token renews (cloudrun/boot.ts TokenRenewal), so the identity
//     reads the token each time the replica asks. When the replica saw a 401 it asks again with
//     `forceRefresh`, and then `refreshToken` (the renewal) runs once first, at most once per window.
//   - DRAIN WRITES. The drain's last write step (cloudrun/lifecycle.ts): the outbox reaches the API before
//     a snapshot, or this throws.
import { join } from 'node:path';
import { SQLiteReplica } from '@neuramesh/client-core/sqlite-replica';
import type { UploadIdentity } from '@neuramesh/client-core/crud-upload';
import type { MachinedConfig } from './machined-config';

export interface MachineReplica {
  db: SQLiteReplica;
  /** binds the replica to the machine's owner (upstream does this before it reads the status) */
  activate(): Promise<void>;
  /** starts the feed. Holds the event loop until the first sync completes */
  connect(): Promise<void>;
  /** resolves once a sync completes after `sinceMs` (the runner seed waits on it, machined-seeds.ts) */
  syncedAfter(sinceMs: number): Promise<void>;
  /** the outbox is empty, or this throws when `timeoutMs` runs out */
  drainWrites(timeoutMs: number): Promise<void>;
}

export interface MachineReplicaOptions {
  /** the replica itself (machined builds it on the native SQLite driver, a test on node:sqlite) */
  db: SQLiteReplica;
  /** the machine's current token, read at every call */
  token: () => string;
  /** a 401 was seen: renew the token once before the replica asks again (Cloud Run only) */
  refreshToken?: () => Promise<unknown>;
  /** the least time between two refreshes, default 30 s */
  refreshGapMs?: number;
  /** a pass before each upload (upstream's legacy replica.db import) */
  beforeSync?: () => Promise<void>;
  fetchImpl?: typeof fetch;
  pollMs?: number;
  /** the loop hold's timer (a test hands in a fake) */
  hold?: { start(): unknown; stop(handle: unknown): void };
  log?: (line: string) => void;
  now?: () => number;
}

const DRAIN_POLL_MS = 250;
const loopHold = { start: (): unknown => setInterval(() => {}, 60_000), stop: (h: unknown): void => clearInterval(h as ReturnType<typeof setInterval>) };

/** the identity every feed call carries: the owner, the workspace and the token as it is now */
export function machineReplicaIdentity(cfg: Pick<MachinedConfig, 'apiUrl' | 'workspaceId' | 'ownerUserId'>, token: string): UploadIdentity {
  return {
    apiUrl: cfg.apiUrl,
    workspaceFallback: cfg.workspaceId,
    defaultActor: { kind: 'human', id: cfg.ownerUserId },
    authHeaders: { authorization: `Bearer ${token}`, 'x-nm-agent-scopes':'1' },
    logPrefix: '[machined] ',
  };
}

export function createMachineReplica(cfg: Pick<MachinedConfig, 'apiUrl' | 'workspaceId' | 'ownerUserId'>, o: MachineReplicaOptions): MachineReplica {
  const { db } = o;
  const log = o.log ?? ((line: string) => console.log(`[machined] ${line}`));
  const now = o.now ?? Date.now;
  const gap = o.refreshGapMs ?? 30_000;
  const owner = { kind: 'human', id: cfg.ownerUserId };
  let lastRefresh = Number.NEGATIVE_INFINITY;
  const pending = async (): Promise<number> => Number((await db.getAll<{ n: number }>('select count(*) as n from nm_outbox'))[0]?.n ?? 0);
  return {
    db,
    activate: () => db.activate(owner),
    connect: async () => {
      const hold = o.hold ?? loopHold;
      const handle = hold.start();
      // a replica closed before its first sync rejects the wait: that only ends the hold
      const release = (): void => hold.stop(handle);
      void db.waitForFirstSync().then(release, release);
      await db.connect({
        apiUrl: cfg.apiUrl,
        identity: async (forceRefresh) => {
          if (forceRefresh && o.refreshToken && now() - lastRefresh >= gap) {
            lastRefresh = now();
            log('replica: the feed refused the machine token, renewing it before the next pass');
            await o.refreshToken().catch((e: unknown) => log(`replica: token renewal failed: ${e instanceof Error ? e.message : String(e)}`));
          }
          return machineReplicaIdentity(cfg, o.token());
        },
        ...(o.beforeSync ? { beforeSync: o.beforeSync } : {}),
        ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
        ...(o.pollMs ? { pollMs: o.pollMs } : {}),
      });
    },
    syncedAfter: (sinceMs) => db.waitForStatus((s) => (s.lastSyncedAt?.getTime() ?? 0) > sinceMs),
    drainWrites: async (timeoutMs) => {
      const until = now() + timeoutMs;
      while ((await pending()) > 0) {
        if (now() >= until) throw new Error('the replica still holds queued writes');
        await db.syncNow().catch(() => {});
        if ((await pending()) === 0) return;
        await new Promise((r) => setTimeout(r, DRAIN_POLL_MS));
      }
    },
  };
}

/** machined's replica: the native SQLite driver on `stateDir/replica.sqlite`, and upstream's one-time
 *  import of a PowerSync-era `replica.db` before the first upload */
export async function openMachineReplica(cfg: MachinedConfig, o: { refreshToken?: () => Promise<unknown> } = {}): Promise<MachineReplica> {
  const { sqliteDriver, upgradeReplica } = await import('./sync/sqlite-driver');
  const nodeSqlite = process.env['NM_MACHINED_NODE_SQLITE'] === '1';
  console.log(`[machined] opening replica at ${cfg.stateDir}`);
  const db = new SQLiteReplica(sqliteDriver(join(cfg.stateDir, 'replica.sqlite'), { nodeSqlite }));
  const owner = { kind: 'human', id: cfg.ownerUserId };
  console.log(`[machined] replica feed: ${cfg.apiUrl}/v1/brain/replica`);
  return createMachineReplica(cfg, {
    db,
    token: () => cfg.machineToken,
    ...(o.refreshToken ? { refreshToken: o.refreshToken } : {}),
    beforeSync: () => upgradeReplica(db, join(cfg.stateDir, 'replica.db'), owner, nodeSqlite),
  });
}
