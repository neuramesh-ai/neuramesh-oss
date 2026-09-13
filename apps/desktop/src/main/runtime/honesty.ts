// Enforced honesty guards for the agent loop (NeuraMesh non-negotiable #4: illegal states
// must be impossible, not discouraged). An agent with no resolvable credential must never
//   (a) fake a deliverable via the echo stub, nor
//   (b) auto-approve unreviewed work.
// These are pure predicates so the invariants are unit-testable in isolation from the
// agent host (which is otherwise un-mockable). Used by executeFlow / reviewFlow in agents.ts.

export interface EchoGuardInputs {
  /** resolved exec mode: 'echo' means no usable credential (or the dev gate is on). */
  mode: 'echo' | 'claude';
  /** NM_AGENT_MODE==='echo' — the explicit, dev-only "everything echoes" gate. */
  globalEchoGate: boolean;
}

/**
 * Block-instead-of-echo: whenever we'd otherwise emit the echo STUB (a fake RESULT that
 * looks like real work), block the task instead — UNLESS the explicit dev gate is on.
 * Applies to EVERY runtime including claude-code, which previously kept a silent echo
 * fallback (the misleading-dogfooding bug this guard closes).
 */
export function shouldBlockEcho({ mode, globalEchoGate }: EchoGuardInputs): boolean {
  return mode === 'echo' && !globalEchoGate;
}

export interface ReviewGuardInputs {
  /** resolved credential mode for the reviewer: 'subscription' | 'apikey' | 'none'. */
  authMode: string;
  /** a Definition of Done or intake checklist exists, i.e. there IS something to review. */
  hasReviewCriteria: boolean;
  /** NM_AGENT_MODE==='echo' — the dev-only gate. */
  globalEchoGate: boolean;
}

/**
 * Hold-instead-of-approve: when there are acceptance criteria to review against but no live
 * credential to run the semantic review, HOLD the task in_review rather than letting the
 * review fall open to task.approve (which would accept UNREVIEWED work). Closes the
 * fail-open hole: approval requires a live review whenever there's a contract to check.
 * A task with no criteria has nothing to semantically review, so it is left to the
 * structural gate (unchanged) — this guard does not fire for it.
 */
export function shouldHoldReview({ authMode, hasReviewCriteria, globalEchoGate }: ReviewGuardInputs): boolean {
  return authMode === 'none' && hasReviewCriteria && !globalEchoGate;
}

// ── "still waiting on my background agents" is not a deliverable (docs/29) ─────────────────
//
// `executeFlow` treats runQuery RETURNING as work-complete and submits. But a model can end
// its turn believing it left work running — subagents, a "scheduled check-in", a background
// job — none of which NeuraMesh models for a worker: a worker's turn IS its execution. Live
// dogfood, #1032: the worker's final words were "Waiting for the background research agents
// to complete (or the scheduled check-in) before proceeding to synthesis", and that sentence
// became result.md, submitted for review while its orphaned searches were still running.
//
// Same failure as the orchestrator's "I'll report back" (docs/29 §1), one path over. There the
// cure is a run that really outlives the turn; here the worker has no such mechanism, so the
// cure is: don't accept the claim as a result.
//
// Deliberately NARROW. It must fire on "I am not finished", never on a finished report that
// happens to discuss background jobs, waiting, or scheduling as its SUBJECT — a false positive
// blocks completed work, which is worse than the bug. So it requires a first-person present
// claim of pending work, and only in the summary's own voice.
const PENDING_WORK_PATTERNS: readonly RegExp[] = [
  // "Waiting for the background research agents to complete…" — SENTENCE-INITIAL, because that
  // is the summary speaking in its own voice about itself. Anchoring is what keeps a finished
  // report that merely NARRATES waiting out of it ("Fixed the race: the watcher was waiting on a
  // promise…" — a real false positive this anchor was added to kill). The waited-on thing must
  // also be agent work: "Waiting for your approval" is a legitimate end state, not an unfinished turn.
  /(?:^|[.!?]\s+|\n)\s*(?:still\s+)?(?:waiting|blocked)\s+(?:for|on)\s+(?:the\s+|my\s+|these\s+|those\s+)?[^.\n]{0,50}?\b(?:agents?|subagents?|sub-agents?|background\s+\w+|research|searches|queries|check-?ins?)\b/i,
  // "the parallel searches are still running", "my subagents are in flight". Nouns are limited to
  // the clearly-agentic ones — "task"/"job"/"run"/"process" appear constantly in finished reports
  // about code ("verified the job is still running after restart") and would fire on them.
  /\b(?:my\s+|the\s+)?(?:background|parallel|research|sub-?)?\s?(?:agents?|subagents?|searches|queries|research)\b[^.\n]{0,40}\b(?:are|is)\s+(?:still\s+)?(?:running|in flight|in progress|working|pending|underway)\b/i,
  // "I'll report back / post the results once they finish"
  /\bI(?:'| a|’)?ll\s+(?:report|post|share|follow up|update|come back)\b[^.\n]{0,50}\b(?:when|once|after|as soon as)\b/i,
  // "once they complete I will proceed to synthesis"
  /\b(?:once|when)\s+(?:they|those|these|it|the\s+[^.\n]{0,30})\s+(?:complete|finish|land|return|come back)[^.\n]{0,40}\bI\b/i,
];

/**
 * Does this worker summary claim work is STILL RUNNING somewhere else? If so it is a status
 * note, not a deliverable, and must not be submitted for review.
 *
 * Pure so the (deliberately narrow) matching is unit-testable — see honesty.test.ts, which
 * pins both the real #1032 sentence and the false positives it must not catch.
 */
export function claimsPendingWork(summary: string | null | undefined): boolean {
  const s = (summary ?? '').trim();
  if (!s) return false;
  return PENDING_WORK_PATTERNS.some((re) => re.test(s));
}

/**
 * The nudge injected for the ONE retry: the worker has no background mechanism, so it must
 * finish inside this turn or report what it actually has.
 */
export const FINISH_NOW_NOTE =
  'Your previous turn ended by saying work was still running somewhere else (background agents, a scheduled check-in, or similar). ' +
  'That mechanism does not exist for you: YOUR TURN IS THE EXECUTION — nothing you start survives it, and nothing will call you back. ' +
  'Finish the work now, in this turn, using what you can gather here. If some part genuinely cannot be completed, deliver everything you DO have ' +
  'and state plainly which part is missing and why. Do not end this turn waiting on anything.';
