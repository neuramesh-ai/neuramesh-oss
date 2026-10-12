import type { BrainThreadSnapshot } from '../brain-sync';
import type { EngineeringSession } from './domain';
import { isEngineeringWorkPlan } from './handoff';
import { applyRemoteEngineeringEvent, beginRemoteEngineeringPrompt } from './remote';
import { isEngineeringSelection } from './selection';
import { interruptReviews } from './review-history';
import { isEngineeringPlanProgress, recoverEngineeringPlanProgress, type EngineeringPlanProgress } from './plan-progress';

const object = (v: unknown): Record<string, any> => v && typeof v === 'object' ? v as Record<string, any> : {};

/** Events can reach the cloud before the next runtime checkpoint. Only successful tool
 * receipts after that checkpoint may advance (or explicitly reopen) its recorded plan. */
function progressAfterCheckpoint(snapshot: BrainThreadSnapshot, progress: EngineeringPlanProgress | null): EngineeringPlanProgress | null {
  const count = snapshot.metadata?.['recordedEventCount'];
  const start = typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= snapshot.events.length
    ? count : progress ? snapshot.events.length : 0;
  for (const record of snapshot.events.slice(start)) {
    if (record.type !== 'runtime.event') continue;
    const core = object(record.payload);
    if (core.type !== 'agent_event') continue;
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

/** Rebuild display state from committed events. Historical approvals are receipts, never live permissions. */
export function restoreEngineeringBrain(shell: EngineeringSession, snapshot: BrainThreadSnapshot): EngineeringSession {
  if (snapshot.threadId !== shell.id) throw new Error('The recorded conversation belongs to another thread.');
  if (snapshot.events.some(e => object(e.payload).brainEncoding === 'neuramesh.gzip.v1') || snapshot.runtimeMessages?.some(m => object(m).brainEncoding === 'neuramesh.gzip.v1')) throw new Error('Update the server to decode this recorded conversation, then retry.');
  // Opening an old thread with a new model can publish a metadata-only revision
  // before any transcript exists in GCS. That is not authority to erase its cache,
  // its Continue in Act offer or its error state. A live approval is never kept.
  const metadataOnly = !snapshot.runtimeMessages?.length && snapshot.events.every(event => event.type === 'model.change');
  let session: EngineeringSession = { ...shell,
    ...(metadataOnly ? {} : { messages: [], changes: [], checkpoints: [], workPlan: null, planProgress: null, pendingModeHandoff: null, state: 'resumable' as const }),
    pendingApproval: null, activeActivity: null };
  const plans = new Map<string, unknown>();
  const successful = new Set<string>();
  for (const message of snapshot.runtimeMessages ?? []) {
    const m = object(message);
    for (const block of Array.isArray(m.content) ? m.content : []) {
      if (block.type === 'tool_use' && block.name === 'propose_work_plan' && isEngineeringWorkPlan(block.input)) plans.set(block.id, block.input);
      if (block.type === 'tool_result' && !block.is_error) successful.add(block.tool_use_id);
    }
  }
  const reviews = new Map(snapshot.events.filter(e => e.type === 'review.proposed').map(e => { const p = object(e.payload); return [p.approvalId, p]; }));
  const renderedPlans = new Set<string>();
  for (const record of snapshot.events) {
    const before = new Set(session.messages.map(m => m.id));
    const p = object(record.payload);
    const apply = (wire: Record<string, unknown>) => { session = applyRemoteEngineeringEvent(session, wire); };
    if (record.type === 'user.message' && typeof p.text === 'string') {
      if (isEngineeringSelection(p.selection)) session = { ...session, agentId: p.selection.agentId, modelOverride: p.selection.modelId, reasoningEffort: p.selection.reasoningEffort };
      if (typeof p.agent?.name === 'string') session = { ...session, agent: p.agent };
      session = beginRemoteEngineeringPrompt({ ...session, state: 'resumable', mode: p.mode === 'act' ? 'act' : 'plan' }, p.text);
    } else if (record.type === 'runtime.event') {
      if (p.type === 'status') apply({ type: 'status', status: p.payload?.status });
      else if (p.type === 'ended') apply({ type: 'ended', reason: p.payload?.reason });
      else if (p.type === 'agent_event' || p.type === 'session_snapshot') {
        apply({ type: 'agent_event', event: p });
        const event = object(p.payload?.event);
        const call = event.toolCallId;
        if (event.type === 'content_end' && event.contentType === 'tool' && successful.has(call) && plans.has(call) && !renderedPlans.has(call)) {
          renderedPlans.add(call);
          apply({ type: 'work_plan', plan: plans.get(call), planId: call });
        }
      }
    } else if (record.type === 'tool.approval' && p.toolCallId && p.toolName) {
      const category = p.toolName === 'apply_patch' || p.toolName === 'editor' ? 'edit' : p.toolName === 'run_commands' ? 'command' : 'read';
      apply({ type: 'approval', approvalId: p.toolCallId, category, toolName: p.toolName, input: p.input, ...(reviews.get(p.toolCallId)?.changes ? { changes: reviews.get(p.toolCallId)!.changes } : {}) });
    } else if (record.type === 'approval.resolved') apply({ type: 'approval_resolved', ...p });
    // Replay is deterministic and keeps original timestamps. Later live events cannot collide.
    session = { ...session, messages: session.messages.map((m, i) => before.has(m.id) ? m : { ...m, id: `brain-${record.id}-${i}`, createdAt: record.timestamp }) };
  }
  const metadata = snapshot.metadata ?? {};
  if (isEngineeringSelection(metadata.selection)) session = { ...session, agentId: metadata.selection.agentId, modelOverride: metadata.selection.modelId, reasoningEffort: metadata.selection.reasoningEffort };
  if (typeof object(metadata.agent).name === 'string') session = { ...session, agent: metadata.agent as EngineeringSession['agent'] };
  const planProgress = progressAfterCheckpoint(snapshot, recoverEngineeringPlanProgress(snapshot.runtimeMessages));
  if (planProgress) session = applyRemoteEngineeringEvent(session, { type: 'plan_progress', progress: planProgress });
  const interrupted = session.state === 'streaming' || session.state === 'awaiting_approval';
  return { ...session, mode: metadata.mode === 'act' ? 'act' : session.mode,
    state: interrupted ? 'resumable' : session.state === 'error' ? 'error' : 'completed',
    activeActivity: null, pendingApproval: null, proposedChanges: [],
    pendingModeHandoff: metadata.mode === 'act' || interrupted ? null : session.pendingModeHandoff,
    messages: interruptReviews(session.messages).map(m => ({ ...m, streaming: false })),
    updatedAt: snapshot.events.at(-1)?.timestamp ?? shell.updatedAt };
}
