import type { EngineeringMessage, EngineeringSession } from './domain';
import { engineeringSystemText } from './copy';

/** A relay/upload failure is retryable, but it must always terminate live UI state. */
export function failRemoteEngineeringTransport(session: EngineeringSession, error: unknown): EngineeringSession {
  const detail = error instanceof Error ? error.message : String(error || 'The Code connection was interrupted.');
  const messages = session.messages.map((item) => item.streaming ? { ...item, streaming: false } : item);
  const warning: EngineeringMessage = {
    id: `transport-${Date.now().toString(36)}`, role: 'assistant', tone: 'warning', createdAt: new Date().toISOString(),
    body: engineeringSystemText(`${detail} Retry when the workspace connection is ready.`),
  };
  return { ...session, state: 'resumable', activeActivity: null, pendingApproval: null, messages: [...messages, warning], updatedAt: new Date().toISOString() };
}
