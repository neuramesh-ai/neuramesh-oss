// Plan + prompt-block builders — extracted from agents.ts (track B1).
import { composePrompt } from '@neuramesh/shared';
import { contractFor } from '../contracts';
import type { RuntimeAdapter } from '../runtime/adapter';
import type { ExecTask } from '../agents';

// drains the SDK stream to its final text; with `log`, also records each tool
// call / turn / result (actions + lifecycle depth — short inputs, not full
// file/bash bodies). Without `log` it's the plain drain (echo/untracked paths).
// `onTodos` (worker path only) receives the worker's native TodoWrite list each
// time it updates, so it can be mirrored as beats (docs/17).
/**
 * The instructions governing an agent ON THIS MACHINE — local file › synced baseline › shipped
 * contract (docs/design/agent-instructions-and-task-policy-2026-08 §B.1).
 *
 * Local-first: the file this machine's user wrote always wins, silently. `agents.brief` is the
 * synced baseline a fresh machine inherits, not an authority over one that has been configured.
 */
/** The DESIGNER's contract blocks (defaults/agents/designer.yaml) — the design turn's words. */
export function designBlocks(): Record<string, string> {
  return contractFor('iris', 'designer')?.prompt ?? {};
}

/** A block from the REVIEWER's contract (defaults/agents/reviewer.yaml) — the verdict turn. */
export function reviewBlock(key: string, vars: Record<string, string | undefined> = {}): string {
  return composePrompt(contractFor('reviewer', 'reviewer')?.prompt?.[key] ?? '', vars);
}


// The architect's MIXTURE OF AGENTS: a planner drafts, two adversarial critics
// with DISTINCT lenses attack it in parallel (correctness-vs-requirements /
// risk-&-operability — diversity beats two identical critics), then a synthesis
// pass folds the critique into the final plan.
//
// `study` (2026-07-29) is the planner's eyes. Without it the draft stage was a tool-less
// completion over a paragraph of text: on a design-gated task the architect knew the
// approved mockups only by FILENAME and had never opened the repo it was planning changes
// to. `study` runs that one stage READ-ONLY inside a workspace holding the real code and
// the real mockups. The critics and the synthesis stay tool-less — they judge the draft,
// and text is all they need — so the cost is one exploring turn, not three.
export async function buildImplementationPlan(
  adapter: RuntimeAdapter,
  model: string,
  token: string,
  brief: string,
  onPhase?: (summary: string) => void,
  study?: ((system: string, user: string) => Promise<string>) | null,
): Promise<string> {
  onPhase?.(study ? 'mixture-of-agents: planner studying the workspace + drafting the plan' : 'mixture-of-agents: planner drafting the implementation plan');
  const draftSystem = 'You are a staff engineer drafting an implementation plan. Research the best approach and the realistic options, state the constraints, and produce a concrete, ordered plan in markdown.';
  const draft = study
    ? await study(
        `${draftSystem}\n\nYou have READ-ONLY access to a workspace containing the code this plan targets and any approved design mockups. Open the files before you plan: read the approved mockups end to end (they are the visual contract), find the real modules, components, and tokens the change touches, and name actual paths in your plan. Never guess at a file you could have read. You cannot write, edit, or run commands here — only read.`,
        brief,
      ).catch(() => adapter.complete(draftSystem, brief, token, model, 2000))
    : await adapter.complete(draftSystem, brief, token, model, 2000);
  onPhase?.('mixture-of-agents: two adversarial critics reviewing (correctness · risk/operability)');
  const [critCorrect, critRisk] = await Promise.all([
    adapter.complete(
      'You are an adversarial reviewer. LENS: correctness & completeness vs the requirements. List concretely what the plan misses, gets wrong, or leaves ambiguous relative to what was asked. Be specific; no praise.',
      `Requirements & task:\n${brief}\n\nProposed plan:\n${draft}`,
      token, model, 1200,
    ),
    adapter.complete(
      'You are an adversarial reviewer. LENS: risk & operability. List concretely the failure modes, missing fallbacks, edge cases, rollout/rollback, performance and security the plan ignores. Be specific; no praise.',
      `Proposed plan:\n${draft}`,
      token, model, 1200,
    ),
  ]);
  onPhase?.('mixture-of-agents: synthesizing the final plan + Definition of Done');
  return adapter.complete(
    'You are the architect finalizing an implementation plan. Fold the two critiques into the draft and output the FINAL plan as clean markdown with sections: ## Approach, ## Steps (ordered), ## Risks & fallbacks, ## Validation, ## Definition of Done. Resolve the critiques concretely rather than restating them; keep it shippable. Make it scannable for a human reviewer: use GitHub alert callouts — `> [!IMPORTANT]` for assumptions the reviewer must confirm, `> [!NOTE]` for open questions you need answered, `> [!TIP]` for a key recommendation — and put any commands, schema, or code in fenced blocks tagged with their language.\n\nThe `## Definition of Done` section is the authoritative acceptance contract the reviewer gates on: a short bulleted checklist of concrete, checkable criteria (what must be true for this to be accepted — behavior, evidence, tests/build green). For code work that targets a repository, the delivery contract is a PULL REQUEST: state that the change is delivered as a pull request opened against the base branch with its CI checks passing, reviewed there, and merged only after approval — NEVER "commit/push directly to main." Keep it tight (3–7 bullets); it is the bar, not a restatement of the steps.',
    `Task & requirements:\n${brief}\n\nDraft plan:\n${draft}\n\nCritique — correctness:\n${critCorrect}\n\nCritique — risk & operability:\n${critRisk}`,
    token, model, 2500,
  );
}

// Pull the `## Definition of Done` section out of a synthesized plan so it can be
// stored as the task's authoritative acceptance contract. Captures the body from
// that heading until the next `## ` heading (or end), trimmed; '' if absent.
export function extractDefinitionOfDone(plan: string): string {
  const m = /##\s+Definition of Done[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i.exec(plan);
  return m ? m[1]!.trim() : '';
}

// Developer beats for the runtimes with no native todo the host can read (codex/gemini):
// a first-pass planning analysis (docs/17 §5). Before implementation, the SAME model that
// will do the work is asked to analyze the task and emit its ordered high-level plan; that
// plan is declared as beats up front (the human sees it before a line is edited) and
// injected into the run so the model executes exactly those steps. Claude uses its live
// TodoWrite→beats instead. Best-effort + pure-ish: a plan we can't parse just means no
// beats for that run (the flow is never disturbed). Returns 3–7 short steps, or [].
export async function generateBeatPlan(adapter: RuntimeAdapter, model: string, token: string, t: ExecTask): Promise<string[]> {
  let checklist: string[] = [];
  try { checklist = t.requirements ? (JSON.parse(t.requirements) as string[]) : []; } catch { /* legacy rows */ }
  try {
    const raw = await adapter.complete(
      'You are about to implement a coding task. Do a brief first-pass analysis and lay out the ordered, high-level plan of the steps you will take — the checklist a teammate could watch you work through (not micro-steps). Output ONLY a JSON array of 3 to 7 short imperative strings (≤80 chars each), e.g. ["Reproduce the failure","Add a failing test","Fix the handler","Verify the suite is green"]. No prose, no markdown fences — just the JSON array.',
      `Task #${t.number}: ${t.title}\n${checklist.length ? `Resolved requirements:\n${checklist.map((c) => `- ${c}`).join('\n')}` : '(no checklist)'}`,
      token, model, 500,
    );
    const arr = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.map((s) => String(s).trim().slice(0, 200)).filter(Boolean).slice(0, 7);
  } catch {
    return []; // no plan we can parse → this run simply shows no beats
  }
}
