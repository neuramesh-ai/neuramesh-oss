// LLM-as-judge, kept honest. Each answer is scored by TWO judges from DIFFERENT model families
// than the candidate (a model never grades its own family — the anti-self-enhancement guard),
// via structured output on an anchored 0–3 rubric, and the per-dimension scores are averaged.
import { providerForModel, type Provider } from '@neuramesh/shared';
import { CEILINGS, completeJson } from './runtime';
import { costUsd } from './pricing';

/**
 * The strong judge per family. Two of these grade every answer (the two NOT of the candidate's
 * family). The roster is FROZEN within a suite version: changing a judge re-grades every candidate
 * of the other two families, so a mixed report would compare numbers that were never comparable.
 * Refreshed 2026-09-07 for suite v1.1 (was opus-4-8 / gpt-5.5 / gemini-3.5-flash) because all three
 * predecessors are superseded. The report records this roster in meta.judges.
 */
export const JUDGES: Record<Provider, string> = {
  anthropic: 'claude-opus-5',
  openai: 'gpt-5.6-sol',
  gemini: 'gemini-3.8-flash',
};

export interface RubricDim {
  key: string;
  label: string;
  guide: string;
}

export interface JudgeResult {
  dims: Record<string, number>; // averaged 0–3 per dimension
  overall: number; // 0–100
  judges: string[];
  judgeCostUsd: number;
}

const JUDGE_SYSTEM =
  'You are a strict, fair, calibrated expert grader. Score the submission on each rubric dimension as an integer from 0 to 3 (0 = absent/wrong, 1 = weak, 2 = solid, 3 = excellent). Be critical; reserve 3 for genuinely excellent work and do not inflate. Judge only what is present. Output ONLY the JSON object of scores.';

/**
 * The rubric as a schema every provider accepts. The 0-3 range lives in the DESCRIPTION and in the
 * system prompt, not in `minimum`/`maximum`: Anthropic's structured outputs reject numeric bounds
 * on an integer, and the 2026-09 pre-flight caught that as a 400 from the Anthropic judge — which
 * silently meant every OpenAI and Gemini candidate lost its judged rows, since those are exactly
 * the candidates the Anthropic judge grades. `clamp03` enforces the range on the way back in.
 *
 * Keep this schema to the intersection of what all three providers accept. See
 * `schema.test.ts` for the keywords that are banned and why.
 */
export function rubricSchema(dims: RubricDim[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const d of dims) props[d.key] = { type: 'integer', description: `${d.label}: an integer from 0 to 3.` };
  return { type: 'object', properties: props, required: dims.map((d) => d.key), additionalProperties: false };
}

function clamp03(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(3, v));
}

export type JudgeComplete = (model: string, system: string, user: string, schema: Record<string, unknown>, maxTokens?: number) => Promise<{ text: string; tokensIn: number; tokensOut: number }>;

/** Score one candidate answer with the two cross-family judges; returns the averaged rubric. */
export async function judgeRubric(candidateModel: string, task: string, answer: string, dims: RubricDim[], judge: JudgeComplete = completeJson): Promise<JudgeResult> {
  const candFamily = providerForModel(candidateModel);
  const judges = (Object.keys(JUDGES) as Provider[]).filter((p) => p !== candFamily).map((p) => JUDGES[p]);
  const schema = rubricSchema(dims);
  const rubricText = dims.map((d) => `- ${d.key} (${d.label}): ${d.guide}`).join('\n');
  const user = `TASK GIVEN TO THE MODEL:\n${task}\n\nMODEL'S SUBMISSION:\n${answer.slice(0, 9000)}\n\nRUBRIC — score each dimension 0-3:\n${rubricText}`;

  const perJudge: Record<string, number>[] = [];
  let judgeCost = 0;
  for (const jm of judges) {
    // CEILINGS.judge (runtime.ts). A thinking judge reasons before it emits the score object, and
    // a judge that returns nothing is DROPPED — so a tight ceiling here silently changes who grades.
    const r = await judge(jm, JUDGE_SYSTEM, user, schema, CEILINGS.judge);
    judgeCost += costUsd(jm, r.tokensIn, r.tokensOut);
    let scores: Record<string, unknown> = {};
    try {
      scores = JSON.parse(r.text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as Record<string, unknown>;
    } catch {
      /* unparseable */
    }
    // Only count a judge that actually returned numeric scores. NEVER let an empty/failed judge
    // drag the average down with zeros — that silently biases against every candidate it grades.
    if (dims.some((d) => typeof scores[d.key] === 'number')) {
      perJudge.push(Object.fromEntries(dims.map((d) => [d.key, clamp03(scores[d.key])])));
    }
  }

  const dimsOut: Record<string, number> = {};
  for (const d of dims) {
    const vals = perJudge.map((s) => s[d.key] ?? 0);
    dimsOut[d.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }
  const sum = Object.values(dimsOut).reduce((a, b) => a + b, 0);
  const overall = (sum / (3 * dims.length || 1)) * 100;
  return { dims: dimsOut, overall, judges, judgeCostUsd: judgeCost };
}
