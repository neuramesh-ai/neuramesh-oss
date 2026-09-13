// Assemble measured per-(model,role) aggregates into the exact JSON shape the public page
// consumes (apps/web/src/benchmarks.v1.json). Winner logic encodes the plan's rule: the top
// score wins outright only if its CI clears the runner-up; otherwise the statistically-tied
// leaders break the tie on value (cheaper wins) — the same tension the packs encode.
//
// The meta block is the run's provenance: WHEN it ran, at WHICH commit, with WHICH judges and
// WHICH provider settings, and WHICH (model, role) pairs produced no row. A benchmark whose
// settings are not written down cannot be reproduced or argued with.
import { PACKS, PACK_ORDER, STARTER_MODEL, providerForModel, runtimeForModel, type Provider } from '@neuramesh/shared';
import { PRICING } from './pricing';
import { LABELS } from './labels';
import { JUDGES } from './judge';
import { PROVIDER_SETTINGS } from './runtime';
import type { ModelRoleAggregate, RoleId } from './types';
import type { SkipRecord } from './skips';

const ROLE_META: Record<RoleId, { label: string; blurb: string; grader: 'objective' | 'hybrid' | 'judge'; metricLabel: string; primaryFmt: 'pct' | 'ratio' | 'score'; extraMetric?: { key: string; label: string } }> = {
  developer: {
    label: 'Coding',
    blurb: 'Implement a real feature or bug fix in a repository. Hidden tests and a well-formed-edit check decide the result. This is the developer role core job.',
    grader: 'objective',
    metricLabel: 'Pass rate',
    primaryFmt: 'pct',
  },
  reviewer: {
    label: 'Code review',
    blurb: 'Judge a diff against its Definition of Done. Approve clean work. Request changes on planted defects and Definition of Done violations. The score is F1 with request-changes as the positive class.',
    grader: 'objective',
    metricLabel: 'F1',
    primaryFmt: 'ratio',
    extraMetric: { key: 'falseApprove', label: 'False-approve' },
  },
  research: {
    label: 'Research',
    blurb: 'Answer a grounded question from the provided sources only. Cite correctly and never invent a fact. A cross-family judge ensemble scores the answer 0 to 100 on an expert rubric.',
    grader: 'judge',
    metricLabel: 'Rubric',
    primaryFmt: 'score',
  },
  architect: {
    label: 'Planning',
    blurb: 'Turn a feature request into a buildable implementation plan with a testable Definition of Done. A cross-family judge ensemble scores the plan 0 to 100.',
    grader: 'judge',
    metricLabel: 'Rubric',
    primaryFmt: 'score',
  },
  orchestrator: {
    label: 'Orchestration',
    blurb: 'Break a request into the right board tasks, roles and dependencies. The score is 60% structural correctness (valid roles, a Definition of Done on every task, acyclic dependencies) and 40% a cross-family judge ensemble.',
    grader: 'hybrid',
    metricLabel: 'Score',
    primaryFmt: 'score',
  },
};

const PROVIDERS = {
  anthropic: { label: 'Anthropic', mark: 'claude' },
  openai: { label: 'OpenAI', mark: 'openai' },
  gemini: { label: 'Google', mark: 'gemini' },
} as const;

const METHODOLOGY = {
  contamination:
    "Every task is private and held out. The grading tests stay hidden from the model. Public benchmarks leak into training data. A 2026 analysis found that about a third of solved SWE-bench tasks had memorized solutions. Private tasks are the only real defense. The coding fixtures today are hard but classic, so we are replacing them with tasks derived from this repository's own work.",
  objective:
    "Two roles grade on hard evidence alone. Coding is scored by hidden fail-to-pass tests and a well-formed-edit check, the same gate the real submit flow enforces. Review is scored against a known verdict on a set that carries planted logic bugs, Definition of Done violations, and an ugly-but-correct trap that must be approved.",
  variance:
    'Each task runs many times. We report the mean with a Wilson 95% confidence interval, drawn as the whisker on every bar. One run is noise. The interval is the signal.',
  value:
    'Quality is only half of the decision. Every model also carries a measured cost per task and a wall-clock time, so the leaderboard doubles as a cost and quality map. Move the sliders on the scatter to weight quality, cost and speed your own way.',
  judge:
    "Research, planning and orchestration are scored by a judge ensemble, kept honest by construction. Judging is cross-family only, so a model is never graded by its own family. Two judges score every answer on an anchored 0 to 3 expert rubric through forced structured output. A judge that returns no scores is dropped instead of counted as zeros. Orchestration blends this with objective structural checks. It is the eval version of the server rule that nobody reviews their own work.",
  refusals:
    'A model that declines a task on policy grounds scores zero for that sample. We never re-run a declined task on a different model, because that would publish one model result under another model name. The refusal count rides each row.',
};

/**
 * The suite version. It moves when anything that changes a NUMBER changes: the fixtures, the
 * adapters, or the judge roster. Rows from two versions must never share a leaderboard, so the CLI
 * refuses to merge across it.
 * v1.1 (2026-09-07): v1 fixtures, structured-output adapters, audited prices, refreshed judges.
 */
export const SUITE_VERSION = 'v1.1';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

function perFamily(aggs: ModelRoleAggregate[]): Record<string, string> {
  const best: Partial<Record<Provider, { model: string; q: number }>> = {};
  for (const a of aggs) {
    const p = providerForModel(a.model);
    const cur = best[p];
    if (!cur || a.quality > cur.q) best[p] = { model: a.model, q: a.quality };
  }
  const out: Record<string, string> = {};
  for (const p of Object.keys(best) as Provider[]) out[p] = best[p]!.model;
  return out;
}

/**
 * Models that are measured and published but can never hold a WORKING seat, so they must not be
 * named the winner of a role. Two reasons, both product rules rather than measurement:
 *
 *  - the mini and lite tiers hold no working seat (founder rule, locked by a test in
 *    packages/shared/test/model-packs.test.ts). They sprint the bench and are not trusted for real
 *    work.
 *  - the starter model is the platform's house brain, not a choice a workspace makes.
 *
 * Without this the page contradicts the product. The 2026-09 run put gemini-3.5-flash-lite at a
 * tie on review (F1 1.00) and gpt-5.4-mini at the top of three more roles, so the value tiebreak
 * declared "X takes the code review seat" for four of five roles while every pack seated somebody
 * else. Their rows stay on the board, because the numbers are real and worth seeing.
 */
const SEAT_INELIGIBLE: ReadonlySet<string> = new Set(['gpt-5.4-mini', 'gemini-3.1-flash-lite', STARTER_MODEL]);

/** true when a model can actually take the role's seat in a pack */
export const seatEligible = (model: string): boolean => !SEAT_INELIGIBLE.has(model);

// winner = top quality whose CI-low ≥ runner-up quality; else the statistically-tied leaders
// (CIs overlapping the top) break the tie on value (cheapest, then higher quality). Only models
// that could actually TAKE the seat are considered.
export function pickWinner(all: ModelRoleAggregate[]): { model: string; note: string } {
  const sorted = all.filter((a) => seatEligible(a.model));
  const top = sorted[0];
  if (!top) return { model: '', note: '' };
  const label = (m: string): string => LABELS[m] ?? m;
  const runner = sorted[1];
  if (!runner) return { model: top.model, note: `${label(top.model)} leads the role.` };
  if (top.ci[0] >= runner.quality) {
    return { model: top.model, note: `${label(top.model)} wins with a clear margin. Its confidence interval sits above the runner-up.` };
  }
  // "Tied" = statistically indistinguishable from the top AND within a small quality margin, so a
  // much cheaper but clearly-worse model can't win on value alone when the CIs are wide.
  const MARGIN = 3;
  const tied = sorted.filter((a) => a.quality >= top.quality - MARGIN && a.ci[1] >= top.ci[0]);
  const w = [...tied].sort((a, b) => a.costUsd - b.costUsd || b.quality - a.quality)[0]!;
  if (w.model === top.model) return { model: top.model, note: `${label(top.model)} leads on quality and holds up on value.` };
  const note =
    top.quality === w.quality
      ? `${label(top.model)} and ${label(w.model)} tie on quality (${top.quality}). ${label(w.model)} wins on value, for the same result at a fraction of the cost.`
      : `${label(top.model)} leads on raw score. Within the confidence intervals ${label(w.model)} is statistically level, so value decides it at a fraction of the cost.`;
  return { model: w.model, note };
}

export function assembleReport(
  roleAggs: Partial<Record<RoleId, ModelRoleAggregate[]>>,
  opts: { runsPerTask: number; suiteSha: string; generatedAt: string; judgeSpendUsd?: number; skipped?: SkipRecord[] },
): unknown {
  const present = (Object.keys(roleAggs) as RoleId[]).filter((r) => (roleAggs[r]?.length ?? 0) > 0);
  const modelIds = [...new Set(present.flatMap((r) => roleAggs[r]!.map((a) => a.model)))];
  const models = modelIds.map((id) => ({
    id,
    label: LABELS[id] ?? id,
    provider: providerForModel(id),
    runtime: runtimeForModel(id),
    pricing: { inPer1M: PRICING[id]?.inPer1M ?? 0, outPer1M: PRICING[id]?.outPer1M ?? 0 },
  }));
  const roles = present.map((r) => {
    const meta = ROLE_META[r];
    const sorted = [...roleAggs[r]!].sort((a, b) => b.quality - a.quality);
    const leaderboard = sorted.map((a) => {
      const row: Record<string, unknown> = {
        model: a.model,
        quality: Math.round(a.quality),
        ci: [Math.round(a.ci[0]), Math.round(a.ci[1])],
        primary: round2(a.primary),
        costUsd: round4(a.costUsd),
        latencyMs: Math.round(a.latencyMs),
        runs: a.runs,
      };
      if (a.falseApprove !== undefined) row['falseApprove'] = round2(a.falseApprove);
      if (a.refusals !== undefined) row['refusals'] = a.refusals;
      if (a.truncations !== undefined) row['truncations'] = a.truncations;
      if (a.emptyAnswers !== undefined) row['emptyAnswers'] = a.emptyAnswers;
      // per-task mean tokens — lets a future pricing correction recompute costUsd exactly
      if (a.tokensIn !== undefined) row['tokensIn'] = Math.round(a.tokensIn);
      if (a.tokensOut !== undefined) row['tokensOut'] = Math.round(a.tokensOut);
      return row;
    });
    const winner = pickWinner(sorted);
    const role: Record<string, unknown> = {
      id: r,
      label: meta.label,
      blurb: meta.blurb,
      grader: meta.grader,
      metricLabel: meta.metricLabel,
      primaryFmt: meta.primaryFmt,
      leaderboard,
      winner: winner.model,
      winnerNote: winner.note,
      perFamily: perFamily(sorted),
    };
    if (meta.extraMetric) role['extraMetric'] = meta.extraMetric;
    return role;
  });
  // Every seat, straight from the live catalog. The old projection hard-coded four roles, so a
  // pack could gain a seat (or a whole pack could be added) and the public page would not know.
  const packs = PACK_ORDER.map((id) => ({
    id,
    label: PACKS[id]!.name,
    tagline: PACKS[id]!.tagline,
    roles: { ...PACKS[id]!.roles },
  }));
  const allRuns = present.flatMap((r) => roleAggs[r]!.map((a) => a.runs));
  return {
    meta: {
      version: SUITE_VERSION,
      status: 'measured',
      generatedAt: opts.generatedAt,
      suiteSha: opts.suiteSha,
      runsPerTask: allRuns.length ? Math.max(...allRuns) : opts.runsPerTask,
      judges: { ...JUDGES },
      judgeSpendUsd: round2(opts.judgeSpendUsd ?? 0),
      settings: { ...PROVIDER_SETTINGS },
      skipped: opts.skipped ?? [],
      disclaimer: 'Measured on private, held-out NeuraMesh tasks pinned to a fixed commit.',
    },
    providers: PROVIDERS,
    models,
    roles,
    packs,
    methodology: METHODOLOGY,
  };
}
