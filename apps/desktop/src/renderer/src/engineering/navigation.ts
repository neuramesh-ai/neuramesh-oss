import type { TaskAllRow } from '../bridge/rows-board';
import type { HistoryRow } from '../room-tabs';
import type { EngineeringSession } from './domain';

const plain = (text: string) => text
  .replace(/[`*_>#-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const clip = (text: string, max = 100) => text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Engineering work participates in the workspace's resting All threads rail even though the
 * execution transcript is owned by the Engineering runtime rather than a room message feed.
 * Null channel/task identities are deliberate: a row routes by `engineeringSessionId` and is
 * visible at the rail's All-projects scope without pretending to belong to a room.
 */
export function engineeringHistoryRows(sessions: EngineeringSession[]): Array<HistoryRow<TaskAllRow>> {
  return sessions
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((session) => {
      const latest = session.messages.slice().reverse().find((message) => message.role !== 'tool');
      return {
        branch: session.repo.branch,
        key: `engineering:${session.id}`,
        threadId: null,
        channelId: null,
        channelSlug: '',
        task: null,
        title: session.title,
        snip: clip(plain(latest?.body ?? '')),
        when: session.updatedAt,
        state: null,
        engineeringSessionId: session.id,
        engineeringRepo: session.repo.name,
        engineeringMode: session.mode,
        engineeringState: session.state,
      };
    });
}

/**
 * A rail selection is a navigation request, not a durable owner of the active session. Once the
 * request has been applied it must not run again merely because the local session collection
 * changed (for example, when the user creates a new thread from the active conversation).
 */
export function engineeringSessionForRequest(
  sessions: EngineeringSession[],
  requestedId: string | null,
  appliedId: string | null,
): EngineeringSession | null {
  if (!requestedId || requestedId === appliedId) return null;
  return sessions.find((session) => session.id === requestedId) ?? null;
}
