import { PowerSyncDatabase } from '@powersync/node';
import { AppSchema } from '@neuramesh/client-core/schema';
import { uploadCrudEntry, type UploadIdentity } from '@neuramesh/client-core/crud-upload';
import { LocalReplica, pendingPowerSyncWrites } from './local-replica';

export function powerSyncReplica(path: string): PowerSyncDatabase {
  return new PowerSyncDatabase({
    schema: AppSchema,
    // better-sqlite3 (electron-rebuilt): the node:sqlite implementation wedges
    // checkpoint application after the first upload (probe-isolated 2026-06-11).
    database: { dbFilename: path.split('/').pop()!, dbLocation: path.slice(0, path.lastIndexOf('/')) },
  });
}


/** Drain an old Local queue through validated commands, keeping its cache for rollback. */
export async function connectLocalReplica(target: LocalReplica, legacyPath: string, apiUrl: string, identity: () => Promise<UploadIdentity>): Promise<void> {
  let migrated = false;
  const beforeSync = async () => {
    if (migrated) return;
    if (pendingPowerSyncWrites(legacyPath)) {
      const legacy = powerSyncReplica(legacyPath);
      try {
        await legacy.waitForReady();
        const ident = await identity();
        let transaction;
        while ((transaction = await legacy.getNextCrudTransaction()) !== null) {
          for (const operation of transaction.crud) {
            if (await uploadCrudEntry(ident, operation) === 'unhandled') throw new Error(`Cannot migrate pending ${operation.table} ${operation.op}`);
          }
          await transaction.complete();
        }
      } finally { await legacy.close(); }
    }
    migrated = true;
  };
  await target.connect({ apiUrl, identity, beforeSync });
}
