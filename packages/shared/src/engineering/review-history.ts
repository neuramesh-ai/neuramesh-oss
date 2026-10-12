import type { EngineeringChange, EngineeringChangeReview, EngineeringMessage, EngineeringSession } from './domain';
import { normalizeEngineeringChanges } from './changes';

export function changeReviewMessage(id: string, changes: EngineeringChange[], status: EngineeringChangeReview['status'], createdAt: string): EngineeringMessage {
  const files = normalizeEngineeringChanges(changes).map((change) => ({ ...change }));
  return { id: `change-review-${id}`, role: 'assistant', kind: 'change_review', body: `${files.length} file${files.length === 1 ? '' : 's'} in this change set`, createdAt,
    review: { id, status, changes: files } };
}

/** Older clients kept only the current approval and aggregate diff. Recover what is known, without inventing earlier batches. */
export function engineeringReviewMessages(session: EngineeringSession): EngineeringMessage[] {
  let messages = session.messages;
  if (session.changes.length && !messages.some((m) => m.review)) {
    messages = [...messages, changeReviewMessage(`legacy-${session.id}`, session.changes, 'recorded', session.updatedAt)];
  }
  const approval = session.pendingApproval;
  if (approval?.changes?.length && !messages.some((m) => m.review?.id === approval.id)) {
    messages = [...messages, changeReviewMessage(approval.id, approval.changes, 'proposed', session.updatedAt)];
  }
  return messages;
}

export function updateReviewStatus(messages: EngineeringMessage[], id: string, status: EngineeringChangeReview['status']): EngineeringMessage[] {
  return messages.map((m) => m.review?.id === id && (m.review.status === 'proposed' || m.review.status === 'approved' || m.review.status === 'interrupted') ? { ...m, review: { ...m.review, status } } : m);
}

/** A dropped connection or ended turn does not prove whether a write happened. Keep that distinction in history. */
export function interruptReviews(messages: EngineeringMessage[]): EngineeringMessage[] {
  return messages.map((m) => m.review && (m.review.status === 'proposed' || m.review.status === 'approved')
    ? { ...m, review: { ...m.review, status: 'interrupted' } } : m);
}

export function finishChangeReview(session: EngineeringSession, failed: boolean, createdAt: string): EngineeringMessage[] {
  const messages = engineeringReviewMessages(session);
  const active = [...messages].reverse().find((m) => m.review?.status === 'approved' || m.review?.status === 'proposed');
  const status = failed ? 'failed' : 'applied';
  if (active?.review) return updateReviewStatus(messages, active.review.id, status);
  if (!session.proposedChanges.length) return messages;
  // Auto-approved edits have no approval event, but still get their own durable receipt.
  return [...messages, changeReviewMessage(`edit-${globalThis.crypto.randomUUID()}`, session.proposedChanges, status, createdAt)];
}
