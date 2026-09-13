import type { EngineeringChange, EngineeringMessage, EngineeringSession } from './domain';

const restoredMessage = (label: string): EngineeringMessage => ({
  id: `msg-${globalThis.crypto.randomUUID()}`,
  role: 'tool',
  body: `Restored checkpoint · ${label}`,
  tone: 'success',
  createdAt: new Date().toISOString(),
});

export function restoreEngineeringCheckpoint(session: EngineeringSession, checkpointId: string): EngineeringSession {
  const checkpoint = session.checkpoints.find((item) => item.id === checkpointId);
  if (!checkpoint) return session;
  return {
    ...session,
    state: 'resumable',
    activeActivity: null,
    pendingModeHandoff: null,
    pendingApproval: null,
    proposedChanges: [],
    changes: checkpoint.changes.map((change) => ({ ...change })),
    workPlan: checkpoint.workPlan,
    messages: [...session.messages.slice(0, checkpoint.messageCount), restoredMessage(checkpoint.label)],
    updatedAt: new Date().toISOString(),
  };
}

export const combinedDiff = (changes: EngineeringChange[]): string => changes.map((change) => change.diff.trimEnd()).join('\n');
