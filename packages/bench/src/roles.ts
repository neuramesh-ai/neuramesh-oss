// THE OBJECTIVE ROLE RUNNERS — review and coding, the two roles graded on hard evidence alone.
// The judged roles live in roles-judged.ts and the run's skip ledger in skips.ts.
//
// Split out of cli.ts, which was an argument parser and a report writer wrapped around 174 lines
// of measurement.

import { type CatalogModel } from './catalog';
import { scoreReviews, type ReviewLabel } from './grade/reviewer';
import { costUsd } from './pricing';
import { listDevFixtures, runDeveloperTask } from './run/developer';
import { runReview, type ReviewCase } from './run/reviewer';
import { EmptyAnswerError, NoCredError, RefusalError, TruncationError } from './runtime';
import { recordSkip } from './skips';
import { median, wilson } from './stats';
import type { ModelRoleAggregate } from './types';
import { ReviewParseError } from '@neuramesh/shared';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suiteMissing } from './suite';

// the suite lives beside this file's package, not the caller's cwd
const HERE = dirname(fileURLToPath(import.meta.url));

export async function reviewerRole(models: CatalogModel[], runs: number, limit: number | undefined): Promise<ModelRoleAggregate[]> {
  if (suiteMissing('reviewer')) return [];
  const all = JSON.parse(readFileSync(resolve(HERE, '../suite/reviewer/cases.json'), 'utf8')) as ReviewCase[];
  const cases = limit ? all.slice(0, limit) : all;
  console.log(`reviewer: ${cases.length} cases × ${runs} run(s) × ${models.length} model(s)`);
  const aggs: ModelRoleAggregate[] = [];
  for (const m of models) {
    try {
      const results: { label: ReviewLabel; verdict: 'approve' | 'changes' }[] = [];
      const lat: number[] = [];
      let tin = 0;
      let tout = 0;
      let correct = 0;
      let formatFails = 0;
      let refusals = 0;
      let truncations = 0;
      for (const c of cases) {
        for (let r = 0; r < runs; r++) {
          let rr: Awaited<ReturnType<typeof runReview>> | null = null;
          let refused = false;
          for (let attempt = 0; attempt < 3 && !rr && !refused; attempt++) {
            try {
              rr = await runReview(m.id, c);
            } catch (e) {
              if (e instanceof NoCredError) throw e;
              if (e instanceof RefusalError) { refused = true; refusals++; break; } // policy decline: real, and not stochastic
              if (e instanceof TruncationError) { refused = true; truncations++; break; } // no budget left to answer in
              if (e instanceof ReviewParseError) continue; // stochastic format failure — retry
              throw e; // API / config error → skip this whole model
            }
          }
          if (!rr) {
            // never produced a usable verdict (retries exhausted, or the model declined) → the
            // reviewer failed this review; count it against the model as the wrong call for the
            // label, don't drop the sample.
            if (!refused) formatFails++;
            results.push({ label: c.label, verdict: c.label === 'changes' ? 'approve' : 'changes' });
            continue;
          }
          if (rr.truncated) truncations++;
          results.push({ label: c.label, verdict: rr.verdict });
          if (rr.verdict === c.label) correct++;
          lat.push(rr.latencyMs);
          tin += rr.tokensIn;
          tout += rr.tokensOut;
        }
      }
      const s = scoreReviews(results);
      const w = wilson(correct, results.length);
      const nCalls = cases.length * runs || 1;
      const perTaskCost = costUsd(m.id, tin, tout) / nCalls;
      aggs.push({
        model: m.id,
        runs,
        quality: s.accuracy * 100,
        ci: [w.lo * 100, w.hi * 100],
        primary: s.f1,
        falseApprove: s.falseApproveRate,
        costUsd: perTaskCost,
        latencyMs: median(lat),
        tokensIn: tin / nCalls,
        tokensOut: tout / nCalls,
        ...(refusals ? { refusals } : {}),
        ...(truncations ? { truncations } : {}),
      });
      console.log(`  ${m.id.padEnd(24)} F1=${s.f1.toFixed(2)}  acc=${(s.accuracy * 100).toFixed(0)}%  false-approve=${(s.falseApproveRate * 100).toFixed(0)}%  $${perTaskCost.toFixed(4)}/case${formatFails ? `  (${formatFails} format-fail)` : ''}${refusals ? `  (${refusals} refused)` : ''}${truncations ? `  (${truncations} out of budget)` : ''}`);
    } catch (e) {
      if (e instanceof NoCredError) throw e;
      recordSkip(m.id, 'reviewer', e as Error);
    }
  }
  return aggs;
}

export async function developerRole(models: CatalogModel[], runs: number, limit: number | undefined): Promise<ModelRoleAggregate[]> {
  if (suiteMissing('developer')) return [];
  const dir = resolve(HERE, '../suite/developer');
  const all = listDevFixtures(dir);
  const ids = limit ? all.slice(0, limit) : all;
  console.log(`developer: ${ids.length} tasks × ${runs} run(s) × ${models.length} model(s)`);
  const aggs: ModelRoleAggregate[] = [];
  for (const m of models) {
    try {
      let pass = 0;
      let total = 0;
      let refusals = 0;
      let truncations = 0;
      let emptyRetries = 0;
      let emptyAnswers = 0;
      const lat: number[] = [];
      let tin = 0;
      let tout = 0;
      for (const id of ids) {
        for (let r = 0; r < runs; r++) {
          let res: Awaited<ReturnType<typeof runDeveloperTask>> | null = null;
          let fatal: 'truncated' | 'refused' | 'empty' | null = null;
          // Same policy as the reviewer's verdict loop: a FORMAT failure is stochastic and gets
          // retried, an ability failure is not retried, and exhausted retries count against the
          // model. Without this, a model that answers with a malformed tool call half the time
          // reads as a model that cannot code.
          for (let attempt = 0; attempt < 3 && !res && !fatal; attempt++) {
            try {
              res = await runDeveloperTask(join(dir, id), m.id);
            } catch (e) {
              if (e instanceof NoCredError) throw e;
              if (e instanceof EmptyAnswerError) { emptyRetries++; continue; }
              if (e instanceof TruncationError) { fatal = 'truncated'; break; }
              if (e instanceof RefusalError) { fatal = 'refused'; break; }
              throw e;
            }
          }
          if (!res) {
            // never produced an answer: the model failed this task, and the reason rides the row
            if (fatal === 'truncated') truncations++;
            else if (fatal === 'refused') refusals++;
            else emptyAnswers++;
            total++;
            continue;
          }
          total++;
          if (res.passed) pass++;
          if (res.truncated) truncations++;
          lat.push(res.latencyMs);
          tin += res.tokensIn;
          tout += res.tokensOut;
        }
      }
      const w = wilson(pass, total);
      const rate = total ? pass / total : 0;
      const perTaskCost = costUsd(m.id, tin, tout) / (total || 1);
      aggs.push({ model: m.id, runs, quality: rate * 100, ci: [w.lo * 100, w.hi * 100], primary: rate, costUsd: perTaskCost, latencyMs: median(lat), tokensIn: tin / (total || 1), tokensOut: tout / (total || 1), ...(refusals ? { refusals } : {}), ...(truncations ? { truncations } : {}), ...(emptyAnswers ? { emptyAnswers } : {}) });
      console.log(`  ${m.id.padEnd(24)} pass=${(rate * 100).toFixed(0)}%  $${perTaskCost.toFixed(4)}/task${refusals ? `  (${refusals} refused)` : ''}${truncations ? `  (${truncations} out of budget)` : ''}${emptyRetries ? `  (${emptyRetries} empty, retried)` : ''}${emptyAnswers ? `  (${emptyAnswers} NEVER answered)` : ''}`);
    } catch (e) {
      if (e instanceof NoCredError) throw e;
      recordSkip(m.id, 'developer', e as Error);
    }
  }
  return aggs;
}
