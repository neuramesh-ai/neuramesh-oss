// the GitHub card's Needs-you row (docs/design/repo-connect-2026-10). a card a TOOL posts
// (`needCard` on /v1/messages) waits on its person the way an auth card does: the thread reads
// Needs you, the bell counts it, and the phone gets a push. it refuses free text (allowOther
// false), because a sentence is not a grant: only the resume answers it, when GitHub connects
// for the project (github-resume.ts). a block an agent types itself still renders, since a
// published desktop's run_playbook posts it without the flag, but it mints nothing.
import { needDecisionQuestion, parseNeed } from '@neuramesh/shared';

export interface NeedDecision { id: ReturnType<typeof crypto.randomUUID>; question: string; options: never[]; allowOther: boolean }

export function needDecision(body: string, fromTool: boolean): NeedDecision | null {
  const need = fromTool ? parseNeed(body) : null;
  const question = need ? needDecisionQuestion(need) : null;
  return question ? { id: crypto.randomUUID(), question, options: [], allowOther: false } : null;
}
