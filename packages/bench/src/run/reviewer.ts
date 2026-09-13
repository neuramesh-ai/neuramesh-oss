// Drive ONE reviewer verdict through a clean structured completion using the VERBATIM production
// reviewer prompt — read from defaults/agents/reviewer.yaml, the same file the daemon composes
// (../contracts) — never the host's fail-open path. parseReviewVerdict throws on an unparseable
// reply, so a garbled answer is surfaced as an error, not silently scored as an approve. That's
// the whole point: we measure the model's true precision/recall.
import { parseReviewVerdict, type ReviewVerdict } from '@neuramesh/shared';
import { benchReviewUserPrompt, reviewVerdictSystem } from '../contracts';
import { CEILINGS, completeJson } from '../runtime';
import type { ReviewLabel } from '../grade/reviewer';

// Force the verdict shape via each provider's structured-output path, so a model is scored on its
// review — not on whether it happens to emit clean JSON.
export const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'changes'] },
    reason: { type: 'string' },
  },
  required: ['verdict', 'reason'],
  additionalProperties: false,
} as const;

export interface ReviewCase {
  id: string;
  definitionOfDone: string;
  checklist?: string[];
  diff: string;
  ciStatus?: 'pass' | 'fail' | 'pending' | 'none';
  artifacts?: { kind: string; name: string }[];
  workerSummary: string;
  /** ground truth: what a correct reviewer should return. */
  label: ReviewLabel;
  /** what defect / violation is planted (documentation only; not shown to the model). */
  planted?: string;
}

export interface ReviewRun {
  /** the model hit the output ceiling — its verdict may be a budget artifact, not a judgement */
  truncated?: boolean;
  verdict: ReviewVerdict;
  reason: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
}

function ciText(s: 'pass' | 'fail' | 'pending' | 'none'): string {
  return s === 'pass' ? 'PR CI is green.' : s === 'fail' ? 'PR CI is failing (a required check is red).' : s === 'pending' ? 'PR CI is still running.' : 'no CI configured.';
}

export async function runReview(model: string, c: ReviewCase): Promise<ReviewRun> {
  const ciNote = c.ciStatus ? `\n\nSystem CI gate: ${ciText(c.ciStatus)}` : '';
  const user = benchReviewUserPrompt({
    definitionOfDone: c.definitionOfDone,
    checklist: c.checklist,
    ciNote,
    repoBinding: 'bound; pushed (benchmark fixture)',
    artifacts: c.artifacts ?? [],
    workerSummary: `${c.workerSummary}\n\n--- DIFF UNDER REVIEW ---\n${c.diff}`,
  });
  const started = Date.now();
  // The ceiling is generous on purpose (CEILINGS, runtime.ts): the parser recovers a verdict from
  // a truncated reason, but nothing is recoverable when thinking eats the budget before the
  // verdict field is written.
  const r = await completeJson(model, reviewVerdictSystem(), user, VERDICT_SCHEMA, CEILINGS.reviewer);
  const latencyMs = Date.now() - started;
  const { verdict, reason } = parseReviewVerdict(r.text); // throws on unparseable — NO fail-open
  return { verdict, reason, latencyMs, tokensIn: r.tokensIn, tokensOut: r.tokensOut , truncated: r.truncated };
}
