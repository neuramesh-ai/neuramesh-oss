import { AppSchema, artifactUploadInput, isUnrecoverableUploadError, messageUploadInput } from '@neuramesh/client-core';
import { noteDroppedUpload } from './upload-trouble';
import { OPSqliteOpenFactory } from '@powersync/op-sqlite';
import { type AbstractPowerSyncDatabase, type PowerSyncBackendConnector, PowerSyncDatabase, UpdateType } from '@powersync/react-native';
import { api, refreshToken, type Session } from './auth';
import { POWERSYNC_URL } from './config';

// Backend connector: mint a fresh token for the sync stream, and upload queued
// local writes. Only message inserts (chat + card replies + the sends that birth a session) ride
// the queue — commands go direct via ControlApiClient, not the PowerSync queue.
class Connector implements PowerSyncBackendConnector {
  constructor(private readonly session: Session) {}

  async fetchCredentials() {
    const { token, expiresAt } = await refreshToken(this.session);
    // expiresAt lets the SDK refresh the ~10-min token BEFORE it lapses; without it the token
    // dies mid-stream → 401 → a 5s reconnect loop that flaps the banner and heats the device.
    return { endpoint: POWERSYNC_URL, token, ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}) };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const tx = await database.getNextCrudTransaction();
    if (!tx) return;
    for (const op of tx.crud) {
      // AN ATTACHMENT IS NOT A MESSAGE, and this loop only ever knew about messages: every other
      // table fell through to tx.complete(), which discards it. So a photo written locally entered
      // the queue, was skipped, and was thrown away — the row existed on the phone and nowhere else
      // (George, 2026-09-07, the first photo I sent from the composer). The desktop has posted
      // these to /v1/artifacts since chat attachments landed; this is the same call.
      if (op.table === 'artifacts' && op.op === UpdateType.PUT) {
        const input = artifactUploadInput(op.id, op.opData ?? {});
        // no message_id means a LIBRARY file, which rides artifact.create and a different ACL.
        // Posting it here would file it in the wrong place, so it is left alone deliberately.
        if (input) {
          try {
            await api.postArtifact(input);
          } catch (e) {
            if (!isUnrecoverableUploadError(e)) throw e;
            console.warn(`[nm] dropping unrecoverable upload (${op.table} ${op.id}):`, e instanceof Error ? e.message : e);
            noteDroppedUpload(e instanceof Error ? e.message : 'The server refused it.', String(input.name));
          }
        }
      }
      if (op.table === 'messages' && op.op === UpdateType.PUT) {
        try {
          // the birth columns ride along (docs/31 · docs/34 · 0134) — the shared mapping, so a
          // designation written on the phone reaches the server exactly as the desktop's does
          await api.postMessage(messageUploadInput(op.id, op.opData ?? {}));
        } catch (e) {
          // The queue is strictly ordered and the SDK retries a failed batch forever — one
          // permanently-rejected op (e.g. a message to a since-deleted channel) would wedge
          // it and every later message would silently never publish. A definitive 4xx can
          // never succeed on retry: drop that op and keep the queue moving. Transient
          // failures (network, 5xx, 401 mid-rotation) rethrow so the SDK retries.
          if (!isUnrecoverableUploadError(e)) throw e;
          console.warn(`[nm] dropping unrecoverable upload (${op.table} ${op.id}):`, e instanceof Error ? e.message : e);
          // and SAY SO: the dropped row is a local optimistic insert, so the next checkpoint takes
          // it away and the message vanishes in front of the person who typed it
          noteDroppedUpload(e instanceof Error ? e.message : 'The server refused it.', String((op.opData ?? {})['body'] ?? ''));
        }
      }
    }
    await tx.complete();
  }
}

let dbRef: PowerSyncDatabase | null = null;

export function getDb(): PowerSyncDatabase {
  if (!dbRef) {
    dbRef = new PowerSyncDatabase({
      schema: AppSchema,
      database: new OPSqliteOpenFactory({ dbFilename: 'neuramesh.db' }),
    });
  }
  return dbRef;
}

export async function connect(session: Session): Promise<PowerSyncDatabase> {
  const db = getDb();
  await db.connect(new Connector(session));
  return db;
}

// Sign-out WIPES the replica, not just the stream: the next identity must never read the last
// one's rows (privacy), and the arrival gate (S6) routes on `workspace_members` — a leftover
// membership would send a brand-new person past the wizard into someone else's workspace.
export async function disconnect(): Promise<void> {
  if (dbRef) await dbRef.disconnectAndClear();
}
