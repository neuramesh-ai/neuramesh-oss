// Generic judged-role runner: the candidate generates an answer, then the cross-family ensemble
// judge scores it against the role's rubric. Candidate cost is the per-task cost (what you'd pay
// to use the model for the role); judge cost is tracked separately as a benchmark expense.
import { CEILINGS, complete } from '../runtime';
import { judgeRubric, type RubricDim } from '../judge';
import { costUsd } from '../pricing';

export interface JudgedTask {
  id: string;
  prompt: string;
}

export interface JudgedRun {
  /** the model hit the output ceiling — a low score may be the budget, not the answer */
  truncated?: boolean;
  quality: number; // 0–100
  costUsd: number; // candidate cost per task
  latencyMs: number;
  judgeCostUsd: number;
  tokensIn: number; // candidate tokens (for exact recosting on pricing changes)
  tokensOut: number;
}

export const RESEARCH_SYSTEM =
  'You are a research analyst. Answer the question using ONLY the provided sources. Synthesise across them into a coherent answer, cite the specific sources you rely on by their id in square brackets (e.g. [S1]), and do not introduce facts that are not in the sources. If the sources are insufficient to answer fully, say so explicitly.';

export const ARCHITECT_SYSTEM =
  'You are a senior software architect. Produce a concrete, buildable implementation plan for the request. Output clean markdown with these sections: ## Approach, ## Steps (ordered), ## Risks & fallbacks, and ## Definition of Done (a short checklist of concrete, testable acceptance criteria). Be specific and technically grounded — real steps, no hand-waving or invented APIs.';

export async function runJudged(model: string, task: JudgedTask, system: string, dims: RubricDim[]): Promise<JudgedRun> {
  const started = Date.now();
  // Long-form answers after long thinking (CEILINGS, runtime.ts). A truncated answer is scored
  // low by the judge, correctly and for the wrong reason, which inverts the ranking.
  const gen = await complete(model, system, task.prompt, CEILINGS.judged);
  const latencyMs = Date.now() - started;
  const cand = costUsd(model, gen.tokensIn, gen.tokensOut);
  const j = await judgeRubric(model, task.prompt, gen.text || '(the model returned an empty answer)', dims);
  return { quality: j.overall, costUsd: cand, latencyMs, judgeCostUsd: j.judgeCostUsd, tokensIn: gen.tokensIn, tokensOut: gen.tokensOut , truncated: gen.truncated };
}
