// The judged roles: research and planning (generate, then score with the cross-family ensemble)
// and orchestration (structural score blended with the same ensemble). They live apart from the
// objective roles because they share the judge, its spend total, and one sample loop whose retry
// policy has to stay identical between them.
import { type CatalogModel } from './catalog';
import { ARCHITECT_RUBRIC, RESEARCH_RUBRIC } from './rubrics';
import { ARCHITECT_SYSTEM, RESEARCH_SYSTEM, runJudged, type JudgedTask } from './run/judged';
import { runOrchestration } from './run/orchestrator';
import { EmptyAnswerError, NoCredError, RefusalError, TruncationError } from './runtime';
import { recordSkip } from './skips';
import { suiteMissing } from './suite';
import { meanCI, median } from './stats';
import type { ModelRoleAggregate } from './types';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// The cross-family judge's cost. That is a BENCHMARK expense, not part of any model's per-task
// cost, which is why it is a module total and not a field on an aggregate — and why it leaves as a
// getter rather than an export (an imported binding cannot be reassigned).
let judgeSpend = 0;

// research + architect: candidate generates an answer, the cross-family ensemble judge scores it 0–100.
export async function judgedRole(roleId: 'research' | 'architect', models: CatalogModel[], runs: number, limit: number | undefined): Promise<ModelRoleAggregate[]> {
  const cfg = roleId === 'research'
    ? { file: 'research/tasks.json', system: RESEARCH_SYSTEM, dims: RESEARCH_RUBRIC }
    : { file: 'architect/tasks.json', system: ARCHITECT_SYSTEM, dims: ARCHITECT_RUBRIC };
  if (suiteMissing(roleId)) return [];
  const all = JSON.parse(readFileSync(resolve(HERE, '../suite/' + cfg.file), 'utf8')) as JudgedTask[];
  const tasks = limit ? all.slice(0, limit) : all;
  console.log(`${roleId}: ${tasks.length} tasks × ${runs} run(s) × ${models.length} model(s)  [cross-family ensemble judge]`);
  const aggs: ModelRoleAggregate[] = [];
  for (const m of models) {
    try {
      const scores: number[] = [];
      const lat: number[] = [];
      let candCost = 0;
      let count = 0;
      let tin = 0;
      let tout = 0;
      let refusals = 0;
      let truncations = 0;
      let emptyRetries = 0;
      let emptyAnswers = 0;
      for (const t of tasks) {
        for (let r = 0; r < runs; r++) {
          // One sample. A FORMAT failure (no text at all) is stochastic, so it is retried the way
          // the reviewer retries an unparseable verdict. An ability failure is not retried, and an
          // exhausted retry still scores zero, so nothing is rescued that should not be.
          let res: Awaited<ReturnType<typeof runJudged>> | null = null;
          let scored = false;
          for (let attempt = 0; attempt < 3 && !res && !scored; attempt++) {
            try {
              res = await runJudged(m.id, t, cfg.system, cfg.dims);
            } catch (e) {
              if (e instanceof NoCredError) throw e;
              if (e instanceof EmptyAnswerError) {
                if (attempt < 2) { emptyRetries++; continue; }
                emptyAnswers++; scores.push(0); count++; scored = true; break;
              }
              if (e instanceof TruncationError) { truncations++; scores.push(0); count++; scored = true; break; }
              if (e instanceof RefusalError) { refusals++; scores.push(0); count++; scored = true; break; }
              throw e;
            }
          }
          if (!res) continue;
          if (res.truncated) truncations++;
          scores.push(res.quality);
          lat.push(res.latencyMs);
          candCost += res.costUsd;
          judgeSpend += res.judgeCostUsd;
          tin += res.tokensIn;
          tout += res.tokensOut;
          count++;
        }
      }
      const ci = meanCI(scores);
      aggs.push({ model: m.id, runs, quality: ci.mean, ci: [ci.lo, ci.hi], primary: ci.mean, costUsd: candCost / (count || 1), latencyMs: median(lat), tokensIn: tin / (count || 1), tokensOut: tout / (count || 1), ...(refusals ? { refusals } : {}), ...(truncations ? { truncations } : {}), ...(emptyAnswers ? { emptyAnswers } : {}) });
      console.log(`  ${m.id.padEnd(24)} score=${ci.mean.toFixed(0)}/100  $${(candCost / (count || 1)).toFixed(4)}/task${refusals ? `  (${refusals} refused)` : ''}${truncations ? `  (${truncations} out of budget)` : ''}${emptyRetries ? `  (${emptyRetries} empty, retried)` : ''}${emptyAnswers ? `  (${emptyAnswers} NEVER answered)` : ''}`);
    } catch (e) {
      if (e instanceof NoCredError) throw e;
      recordSkip(m.id, roleId, e as Error);
    }
  }
  return aggs;
}

// orchestration: structured decomposition → 60% structural correctness + 40% ensemble judge.
export async function orchestratorRole(models: CatalogModel[], runs: number, limit: number | undefined): Promise<ModelRoleAggregate[]> {
  if (suiteMissing('orchestrator')) return [];
  const all = JSON.parse(readFileSync(resolve(HERE, '../suite/orchestrator/tasks.json'), 'utf8')) as JudgedTask[];
  const tasks = limit ? all.slice(0, limit) : all;
  console.log(`orchestrator: ${tasks.length} tasks × ${runs} run(s) × ${models.length} model(s)  [structural + ensemble judge]`);
  const aggs: ModelRoleAggregate[] = [];
  for (const m of models) {
    try {
      const scores: number[] = [];
      const lat: number[] = [];
      let candCost = 0;
      let count = 0;
      let tin = 0;
      let tout = 0;
      let refusals = 0;
      let truncations = 0;
      let emptyRetries = 0;
      let emptyAnswers = 0;
      for (const t of tasks) {
        for (let r = 0; r < runs; r++) {
          // One sample. A FORMAT failure (no text at all) is stochastic, so it is retried the way
          // the reviewer retries an unparseable verdict. An ability failure is not retried, and an
          // exhausted retry still scores zero, so nothing is rescued that should not be.
          let res: Awaited<ReturnType<typeof runOrchestration>> | null = null;
          let scored = false;
          for (let attempt = 0; attempt < 3 && !res && !scored; attempt++) {
            try {
              res = await runOrchestration(m.id, t);
            } catch (e) {
              if (e instanceof NoCredError) throw e;
              if (e instanceof EmptyAnswerError) {
                if (attempt < 2) { emptyRetries++; continue; }
                emptyAnswers++; scores.push(0); count++; scored = true; break;
              }
              if (e instanceof TruncationError) { truncations++; scores.push(0); count++; scored = true; break; }
              if (e instanceof RefusalError) { refusals++; scores.push(0); count++; scored = true; break; }
              throw e;
            }
          }
          if (!res) continue;
          if (res.truncated) truncations++;
          scores.push(res.quality);
          lat.push(res.latencyMs);
          candCost += res.costUsd;
          judgeSpend += res.judgeCostUsd;
          tin += res.tokensIn;
          tout += res.tokensOut;
          count++;
        }
      }
      const ci = meanCI(scores);
      aggs.push({ model: m.id, runs, quality: ci.mean, ci: [ci.lo, ci.hi], primary: ci.mean, costUsd: candCost / (count || 1), latencyMs: median(lat), tokensIn: tin / (count || 1), tokensOut: tout / (count || 1), ...(refusals ? { refusals } : {}), ...(truncations ? { truncations } : {}), ...(emptyAnswers ? { emptyAnswers } : {}) });
      console.log(`  ${m.id.padEnd(24)} score=${ci.mean.toFixed(0)}/100  $${(candCost / (count || 1)).toFixed(4)}/task${refusals ? `  (${refusals} refused)` : ''}${truncations ? `  (${truncations} out of budget)` : ''}${emptyRetries ? `  (${emptyRetries} empty, retried)` : ''}${emptyAnswers ? `  (${emptyAnswers} NEVER answered)` : ''}`);
    } catch (e) {
      if (e instanceof NoCredError) throw e;
      recordSkip(m.id, 'orchestrator', e as Error);
    }
  }
  return aggs;
}

/** the cross-family judge's total spend for this run — see the note above */
export const judgeSpendTotal = (): number => judgeSpend;
