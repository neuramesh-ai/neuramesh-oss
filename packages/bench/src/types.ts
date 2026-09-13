export type RoleId = 'developer' | 'reviewer' | 'orchestrator' | 'architect' | 'research';

/** One model's aggregate score in one role, before web-schema assembly. */
export interface ModelRoleAggregate {
  model: string;
  runs: number;
  /** bar length 0..100 (accuracy for reviewer, pass-rate for developer). */
  quality: number;
  /** Wilson 95% CI on quality, 0..100. */
  ci: [number, number];
  /** headline metric 0..1 (F1 for reviewer, pass-rate for developer). */
  primary: number;
  /** reviewer only: fraction of should-request-changes cases wrongly approved. */
  falseApprove?: number;
  /** mean $ per task. */
  costUsd: number;
  /** median wall-clock ms. */
  latencyMs: number;
  /** mean tokens per task (in/out) — lets a pricing correction recompute costUsd exactly
   * without re-running (the 2026-07-02 pricing audit required re-runs for lack of these). */
  tokensIn?: number;
  tokensOut?: number;
  /** samples the model declined on policy grounds (scored as a failure, never rescued onto
   * another model). Published so a low score that is really a refusal rate reads as one. */
  refusals?: number;
  /** samples the model could not finish inside the output ceiling. A non-zero count here means
   * the ceiling, not the model, may be deciding the score: raise CEILINGS and re-run. */
  truncations?: number;
  /** samples where the model never returned text, after retries. A format failure, not an ability
   * signal, but it still counts against the model — see EmptyAnswerError. */
  emptyAnswers?: number;
}
