// Wall policy: what happens when a task's execution ends with no submittable work.
// Pure (the replypolicy idiom) so the retry-vs-block budget and the exact thread
// copy are unit-testable without the host. The invariant this encodes: an agent
// NEVER strands a task silently — every wall either retries in-session or blocks
// the task with the reason, so the board and Mission Control always tell the truth.
export type WallOutcome =
  | { action: 'retry'; attempt: number; wallNote: string }
  | { action: 'block'; blockReason: string; wallNote: string; blockNote: string };

// ── Capacity failover (docs/22): classify WHY a turn walled ──────────────────────────────
// The runtimes surface refusals, rate limits, spend caps, and quota errors only as message TEXT (no
// typed status reaches this seam), so we match on the durable phrases each provider uses. Phrase sets
// and ORDER are tuned against real Anthropic / OpenAI-codex / Gemini strings (see execpolicy.test.ts);
// order is load-bearing — the checks run top to bottom and the first hit wins:
//   'refusal'   — the model DECLINED (fable-5 stop_reason 'refusal', or "I can't help with…"). It
//                 re-refuses on retry and must never read as a cap, so it's checked FIRST and the
//                 caller hands it to a human — never a retry, never a failover card.
//   'transient' — a per-WINDOW throttle (per-minute/second RPM/TPM) OR an overload (429 · 5xx ·
//                 "overloaded"). Retry-able. The per-window guard runs before the cap set because
//                 Gemini says "quota exceeded" for a 60-second throttle too — that is NOT a cap.
//   'exhausted' — a hard usage/spend/quota/credit CAP across Anthropic (monthly/weekly/5-hour/session),
//                 OpenAI (quota/billing), and Gemini (RESOURCE_EXHAUSTED / per-day). Retrying the same
//                 model is futile → drives the capacity-failover card.
//   'other'     — every ordinary wall (no work product, submit error, a bug). Unchanged behavior.
// Heuristic by nature (there is no typed signal) — extend the phrase sets as new provider messages are
// observed; that's why it's pure + unit-tested against a real-string corpus in isolation.
export type ExecErrorClass = 'refusal' | 'exhausted' | 'transient' | 'other';

// A model decline. Kept specific so network "connection refused" / "refused by the rate limiter" do NOT match.
const REFUSAL_RE = /stop_reason["' :]+refusal|\bi (?:can(?:'|no)?t|cannot|will not|won'?t) (?:help|assist|comply|do that)|declined to (?:help|assist|answer|comply|respond)|refuse[sd]? to (?:help|assist|comply|answer)/i;
// A per-window throttle — clears in seconds/minutes, so it's transient even when worded as "quota exceeded".
const PER_WINDOW_RE = /per[- ]?minute|per[- ]?min\b|requests per min|\brpm\b|\btpm\b|per[- ]?second|tokens per min/i;
// A hard cap. "tokens" intentionally dropped from out-of-credits (a context-length "out of tokens" is not billing).
const EXHAUSTED_RE = /monthly spend limit|spend limit|usage limit|out of credits|no (?:remaining )?credits|insufficient[ _]?quota|exceeded your current quota|quota exceeded|credit balance|billing (?:hard )?limit|resource (?:has been )?exhausted|resource_exhausted|per[- ]?day|reached your (?:usage|plan|monthly|weekly|daily|session|5[- ]?hour) limit|\b(?:weekly|daily|session|5[- ]?hour)[- ]?limit\b/i;
// Overload / gateway. Phrase-based 5xx (not a bare \b500\b) so our own "submit 500" never reads as a provider overload.
const TRANSIENT_RE = /rate[ _]?limit|\b429\b|overloaded|\b529\b|\b503\b|internal server error|bad gateway|gateway timeout|temporarily unavailable|service unavailable|please (?:retry|try again)|too many requests/i;

export function classifyExecError(reason: string): ExecErrorClass {
  if (REFUSAL_RE.test(reason)) return 'refusal';      // a decline is never a cap and never a retry
  if (PER_WINDOW_RE.test(reason)) return 'transient'; // "quota exceeded … per minute" clears in ~60s
  if (EXHAUSTED_RE.test(reason)) return 'exhausted';  // hard cap → capacity-failover card
  if (TRANSIENT_RE.test(reason)) return 'transient';  // 429 / 5xx / overloaded → retry
  return 'other';
}

// A cap does not always THROW. The subscription runtimes (Claude Code, codex) finish the
// turn cleanly and put the notice in the REPLY TEXT — which is how "You've hit your
// monthly spend limit…" once got posted as if the agent had said it, with no failover
// card anywhere. This is the guard the reply paths run before posting.
//
// Length-gated deliberately: a provider notice is terse and standalone, whereas an agent
// legitimately DISCUSSING limits (explaining our capacity failover, say) writes prose —
// so only short bodies can trip the wire. False negative (a long notice posts verbatim,
// as it does today) is far cheaper than false positive (silencing a real answer).
export const LIMIT_NOTICE_MAX = 400;
export function isLimitNotice(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= LIMIT_NOTICE_MAX && classifyExecError(t) === 'exhausted';
}

// The turn budget ran out mid-work: the run made progress but never reached a deliverable.
// Worth its own copy because the generic block note tells the human to check their KEY, and a
// key is exactly what is NOT wrong here — the observed case (#1034) burned 97 steps on repeated
// screenshot/edit cycles, hit maxTurns at 568s, and left the worktree untouched.
const MAX_TURNS_RE = /error_max_turns|max[_ ]?turns|maximum (?:number of )?turns|turn limit/i;
export function isTurnExhaustion(reason: string): boolean {
  return MAX_TURNS_RE.test(reason);
}

/** what the human should actually do about this wall — the honest hint, per cause */
function wallHint(reason: string, agentName: string): string {
  if (isTurnExhaustion(reason)) {
    return `It ran out of turns before producing anything — the scope is too big for one pass, not a credentials problem. Narrow the task (or split it with a subtask), then **Unblock** to retry, or **Close** it.`;
  }
  if (classifyExecError(reason) === 'exhausted') {
    return `@${agentName} is at a provider cap — re-seat it or wait for the window to reset, then **Unblock** to retry.`;
  }
  return `Fix the cause (check @${agentName}'s provider key/quota if it's auth), then **Unblock** to retry, or **Close** the task.`;
}

export function planWallOutcome(p: {
  reason: string;
  /**
   * Wall messages on the thread SINCE THE LAST UNBLOCK — this failure is +1.
   *
   * "Since the last unblock" is load-bearing and was the bug: counting every wall the task had
   * ever had made the budget a latch with no reset, so once it reached `blockAfter` the next
   * attempt blocked on its FIRST try, forever. Unblock could never buy a retry — click it and
   * the task went straight back to blocked, which is exactly what was reported. The budget
   * exists to stop an unattended retry loop; a human pressing Unblock IS the attendance, so it
   * has to start the count over.
   */
  priorWalls: number;
  blockAfter: number;
  taskNumber: number;
  agentName: string;
}): WallOutcome {
  const fails = p.priorWalls + 1;
  const reason = p.reason.slice(0, 200);
  if (fails >= p.blockAfter) {
    return {
      action: 'block',
      blockReason: `execution failed ${fails}× — ${reason.slice(0, 160)}`,
      // the wall note stays 'Execution hit a wall:'-prefixed — the budget counts that prefix
      wallNote: `Execution hit a wall: ${reason}.`,
      blockNote: `Auto-blocked #${p.taskNumber} after ${fails} failed execution attempt${fails === 1 ? '' : 's'} — it needs a human.\n\n**Last failure:** ${reason.slice(0, 160)}\n\n${wallHint(reason, p.agentName)}`,
    };
  }
  return {
    action: 'retry',
    attempt: fails + 1,
    wallNote: `Execution hit a wall: ${reason} — retrying (attempt ${fails + 1} of ${p.blockAfter}).`,
  };
}

