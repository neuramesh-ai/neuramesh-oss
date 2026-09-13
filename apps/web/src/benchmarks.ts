// Typed loader for the model-benchmarks page. The data lives in benchmarks.v1.json —
// the artifact the harness (packages/bench) writes — so refreshing numbers is a JSON
// swap, no code change. Kept dependency-free (no zod on the marketing site): plain TS
// types + a trust-boundary cast, since the harness validates the shape on write.
import raw from './benchmarks.v1.json';

export type ProviderId = 'anthropic' | 'openai' | 'gemini';
export type MarkId = 'claude' | 'openai' | 'gemini';
export type GraderKind = 'objective' | 'hybrid' | 'judge';

export interface BenchModel {
  id: string;
  label: string;
  provider: ProviderId;
  runtime: string;
  pricing: { inPer1M: number; outPer1M: number };
}
export interface LeaderRow {
  model: string;
  quality: number; // 0..100, field-normalized role quality
  ci: [number, number]; // Wilson 95% interval on quality
  primary: number; // headline metric (pass-rate 0..1 or F1 0..1)
  falseApprove?: number; // reviewer only
  costUsd: number; // $ per task
  latencyMs: number; // wall-clock p50
  runs: number;
  refusals?: number; // samples the model declined on policy grounds (scored as failures)
  truncations?: number; // samples that hit the output ceiling
  emptyAnswers?: number; // samples that returned no text at all, after retries — a FORMAT failure
                         // that still counts as a failure, so a score carrying these is held down
                         // by the shape of the answer and not only by the work
  artifact?: string; // path to the raw run bundle
}
export interface BenchRole {
  id: string;
  label: string;
  blurb: string;
  grader: GraderKind;
  metricLabel: string;
  primaryFmt: 'pct' | 'ratio' | 'score';
  extraMetric?: { key: string; label: string };
  leaderboard: LeaderRow[];
  winner: string;
  winnerNote?: string;
  perFamily: Record<ProviderId, string>;
}
export interface BenchPack {
  id: string;
  label: string;
  tagline: string;
  roles: Record<string, string>;
}
export interface BenchData {
  meta: {
    version: string;
    status: 'preview' | 'measured';
    generatedAt: string;
    suiteSha: string;
    runsPerTask: number;
    /** the cross-family judge roster this run used. Frozen inside a suite version, because
     * changing a judge re-grades every candidate of the other two families. */
    judges?: Record<ProviderId, string>;
    judgeSpendUsd?: number;
    /** what every model was asked to do, per provider — a run whose settings are not written
     * down cannot be reproduced or argued with. */
    settings?: Record<ProviderId, string>;
    /** (model, role) pairs that produced no row. An empty list is the claim that the board is
     * complete; a non-empty one is why it is not. */
    skipped?: { model: string; role: string; reason: string }[];
    disclaimer: string;
  };
  providers: Record<ProviderId, { label: string; mark: MarkId }>;
  models: BenchModel[];
  roles: BenchRole[];
  packs: BenchPack[];
  methodology: Record<string, string>;
}

export const DATA = raw as unknown as BenchData;

/** model id → model meta (for cards, colors, pricing). */
export const MODELS: Record<string, BenchModel> = Object.fromEntries(DATA.models.map((m) => [m.id, m]));

/** Categorical brand hue per provider, drawn from the Ember Weave tokens (both themes). */
export function providerColor(p: ProviderId): string {
  return p === 'anthropic' ? 'var(--accent)' : p === 'openai' ? 'var(--violet)' : 'var(--blue)';
}
export function providerSoft(p: ProviderId): string {
  return p === 'anthropic' ? 'var(--accent-soft)' : p === 'openai' ? 'var(--violet-soft)' : 'var(--blue-soft)';
}
export function modelColor(id: string): string {
  const m = MODELS[id];
  return m ? providerColor(m.provider) : 'var(--muted)';
}

export interface ValueWeights {
  quality: number;
  cost: number;
  speed: number;
}
export const DEFAULT_WEIGHTS: ValueWeights = { quality: 0.6, cost: 0.25, speed: 0.15 };

// Min–max normalize a field to 0..1 across the current field; invert when lower is better.
function norm(vals: number[], v: number, invert: boolean): number {
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (max === min) return 1;
  const t = (v - min) / (max - min);
  return invert ? 1 - t : t;
}

/** Blend quality (↑), cost (↓), speed (↓) into a 0..100 value score per the given weights. */
export function computeValues(rows: LeaderRow[], w: ValueWeights): Record<string, number> {
  const q = rows.map((r) => r.quality);
  const c = rows.map((r) => r.costUsd);
  const s = rows.map((r) => r.latencyMs);
  const total = w.quality + w.cost + w.speed || 1;
  const out: Record<string, number> = {};
  for (const r of rows) {
    const v =
      (w.quality * norm(q, r.quality, false) +
        w.cost * norm(c, r.costUsd, true) +
        w.speed * norm(s, r.latencyMs, true)) /
      total;
    out[r.model] = Math.round(v * 100);
  }
  return out;
}

export const fmtUsd = (n: number): string => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(n < 0.1 ? 3 : 2)}`);
export const fmtLatency = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s` : `${ms}ms`;
export const fmtPrimary = (row: LeaderRow, role: BenchRole): string =>
  role.primaryFmt === 'pct' ? `${Math.round(row.primary * 100)}%` : role.primaryFmt === 'score' ? `${Math.round(row.primary)}` : row.primary.toFixed(2);
