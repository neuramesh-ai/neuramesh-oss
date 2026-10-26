import type { EngineeringMessage, EngineeringSession } from './domain';
import { interruptReviews } from './review-history';
import { engineeringSystemText } from './copy';
import { interruptToolReceipts } from './tool-receipts';

/** A host that refuses every reconnect should leave one actionable warning, not a row per try. */
export const withEngineeringWarning = (messages: EngineeringMessage[], warning: EngineeringMessage): EngineeringMessage[] => {
  const last = messages.at(-1);
  return last?.role === 'assistant' && last.tone === 'warning' && last.kind === warning.kind && last.body === warning.body ? messages : [...messages, warning];
};

/** A relay/upload failure is retryable, but it must always terminate live UI state. */
export function failRemoteEngineeringTransport(session: EngineeringSession, error: unknown): EngineeringSession {
  const detail = error instanceof Error ? error.message : String(error || 'The Code connection was interrupted.');
  const messages = interruptToolReceipts(session.messages.map((item) => item.streaming ? { ...item, streaming: false } : item));
  const warning: EngineeringMessage = {
    id: `transport-${Date.now().toString(36)}`, role: 'assistant', tone: 'warning', createdAt: new Date().toISOString(),
    body: engineeringSystemText(`${detail} Retry when the workspace connection is ready.`),
  };
  return { ...session, state: 'resumable', activeActivity: null, pendingApproval: null, messages: [...interruptReviews(messages), warning], updatedAt: new Date().toISOString() };
}
