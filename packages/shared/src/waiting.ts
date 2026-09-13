// WHAT A THREAD SAYS BETWEEN YOUR MESSAGE AND THE ANSWER — the words, and how long they may
// stand. Shared because the desktop, the browser and the phone all say them, and one wait must
// never get three stories (the MACHINE_WAIT_LINE ruling in compute.ts, applied again).
//
// The client-side ladders live where their data does — the desktop's in
// `thread/waitghost-rule.ts`, the phone's in `src/thread-activity.tsx` — because the two read
// different shapes. What they may NOT do is disagree about the copy or the deadline, so those
// are here and the decision below is one function.

/**
 * The word a thread opens with while an agent starts to think.
 *
 * The SAME word the working ghost opens with, deliberately: the wait ghost hands its row over
 * mid-sentence, and a different verb would swap the line under the reader at the exact moment
 * the real narration arrives.
 *
 * A BUSY-STATE LABEL, so CLAUDE.md #11's own exception applies — present participle and ellipsis,
 * because that shape is what says "still going".
 */
export const WAIT_THINKING = 'thinking…';

/**
 * HOW LONG A THREAD MAY PROMISE AN ANSWER BEFORE IT ADMITS IT HAS NONE.
 *
 * The wait ghost is deliberately unbounded in every other respect — a message nobody answered is
 * still waiting an hour later. What it may not do is spin behind nothing, which is the failure
 * this deadline closes: the wake never fired, and the orb promised a reply that was never coming.
 *
 * Two minutes, and the number is not arbitrary. A human message is priority 1 on the host queue
 * (harness/dispatch.ts), so admission normally happens in seconds, and BOTH wake paths open a
 * `runs` row before they do any work — so "no run for my message" is provable, not guessed. The
 * two slow-but-healthy cases are already excluded before this is reached: a machine that is not up
 * has its own rung and its own words, and a machine that is merely saturated still opens the run
 * as soon as a slot frees. Two minutes past all of that is not slow, it is silent.
 */
export const WAIT_LIMIT_MS = 2 * 60_000;

/** the deadline, asked as a question. `sinceMs` is the newest human message's timestamp. */
export function waitTimedOut(sinceMs: number | null, now: number): boolean {
  return sinceMs !== null && Number.isFinite(sinceMs) && now - sinceMs >= WAIT_LIMIT_MS;
}

/**
 * What the row says once the deadline passes.
 *
 * A FACT, not a diagnosis. We know the message is the newest and that nothing opened a run for it
 * — we do not know why, so the line does not guess. It also ends in a full stop rather than an
 * ellipsis, which is the `no_credits` precedent: this is not progress, and punctuating it as
 * progress is what makes a stopped thing look like a slow one.
 */
export function waitTimeoutLine(sinceMs: number, now: number): string {
  const mins = Math.max(1, Math.floor((now - sinceMs) / 60_000));
  return `No answer for ${mins} ${mins === 1 ? 'minute' : 'minutes'}.`;
}

/** the control beside it. It names its own act, so it needs no caption (CLAUDE.md #11). */
export const WAIT_RETRY = 'Send it again';

/** how often a waiting surface re-reads the clock. Minute granularity needs no more. */
export const WAIT_TICK_MS = 15_000;
