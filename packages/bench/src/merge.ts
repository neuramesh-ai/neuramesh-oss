// Merging a partial run into an existing report. Lives apart from cli.ts because cli.ts RUNS on
// import (it is the entry point), so a test that wants this logic cannot reach it there.
//
// A full measurement is several invocations — the objective roles, then the judged ones — and each
// one rewrites the whole report. Everything here exists to keep that from quietly losing what an
// earlier invocation learned.
import { readFileSync } from 'node:fs';
import type { ModelRoleAggregate, RoleId } from './types';
import type { SkipRecord } from './skips';

export type PriorReport = {
  meta?: { version?: string; skipped?: SkipRecord[]; suiteSha?: string; generatedAt?: string; judgeSpendUsd?: number };
  roles?: { id: string; leaderboard: ModelRoleAggregate[] }[];
};

export function readPrior(outPath: string, version: string): PriorReport | null {
  try {
    const prev = JSON.parse(readFileSync(outPath, 'utf8')) as PriorReport;
    if (prev.meta?.version && prev.meta.version !== version) return null;
    return prev;
  } catch {
    return null;
  }
}

/**
 * A full measurement is several CLI invocations (the objective roles, then the judged ones), and
 * each one writes the whole report. So a model that produced no row in the FIRST invocation has to
 * survive into the last one's meta, or the finished artifact claims a completeness it does not
 * have. Prior skips are carried forward and then dropped for any pair that has since produced a
 * row, which is exactly what "this pair has no row" means.
 */
export function mergeSkips(prior: SkipRecord[], fresh: SkipRecord[], merged: Partial<Record<RoleId, ModelRoleAggregate[]>>): SkipRecord[] {
  const has = (s: SkipRecord): boolean => (merged[s.role] ?? []).some((a) => a.model === s.model);
  const out = new Map<string, SkipRecord>();
  for (const s of [...prior, ...fresh]) {
    if (has(s)) continue; // it measured after all
    out.set(`${s.model}:${s.role}`, s); // a fresh reason replaces a stale one
  }
  return [...out.values()];
}

export function priorAggregates(outPath: string, version: string): Partial<Record<RoleId, ModelRoleAggregate[]>> {
  try {
    const prev = JSON.parse(readFileSync(outPath, 'utf8')) as PriorReport;
    const prevVersion = prev.meta?.version;
    if (prevVersion && prevVersion !== version) {
      console.log(`  (existing report is suite ${prevVersion}, this run is ${version} — starting clean rather than mixing them)`);
      return {};
    }
    const out: Partial<Record<RoleId, ModelRoleAggregate[]>> = {};
    for (const role of prev.roles ?? []) {
      out[role.id as RoleId] = role.leaderboard.map((r) => ({
        model: r.model,
        runs: r.runs,
        quality: r.quality,
        ci: r.ci,
        primary: r.primary,
        ...(r.falseApprove !== undefined ? { falseApprove: r.falseApprove } : {}),
        costUsd: r.costUsd,
        latencyMs: r.latencyMs,
        ...(r.tokensIn !== undefined ? { tokensIn: r.tokensIn } : {}),
        ...(r.tokensOut !== undefined ? { tokensOut: r.tokensOut } : {}),
        ...(r.refusals !== undefined ? { refusals: r.refusals } : {}),
        ...(r.truncations !== undefined ? { truncations: r.truncations } : {}),
        ...(r.emptyAnswers !== undefined ? { emptyAnswers: r.emptyAnswers } : {}),
      }));
    }
    return out;
  } catch {
    return {};
  }
}

// Overlay this run's fresh (model, role) results onto the existing report so a partial run
// (one role / one model) merges rather than clobbering everything else.
export function mergeWithPrior(outPath: string, fresh: Partial<Record<RoleId, ModelRoleAggregate[]>>, version: string): Partial<Record<RoleId, ModelRoleAggregate[]>> {
  const prior = priorAggregates(outPath, version);
  const roles = new Set<RoleId>([...(Object.keys(prior) as RoleId[]), ...(Object.keys(fresh) as RoleId[])]);
  const merged: Partial<Record<RoleId, ModelRoleAggregate[]>> = {};
  for (const role of roles) {
    const byModel = new Map<string, ModelRoleAggregate>();
    for (const a of prior[role] ?? []) byModel.set(a.model, a);
    for (const a of fresh[role] ?? []) byModel.set(a.model, a); // fresh overrides prior
    merged[role] = [...byModel.values()];
  }
  return merged;
}
