// Objective grading for the reviewer role: does the model's approve / request-changes verdict
// match a known ground-truth label? The positive class is 'changes' (a defect the reviewer must
// catch), so recall failures are missed defects — the dangerous error a review is meant to stop.
import type { ReviewVerdict } from '@neuramesh/shared';

export type ReviewLabel = 'approve' | 'changes';

export interface ReviewScore {
  n: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  /** fraction of should-request-changes cases the model wrongly approved (missed defects). */
  falseApproveRate: number;
}

export function scoreReviews(results: { label: ReviewLabel; verdict: ReviewVerdict }[]): ReviewScore {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const r of results) {
    const predictedPositive = r.verdict === 'changes';
    const actualPositive = r.label === 'changes';
    if (predictedPositive && actualPositive) tp++;
    else if (predictedPositive && !actualPositive) fp++;
    else if (!predictedPositive && !actualPositive) tn++;
    else fn++; // predicted approve, but should have requested changes → a missed defect
  }
  const n = results.length;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const accuracy = n === 0 ? 0 : (tp + tn) / n;
  const actualPositives = tp + fn;
  const falseApproveRate = actualPositives === 0 ? 0 : fn / actualPositives;
  return { n, tp, fp, tn, fn, precision, recall, f1, accuracy, falseApproveRate };
}
