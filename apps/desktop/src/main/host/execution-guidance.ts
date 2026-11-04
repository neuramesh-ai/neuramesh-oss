import { UNBLOCK_MARKER } from '@neuramesh/shared';
import type { ReplicaDatabase } from '@neuramesh/client-core/replica';

/** Every execution, including recovery, receives the person's latest direction.
 * Unblock receipts are bookkeeping, not instructions; they must not crowd out a
 * real suggestion. Keep the failure separate from the human's guidance. */
export async function executionGuidance(db: Pick<ReplicaDatabase, 'getAll'>, taskId: string, parkNote = ''): Promise<string> {
  const messages = await db.getAll<{ body: string; author_kind: string }>(
    `select body,author_kind from messages where task_id = ? and
      ((author_kind = 'human' and body not like ?) or
       (author_kind = 'agent' and body like 'Auto-review of #%changes requested%'))
      order by created_at desc,id desc limit 4`, [taskId, `${UNBLOCK_MARKER}%`]);
  const [failure] = await db.getAll<{ body: string }>(
    `select body from messages where task_id = ? and author_kind = 'agent'
      and body like 'Execution hit a wall:%' order by created_at desc,id desc limit 1`, [taskId]);
  const bounded = (text: string, limit: number) => text.length > limit ? `${text.slice(0, limit)} […]` : text;
  return [
    parkNote,
    failure && `Previous execution failure:\n${bounded(failure.body, 600)}\nInspect the existing work and the failure before retrying. Adapt the approach using the latest human guidance; do not blindly repeat a failed action or bypass permissions.`,
    messages.length && `Latest task guidance (oldest to newest):\n${messages.reverse().map(message =>
      `${message.author_kind === 'human' ? 'Human' : 'Review feedback'}:\n${bounded(message.body, 1200)}`).join('\n\n')}\nUse this guidance with the approved task requirements. If it changes the approved scope or needs a new permission, explain what is needed; do not claim approval from a suggestion.`,
  ].filter(Boolean).join('\n\n');
}
