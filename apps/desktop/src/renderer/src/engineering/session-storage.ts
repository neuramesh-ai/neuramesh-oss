import type { EngineeringRepo, EngineeringSession } from './domain';
import { persistableEngineeringSession, productizeStoredEngineeringSession } from './copy';

const LEGACY_ENGINEERING_STORE = 'nm:engineering:sessions:v2';
export const engineeringSessionStoreKey = (workspaceId: string) => `nm:engineering:sessions:v3:${workspaceId}`;
type EngineeringStorage = Pick<Storage, 'getItem' | 'setItem'>;
type StoredEnvelope = { version: 3; migrationComplete: true; sessions: EngineeringSession[] };
export type EngineeringPersistenceResult = 'full' | 'metadata' | 'failed';

const storedSession = (value: unknown): value is EngineeringSession => {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<EngineeringSession>;
  return typeof session.id === 'string' && typeof session.title === 'string'
    && Boolean(session.repo && typeof session.repo.id === 'string')
    && Array.isArray(session.messages) && Array.isArray(session.checkpoints)
    && Array.isArray(session.changes) && Array.isArray(session.proposedChanges);
};
const storedSessions = (value: unknown): EngineeringSession[] => Array.isArray(value)
  ? value.filter(storedSession).map(productizeStoredEngineeringSession)
  : [];
const storedEnvelope = (value: unknown): value is StoredEnvelope => Boolean(value && typeof value === 'object'
  && (value as Partial<StoredEnvelope>).version === 3
  && (value as Partial<StoredEnvelope>).migrationComplete === true
  && Array.isArray((value as Partial<StoredEnvelope>).sessions));
const inWorkspaceRepos = (session: EngineeringSession, repos: EngineeringRepo[]): boolean => repos.some((repo) => repo.id === session.repo.id);

export function engineeringSessionStorageReady(workspaceId: string, storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    const current = storage.getItem(engineeringSessionStoreKey(workspaceId));
    if (current === null) return false;
    const value = JSON.parse(current) as unknown;
    return storedEnvelope(value) || storedSessions(value).length > 0;
  } catch { return false; }
}

const metadataSession = (session: EngineeringSession): EngineeringSession => ({
  ...persistableEngineeringSession(session),
  messages: [],
  checkpoints: [],
  workPlan: null,
});

export function persistEngineeringSessions(workspaceId: string, sessions: EngineeringSession[], storage: EngineeringStorage = localStorage): EngineeringPersistenceResult {
  const key = engineeringSessionStoreKey(workspaceId);
  // Every window holds a snapshot of the workspace. Saving that snapshot must not delete
  // threads created in another window or roll a newer transcript back to an older revision.
  let existing: EngineeringSession[] = [];
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? 'null');
    existing = storedSessions(storedEnvelope(value) ? value.sessions : value);
  } catch { /* a malformed legacy cache must not prevent a fresh save */ }
  const merged = new Map(existing.map(session => [session.id, session]));
  for (const session of sessions) {
    const previous = merged.get(session.id);
    if (!previous || session.updatedAt > previous.updatedAt
      || (session.updatedAt === previous.updatedAt && session.messages.length >= previous.messages.length)) merged.set(session.id, session);
  }
  const rows = [...merged.values()];
  const save = (rows: EngineeringSession[]) => storage.setItem(key, JSON.stringify({ version: 3, migrationComplete: true, sessions: rows } satisfies StoredEnvelope));
  try {
    save(rows.map(persistableEngineeringSession));
    return 'full';
  } catch {
    try { save(rows.map(metadataSession)); return 'metadata'; }
    catch { return 'failed'; }
  }
}

/** Serialize the read/merge/write across browser windows. Chromium's Web Locks are also
 * available in the desktop renderer. Restricted contexts retain the merge-only fallback. */
export async function persistEngineeringSessionsLocked(workspaceId: string, sessions: EngineeringSession[], storage: EngineeringStorage = localStorage, locks: Pick<LockManager, 'request'> | undefined = globalThis.navigator?.locks): Promise<EngineeringPersistenceResult> {
  try {
    const save = () => persistEngineeringSessions(workspaceId, sessions, storage);
    return locks ? await locks.request(engineeringSessionStoreKey(workspaceId), save) : save();
  } catch { return 'failed'; }
}

export function loadEngineeringSessions(workspaceId: string, repos: EngineeringRepo[] = [], storage: EngineeringStorage = localStorage): EngineeringSession[] {
  try {
    const key = engineeringSessionStoreKey(workspaceId);
    const current = storage.getItem(key);
    if (current !== null) {
      const value = JSON.parse(current) as unknown;
      if (storedEnvelope(value)) return storedSessions(value.sessions);
      const sessions = storedSessions(value);
      if (sessions.length) return sessions;
    }
    if (!repos.length) return [];
    const legacy = JSON.parse(storage.getItem(LEGACY_ENGINEERING_STORE) ?? '[]') as unknown;
    const migrated = storedSessions(legacy).filter((session) => inWorkspaceRepos(session, repos));
    persistEngineeringSessions(workspaceId, migrated, storage);
    return migrated;
  } catch { return []; }
}
