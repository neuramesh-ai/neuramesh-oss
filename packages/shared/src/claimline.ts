// the claim line (2026-10-05): what a worker posts in a unit's thread the moment it claims the unit.
// one pure function, so the daemon (host/claimflow.ts) and the preview story say the same words and
// nobody keeps a copy. a person reads it, so it follows the house writing rules: no em dash, no
// semicolon, the simple present. no client parses it: the published desktops match no part of it.

/** the checks a worker runs when nobody gave it any and its own model wrote none (claimflow.ts) */
export const STATIC_CHECKLIST: readonly string[] = ['The title and the room give the scope', 'I am a member of this room', 'No open question stops the work'];
/** the checks of a unit whose plan the person approved with no checklist: approve_plan confirms the
 *  requirements and writes none (control-api handler/fsm.ts approvePlan), so the plan is the scope */
export const PLAN_CHECKLIST: readonly string[] = ['The approved plan gives the scope', 'I am a member of this room', 'No open question stops the work'];

/** where the checklist came from: the intake (the create or the offer carried it), the approved plan,
 *  the worker's own model, or the default above */
export type ChecklistSource = 'intake' | 'plan' | 'worker' | 'default';

/** where the work happens: a worktree on the unit's branch for a repository unit, a scratch folder
 *  otherwise. no path: the folder differs on each machine, and a cloud machine's means nothing to a person */
export function claimWorkspace(t: { repo: boolean; branch?: string | null }): string {
  if (!t.repo) return 'a scratch workspace. The files I make attach to this thread.';
  return t.branch
    ? `a worktree on branch \`${t.branch}\`. I push the branch before the review.`
    : 'a worktree of the repository. I push my branch before the review.';
}

export interface ClaimLineInput {
  number: number;
  title: string;
  checklist: readonly string[];
  source: ChecklistSource;
  estimate: string;
  /** claimWorkspace's words */
  workspace: string;
}

const CHECKLIST_LABEL: Record<ChecklistSource, string> = {
  intake: 'Checklist from the intake',
  worker: 'My checklist',
  plan: 'Checklist',
  default: 'Checklist',
};

export function claimLine(c: ClaimLineInput): string {
  return [
    `I claimed #${c.number} “${c.title}”. I start now, and the live run on this task shows what I do.`,
    `- **${CHECKLIST_LABEL[c.source]}:** ${c.checklist.join(' · ')}`,
    `- **Estimate:** ${c.estimate}`,
    `- **Workspace:** ${c.workspace}`,
  ].join('\n');
}
