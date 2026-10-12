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
