import type { ClineCore } from '@cline/sdk';
import { recoverEngineeringPlanProgress } from '@neuramesh/shared';
import type { EngineeringRuntimeEvent } from '../../engineering-protocol';
import type { EngineeringConversation } from './engineering-conversation';
import { readRuntimeMessages, restoreRuntimeCheckpoint } from './engineering-runtime-input';

export async function restoreEngineeringSession(o: {
  core: ClineCore | null; sessionId: string | null; busy: boolean; checkpointRunCount: number; cwd: string;
  start: Parameters<ClineCore['start']>[0]; conversation?: EngineeringConversation;
  metadata: () => Record<string, unknown>; running: (value: boolean) => void;
  emit: (event: EngineeringRuntimeEvent) => void; apply: (sessionId: string) => void; refresh: () => void; closed: () => boolean;
}): Promise<void> {
  if (!o.core || !o.sessionId || o.busy) {
    o.emit({ type: 'error', code: 'RESTORE_UNAVAILABLE', recoverable: true, message: 'A checkpoint can be restored only while this Engineering thread is idle.' }); return;
  }
  o.running(true); o.emit({ type: 'status', status: 'running' });
  try {
    const sessionId = await restoreRuntimeCheckpoint(o.core, o.sessionId, o.checkpointRunCount, o.cwd, o.start);
    o.apply(sessionId); o.emit({ type: 'restored', checkpointRunCount: o.checkpointRunCount });
    const progress = recoverEngineeringPlanProgress(await readRuntimeMessages(o.core, sessionId));
    o.conversation?.record('plan.restored', { checkpointRunCount: o.checkpointRunCount, progress });
    await o.conversation?.checkpoint(o.core, sessionId, o.metadata());
    o.emit({ type: 'plan_progress', progress }); o.refresh();
  } finally { o.running(false); if (!o.closed()) o.emit({ type: 'status', status: 'idle' }); }
}
