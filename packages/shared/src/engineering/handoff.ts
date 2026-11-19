export interface EngineeringModeHandoff {
  category: 'edit' | 'command';
  toolName: string;
  prompt: string;
  createdAt: string;
  /** Older clients inferred handoffs from prose. Only typed proposals may show a gate. */
  actionable?: true;
}

export function engineeringModeHandoff(category: 'edit' | 'command', toolName: string): EngineeringModeHandoff {
  return {
    category,
    toolName,
    actionable: true,
    prompt: category === 'edit'
      ? 'Continue with the implementation in Act mode. Apply the planned changes and verify them.'
      : 'Continue in Act mode with the proposed command. Review its permissions before execution.',
    createdAt: new Date().toISOString(),
  };
}

export function canContinueEngineering(session: { mode: string; state: string; activeActivity?: unknown; pendingApproval?: unknown; pendingModeHandoff?: EngineeringModeHandoff | null }): boolean {
  return session.mode === 'plan' && session.state === 'completed' && !session.activeActivity && !session.pendingApproval
    && session.pendingModeHandoff?.actionable === true;
}

export interface EngineeringPlanReport { investigation: string; decisions: string[]; nextStep: string }
export function isEngineeringPlanReport(value: unknown): value is EngineeringPlanReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as EngineeringPlanReport;
  const line = (text: unknown, max: number): text is string => typeof text === 'string' && !!text.trim() && text.length <= max && !/[\r\n]/.test(text);
  return line(report.investigation, 600) && line(report.nextStep, 300)
    && Array.isArray(report.decisions) && report.decisions.length >= 1 && report.decisions.length <= 4
    && report.decisions.every((point) => line(point, 300));
}

export interface EngineeringWorkPlan { report?: EngineeringPlanReport; summary: string; keyPoints?: string[]; considerations?: string[]; steps: { label?: string; action: 'edit' | 'command'; target: string; description: string }[] }
export function isEngineeringWorkPlan(value: unknown): value is EngineeringWorkPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as EngineeringWorkPlan;
  const points = (value: unknown, min: number, max: number): boolean => value === undefined || (Array.isArray(value) && value.length >= min && value.length <= max && value.every((item) => typeof item === 'string' && !!item.trim() && item.length <= 600 && !/[\r\n]/.test(item)));
  return (plan.report === undefined || isEngineeringPlanReport(plan.report)) && points(plan.keyPoints, 1, 5) && points(plan.considerations, 0, 3) && typeof plan.summary === 'string' && !!plan.summary.trim() && plan.summary.length <= 8000
    && Array.isArray(plan.steps) && plan.steps.length > 0 && plan.steps.length <= 30
    && plan.steps.every((step) => step && (step.action === 'edit' || step.action === 'command')
      && (step.label === undefined || (typeof step.label === 'string' && !!step.label.trim() && step.label.length <= 100 && !/[\r\n]/.test(step.label)))
      && typeof step.target === 'string' && !!step.target.trim() && step.target.length <= 2000
      && typeof step.description === 'string' && !!step.description.trim() && step.description.length <= 2000);
}

/** WHAT IS WRONG WITH A REFUSED PLAN, in words a model can act on (the Cloud Run coding evals,
 *  2026-10-30: the starter model called propose_work_plan six times and heard the same one-line
 *  refusal each time, so it never learned which field to fix). The same rules as
 *  isEngineeringWorkPlan, one sentence per broken rule; empty exactly when that accepts the plan. */
export function engineeringWorkPlanProblems(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['the plan must be a JSON object'];
  const plan = value as Record<string, unknown>;
  const out: string[] = [];
  const line = (text: unknown, max: number): boolean => typeof text === 'string' && !!text.trim() && text.length <= max && !/[\r\n]/.test(text);
  const points = (field: string, min: number, max: number): void => {
    const v = plan[field];
    if (v === undefined) return;
    if (!Array.isArray(v) || v.length < min || v.length > max) out.push(`${field} must be an array of ${min} to ${max} strings`);
    else if (!v.every((item) => line(item, 600))) out.push(`every ${field} item must be a non-empty single-line string of at most 600 characters`);
  };
  if (typeof plan['summary'] !== 'string' || !plan['summary'].trim()) out.push('summary is missing: one or two plain sentences about the outcome');
  else if (plan['summary'].length > 8000) out.push('summary is longer than 8000 characters');
  if (plan['report'] !== undefined) {
    const r = plan['report'] as Record<string, unknown> | null;
    if (!r || typeof r !== 'object' || Array.isArray(r)) out.push('report must be an object with investigation, decisions and nextStep');
    else {
      if (!line(r['investigation'], 600)) out.push('report.investigation must be a non-empty single-line string of at most 600 characters');
      if (!line(r['nextStep'], 300)) out.push('report.nextStep must be a non-empty single-line string of at most 300 characters');
      const d = r['decisions'];
      if (!Array.isArray(d) || d.length < 1 || d.length > 4 || !d.every((x) => line(x, 300))) out.push('report.decisions must be an array of 1 to 4 non-empty single-line strings of at most 300 characters');
    }
  }
  points('keyPoints', 1, 5);
  points('considerations', 0, 3);
  const steps = plan['steps'];
  if (!Array.isArray(steps) || steps.length === 0) out.push('steps is missing: at least one step, each {label, action: "edit" or "command", target, description}');
  else if (steps.length > 30) out.push('steps has more than 30 items');
  else steps.forEach((raw, i) => {
    const step = raw as Record<string, unknown> | null;
    const n = `steps[${i}]`;
    if (!step || typeof step !== 'object') { out.push(`${n} must be an object`); return; }
    if (step['action'] !== 'edit' && step['action'] !== 'command') out.push(`${n}.action must be "edit" or "command", not ${JSON.stringify(step['action'] ?? null)}`);
    if (step['label'] !== undefined && !line(step['label'], 100)) out.push(`${n}.label must be a non-empty single-line string of at most 100 characters`);
    if (typeof step['target'] !== 'string' || !step['target'].trim()) out.push(`${n}.target is missing: the file path to edit or the command to run`);
    else if (step['target'].length > 2000) out.push(`${n}.target is longer than 2000 characters`);
    if (typeof step['description'] !== 'string' || !step['description'].trim()) out.push(`${n}.description is missing: what the step changes or checks`);
    else if (step['description'].length > 2000) out.push(`${n}.description is longer than 2000 characters`);
  });
  return out;
}
