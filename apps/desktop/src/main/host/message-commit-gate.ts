import type { ReplicaDatabase } from '@neuramesh/client-core/replica';

/** Optimistic messages render immediately, but only authoritative messages may start a run. */
export function afterMessageSync<T extends { id: string }>(db: ReplicaDatabase, handle: (message: T) => void): (message: T) => void {
  return (message) => {
    if (db.waitForRowSync) {
      void db.waitForRowSync('messages', message.id).then((synced) => { if (synced) handle(message); });
    } else handle(message);
  };
}
