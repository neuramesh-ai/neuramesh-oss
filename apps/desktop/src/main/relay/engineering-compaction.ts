import type { ClineCore, SessionCompactionState } from '@cline/sdk';
import { portableRuntimeMessages } from './engineering-runtime-input';
import type { EngineeringCommand, EngineeringRuntimeEvent } from '../../engineering-protocol';
import type { EngineeringConversation } from './engineering-conversation';

type Messages = Awaited<ReturnType<ClineCore['readMessages']>>;
export const ENGINEERING_COMPACTION = { enabled: true, strategy: 'basic' as const, preserveRecentTokens: 8000 };
export const COMPACT_RECEIPT = 'Compacted the working context. The complete conversation, tool results, approvals and files remain in this thread.';

export async function restoreEngineeringHistory(core: ClineCore, meta: { threadId: string; repoId: string; actorId: string }, messages?: Messages, state?: unknown) {
  if (messages?.length) return { messages, state };
  const prior = (await core.listHistory({ limit: 200, includeManifestFallback: true })).find(record =>
    record.metadata?.['neurameshThreadId'] === meta.threadId && record.metadata?.['repoId'] === meta.repoId && record.metadata?.['actorId'] === meta.actorId);
  return prior ? { messages: await core.readMessages(prior.sessionId).catch(() => undefined), state: await core.readSessionCompactionState?.(prior.sessionId).catch(() => undefined) } : { messages, state };
}

/** The projection is a cache over an exact journal prefix, never a replacement for the journal. */
export async function projectedEngineeringMessages(messages: Messages, saved: unknown): Promise<Messages> {
  if (!saved) return messages;
  const sdk = await import('@cline/sdk');
  const state = sdk.parseSessionCompactionState(saved);
  return state && sdk.projectSessionCompactionState(state, messages) || messages;
}

/** Provider handoffs normalize signatures and tool pairs; hash the normalized source again. */
export async function portableEngineeringCompaction(messages: Messages, saved: unknown, provider: string, model: string): Promise<SessionCompactionState | undefined> {
  const projected = await projectedEngineeringMessages(messages, saved);
  if (projected === messages) return undefined;
  const sdk = await import('@cline/sdk');
  return sdk.createSessionCompactionState({ sourceMessages: portableRuntimeMessages(messages, provider, model), compactedMessages: portableRuntimeMessages(projected, provider, model) });
}

export async function compactEngineeringMessages(messages: Messages, saved: unknown, provider: string, model: string, threadId: string): Promise<SessionCompactionState | undefined> {
  if (messages.length < 2) return undefined;
  const sdk = await import('@cline/sdk');
  const projected = await projectedEngineeringMessages(messages, saved);
  const compact = sdk.createContextCompactionPrepareTurn({ providerId: provider, modelId: model, compaction: ENGINEERING_COMPACTION }, { mode: 'manual', manualTargetRatio: 0.35 });
  const result = await compact?.({ agentId: threadId, conversationId: threadId, parentAgentId: null, iteration: 0, messages: projected, apiMessages: projected,
    abortSignal: new AbortController().signal, systemPrompt: '', tools: [], model: { id: model, provider } });
  if (!result || JSON.stringify(result.messages) === JSON.stringify(projected)) return undefined;
  return sdk.createSessionCompactionState({ sourceMessages: messages, compactedMessages: result.messages, conversationId: threadId });
}

export async function manualEngineeringCompact(o: {
  command: Extract<EngineeringCommand, { type: 'prompt' }>; threadId: string; provider: string; model: string;
  read: () => Promise<{ messages: Messages; state: unknown }>;
  replace: (messages: Messages, state: unknown) => Promise<void>;
  running: (value: boolean) => void; emit: (event: EngineeringRuntimeEvent) => void;
  conversation?: EngineeringConversation; metadata: () => Record<string, unknown>;
}): Promise<void> {
  if (o.command.attachments?.length) throw new Error('Send /compact on its own, without attachments.');
  o.running(true); o.emit({ type: 'status', status: 'running' });
  try {
    const previous = await o.read();
    const compacted = await compactEngineeringMessages(previous.messages, previous.state, o.provider, o.model, o.threadId);
    const state = compacted ?? previous.state;
    const receipt = compacted ? COMPACT_RECEIPT : 'This conversation is already compact. Its complete history is unchanged.';
    const messages: Messages = [...previous.messages, { role: 'user', content: [{ type: 'text', text: '/compact' }] }, { role: 'assistant', content: [{ type: 'text', text: receipt }] }];
    await o.replace(messages, state);
    o.conversation?.record('user.message', { ...o.metadata(), text: '/compact' });
    const event = { type: 'agent_event', payload: { sessionId: o.threadId, event: { type: 'content_end', contentType: 'text', text: receipt } } };
    o.conversation?.event(event as import('@cline/sdk').CoreSessionEvent); o.emit({ type: 'agent_event', event });
    await o.conversation?.checkpointMessages(messages, { ...o.metadata(), compactionState: state });
    o.emit({ type: 'ended', reason: 'completed' });
  } finally { o.running(false); o.emit({ type: 'status', status: 'idle' }); }
}
