import type { EngineeringSession } from './domain';

interface Closable { close(): void }

/** Keep active runs and approvals alive, but release historical thread transports before opening
 * another. This keeps navigation below the relay's active-session ceiling without interrupting work. */
export function closeInactiveEngineeringHandles<T extends Closable>(
  handles: Map<string, T>,
  sessions: readonly Pick<EngineeringSession, 'id' | 'state'>[],
  keepId: string | null,
): void {
  const states = new Map(sessions.map((session) => [session.id, session.state]));
  for (const [id, handle] of handles) {
    if (id === keepId || states.get(id) === 'streaming' || states.get(id) === 'awaiting_approval') continue;
    handles.delete(id);
    handle.close();
  }
}
