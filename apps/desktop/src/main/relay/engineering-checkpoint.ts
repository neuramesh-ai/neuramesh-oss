import type { ClineCore } from '@cline/sdk';
import type { EngineeringRuntimeEvent } from '../../engineering-protocol';
import type { EngineeringConversation } from './engineering-conversation';

export function checkpointEngineering(core: ClineCore | null, conversation: EngineeringConversation | undefined, sessionId: string | undefined,
  metadata: Record<string, unknown>, log: (line: string) => void, emit: (event: EngineeringRuntimeEvent) => void, isClosed: () => boolean): void {
  if (!core || !conversation || !sessionId) return;
  void conversation.checkpoint(core, sessionId, metadata).catch((error: unknown) => {
    log(`brain_checkpoint_pending: ${error instanceof Error ? error.message : 'upload failed'}`);
    if (!isClosed()) emit({ type: 'error', code: 'BRAIN_SYNC_PENDING', recoverable: true, message: 'This turn is saved on this device. Cloud sync needs a retry before another device can continue.' });
  });
}

export async function shutdownEngineering(core: ClineCore | null, sessionId: string | null, conversation: EngineeringConversation | undefined,
  metadata: Record<string, unknown>, log: (line: string) => void): Promise<void> {
  if (!core) return;
  if (sessionId) await core.stop(sessionId).catch(() => {});
  if (sessionId && conversation) await conversation.checkpoint(core, sessionId, metadata).catch((error: unknown) => log(`brain_checkpoint_pending: ${error instanceof Error ? error.message : 'upload failed'}`));
  await conversation?.close().catch((error: unknown) => log(`brain_close_pending: ${error instanceof Error ? error.message : 'upload failed'}`));
  await core.dispose('Neuramesh relay channel closed').catch(() => {});
}
