import type { BrainThreadSnapshot } from '../brain-sync';
import { isEngineeringPlanProgress, recoverEngineeringPlanReceipt, type EngineeringPlanProgress } from './plan-progress';

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' ? value as Record<string, any> : {};

/** Runtime checkpoints can omit older turns. Resume from their last actual plan receipt,
 * not their event count: that count only says when the snapshot was saved. Durable successful
 * receipts retain completion and explicit rework; a deliberate checkpoint restore is a reset. */
export function recoverRecordedEngineeringPlan(snapshot: Pick<BrainThreadSnapshot, 'events' | 'runtimeMessages' | 'metadata'>): EngineeringPlanProgress | null {
  const receipt = recoverEngineeringPlanReceipt(snapshot.runtimeMessages);
  let progress = receipt?.progress ?? null;
  const anchor = receipt ? snapshot.events.findIndex(record => {
    const core = object(record.payload), event = object(core.payload?.event);
    return record.type === 'runtime.event' && core.type === 'agent_event' && event.type === 'content_end'
      && event.contentType === 'tool' && !event.error && event.toolCallId === receipt.toolCallId;
  }) : -1;
  const count = snapshot.metadata?.['recordedEventCount'];
  const start = anchor >= 0 ? anchor + 1 : !progress ? 0 : typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= snapshot.events.length
    ? count : progress ? snapshot.events.length : 0;
  for (const record of snapshot.events.slice(start)) {
    const core = object(record.payload);
    if (record.type === 'plan.restored') {
      if (core.progress === null || isEngineeringPlanProgress(core.progress)) progress = core.progress;
      continue;
    }
    if (record.type !== 'runtime.event' || core.type !== 'agent_event') continue;
    const event = object(core.payload?.event);
    if (event.type !== 'content_end' || event.contentType !== 'tool' || event.error || typeof event.toolCallId !== 'string' || !event.toolCallId) continue;
    let output: Record<string, any>;
    try { output = object(typeof event.output === 'string' ? JSON.parse(event.output) : event.output); } catch { continue; }
    const next = output.planProgress;
    if (output.recorded !== true || !isEngineeringPlanProgress(next)) continue;
    if (event.toolName === 'propose_work_plan' && !next.started && progress?.id !== next.id) progress = next;
    else if (event.toolName === 'update_plan_progress' && progress?.id === next.id && JSON.stringify(progress.plan) === JSON.stringify(next.plan)) progress = next;
  }
  return progress;
}
