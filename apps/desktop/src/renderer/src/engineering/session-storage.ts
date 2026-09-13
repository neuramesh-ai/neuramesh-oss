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
  const save = (rows: EngineeringSession[]) => storage.setItem(key, JSON.stringify({ version: 3, migrationComplete: true, sessions: rows } satisfies StoredEnvelope));
  try {
    save(sessions.map(persistableEngineeringSession));
    return 'full';
  } catch {
    try { save(sessions.map(metadataSession)); return 'metadata'; }
    catch { return 'failed'; }
  }
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
