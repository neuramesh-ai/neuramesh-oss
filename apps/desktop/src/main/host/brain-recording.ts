import { ConversationBrain, withConversationBrain, type BrainSyncOptions } from '../harness/brain-sync';
import type { QueuedWork } from '../harness/hostqueue';

interface Reader { getAll<T>(sql: string, args?: unknown[]): Promise<T[]> }
/** Every generic thread runtime shares this durable journal, regardless of its selected model. */
export function hostConversationRecorder(options: Omit<BrainSyncOptions, 'threadId'> & { db: Reader }): (work: QueuedWork, run: () => Promise<unknown>) => Promise<unknown> {
  const brains = new Map<string, ConversationBrain>();
  const loading = new Map<string, Promise<void>>();
  return async (work, run) => {
    let threadId: string | undefined;
    if (work.subject?.kind === 'thread') threadId = work.subject.id;
    if (work.subject?.kind === 'task') {
      const rows = await options.db.getAll<{ id: string }>('select th.id from threads th join tasks t on t.id = th.task_id where t.workspace_id = ? and t.number = ? limit 1', [options.workspace, work.subject.number]);
      threadId = rows[0]?.id;
    }
    if (!threadId) return run();
    let brain = brains.get(threadId);
    if (!brain) {
      brain = new ConversationBrain({ ...options, threadId });
      brains.set(threadId, brain);
      const ready = brain.hydrate();
      loading.set(threadId, ready);
      try { await ready; } finally { loading.delete(threadId); }
    } else if (loading.has(threadId)) {
      await loading.get(threadId);
    } else {
      await brain.flush();
      await brain.hydrate();
    }
    // Database messages are stable visible facts. Runtime events preserve everything beneath them.
    const messages = await options.db.getAll<{ id: string; body: string; author_kind: string; author_id: string; created_at: string }>(
      'select id, body, author_kind, author_id, created_at from messages where workspace_id = ? and thread_id = ? order by created_at, id', [options.workspace, threadId]);
    for (const message of messages) brain.record(message.author_kind === 'human' ? 'user.message' : 'assistant.message', { text: message.body, actorId: message.author_id, timestamp: message.created_at }, `message:${message.id}`);
    brain.record('turn.open', { turnId: work.key, agentId: work.agentId, kind: work.kind });
    return withConversationBrain(brain, async () => {
      try {
        const result = await run();
        brain.record('turn.settle', { turnId: work.key, state: 'done' });
        return result;
      } catch (error) {
        brain.record('turn.settle', { turnId: work.key, state: 'failed', error: error instanceof Error ? error.message : String(error) });
        throw error;
      } finally {
        // The local journal is durable even offline. A retry timer keeps its outbox live.
        await brain.flush().catch((error: unknown) => options.log?.(`brain_sync_pending: ${error instanceof Error ? error.message : 'upload failed'}`));
      }
    });
  };
}
