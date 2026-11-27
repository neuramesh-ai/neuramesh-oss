// HOW AN INTAKE DECISION READS (round 9). One reader for every place that shows or passes on the
// decision stored on threads.intake (shared/intake.ts): the plan line in the thread (hq), the
// orchestrator's turn context and the coding runtime's first instruction (desktop). Pure, so the
// person and the agents read the same plan.
import type { IntakeDecision } from './intake';

export interface IntakePlanView {
  /** the steps, in order, plain words */
  steps: string[];
  /** "Workspace: scratch" or "Workspace: repo owner/name". Null when the ask needs no workspace */
  workspace: string | null;
  /** "Subtasks: Design the page (designer) · Build it (developer)". Null when one agent does it all */
  subtasks: string | null;
}

const clean = (s: unknown, max: number): string =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** The plan line a person sees under the first message. `repoLabel` names the repository of a repo workspace. */
export function intakePlanView(d: IntakeDecision, repoLabel?: string | null): IntakePlanView {
  const steps = (Array.isArray(d.plan) ? d.plan : []).map((s) => clean(s, 160)).filter(Boolean).slice(0, 6);
  const workspace = d.workspace === 'scratch'
    ? 'Workspace: scratch'
    : d.workspace === 'repo'
      ? `Workspace: repo${repoLabel ? ` ${repoLabel}` : ''}`
      : null;
  const subs = (Array.isArray(d.subtasks) ? d.subtasks : [])
    .map((s) => {
      const title = clean(s?.title, 120);
      const role = clean(s?.role, 40);
      return title ? `${title}${role ? ` (${role})` : ''}` : '';
    })
    .filter(Boolean)
    .slice(0, 6);
  return { steps, workspace, subtasks: subs.length >= 2 ? `Subtasks: ${subs.join(' · ')}` : null };
}

/**
 * The decision as context for the agent that does the work: the orchestrator's turn, and the coding
 * runtime's instructions. Short, and it says that the plan is a starting point, not an order to skip
 * what the person asks next.
 */
export function intakeBrief(d: IntakeDecision, repoLabel?: string | null): string {
  const view = intakePlanView(d, repoLabel);
  const lines = [
    `Intake (decided on the first message): kind ${d.kind}${typeof d.confidence === 'number' ? `, confidence ${d.confidence.toFixed(2)}` : ''}${view.workspace ? `, ${view.workspace.toLowerCase()}` : ''}.`,
    ...(view.steps.length ? ['Plan of action:', ...view.steps.map((s, i) => `${i + 1}. ${s}`)] : []),
    ...(view.subtasks ? [view.subtasks] : []),
    'The person sees this plan in the thread. Follow it unless the request says otherwise, and say when you change it.',
    ...(d.workspace === 'scratch' ? [
      'This is a fresh, empty scratch workspace with no existing project files, and the thread title and intake plan are already set. Do not call set_thread_title or update_plan_progress, and do not run shell commands (such as ls or git status) to inspect the empty workspace. First write one short progress sentence and use the editor tool directly to create the requested file (such as index.html), then write a second short progress sentence and save a deliverable copy in .nm-artifacts/index.html.',
    ] : []),
  ];
  return lines.join('\n');
}
