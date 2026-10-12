import { isEngineeringWorkPlan, type EngineeringWorkPlan } from './handoff';

export type EngineeringStepStatus = 'pending' | 'in_progress' | 'completed';
export interface EngineeringPlanProgress {
  id: string;
  plan: EngineeringWorkPlan;
  statuses: EngineeringStepStatus[];
  started: boolean;
}
const status = (value: unknown): value is EngineeringStepStatus => typeof value === 'string' && ['pending', 'in_progress', 'completed'].includes(value);
export function isEngineeringPlanProgress(value: unknown): value is EngineeringPlanProgress {
  if (!value || typeof value !== 'object') return false;
  const p = value as EngineeringPlanProgress;
  return typeof p.id === 'string' && p.id.length > 0 && p.id.length <= 200 && isEngineeringWorkPlan(p.plan)
    && typeof p.started === 'boolean' && Array.isArray(p.statuses) && p.statuses.length === p.plan.steps.length
    && p.statuses.every(status) && p.statuses.filter(s => s === 'in_progress').length <= 1
    && (p.started || p.statuses.every(s => s === 'pending'));
}
export function createEngineeringPlanProgress(plan: EngineeringWorkPlan, id: string): EngineeringPlanProgress {
  return { id, plan: JSON.parse(JSON.stringify(plan)) as EngineeringWorkPlan, statuses: plan.steps.map(() => 'pending'), started: false };
}

/** Explicit agent updates, never inferred from approved actions or a finished turn. Reopening a
 * completed step is allowed when verification reveals more work. Indices are one-based for models. */
export function updateEngineeringPlanProgress(progress: EngineeringPlanProgress, updates: unknown): EngineeringPlanProgress {
  if (!Array.isArray(updates) || !updates.length || updates.length > progress.statuses.length) throw new Error('Supply one or more plan step updates.');
  const statuses = [...progress.statuses];
  const seen = new Set<number>();
  for (const update of updates) {
    if (!update || !Number.isInteger(update.step) || update.step < 1 || update.step > statuses.length || seen.has(update.step) || !status(update.status)) throw new Error('Each update needs a unique existing step number and a valid status.');
    seen.add(update.step);
    statuses[update.step - 1] = update.status;
  }
  if (statuses.filter(s => s === 'in_progress').length > 1) throw new Error('Only one step can be in progress. Update the previous step in the same call.');
  return { ...progress, statuses, started: true };
}

/** Recover from successful tool receipts in the portable conversation, including older proposals.
 * A call without a recorded result, a failed result, or arbitrary assistant prose is not progress. */
export function recoverEngineeringPlanProgress(messages: unknown): EngineeringPlanProgress | null {
  if (!Array.isArray(messages)) return null;
  const calls = new Map<string, { name: string; input: unknown }>();
  let progress: EngineeringPlanProgress | null = null;
  for (const message of messages) {
    if (!Array.isArray(message?.content)) continue;
    for (const block of message.content) {
      if (message.role === 'assistant' && block?.type === 'tool_use') calls.set(block.id, block);
      if (block?.type !== 'tool_result' || block.is_error) continue;
      const call = calls.get(block.tool_use_id);
      if (!call || !['propose_work_plan', 'update_plan_progress'].includes(call.name)) continue;
      calls.delete(block.tool_use_id);
      let result: Record<string, unknown>;
      try { result = typeof block.content === 'string' ? JSON.parse(block.content) : block.content; } catch { continue; }
      if (!result || result.recorded !== true) continue;
      if (call.name === 'propose_work_plan' && isEngineeringWorkPlan(call.input)) {
        progress = isEngineeringPlanProgress(result.planProgress) ? result.planProgress : createEngineeringPlanProgress(call.input, block.tool_use_id);
      } else if (call.name === 'update_plan_progress' && isEngineeringPlanProgress(result.planProgress)
        && progress?.id === result.planProgress.id && JSON.stringify(progress.plan) === JSON.stringify(result.planProgress.plan)) {
        progress = result.planProgress;
      }
    }
  }
  return progress;
}

export const ENGINEERING_PLAN_PROGRESS_PROMPT = 'In Act mode, when executing a previously proposed work plan, use update_plan_progress before starting the first step and after each meaningful step. Use the original one-based step numbers. Mark a step completed only after its work actually succeeds; a requested approval is not completion, and a test step remains unfinished until the test result passes. Update the previous step and the next in_progress step together. Reopen a step if more work is needed. Keep steps pending when blocked or declined. Do not mark the whole plan completed merely because the turn is ending. Do not call this tool for an unrelated question or invent a plan to fill a progress indicator.';
