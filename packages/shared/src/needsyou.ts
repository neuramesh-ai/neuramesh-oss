// Who holds the ball (docs/12 / docs/32) — the pure half of Home's needs-you queue.
//
// The bug this closes, reported from live use: you see "1 needs you", open the thread,
// answer the question, come back to Home — and the card is still sitting there. It was
// not a sync lag. The queue was derived from state that only an AGENT can move: a
// `plan_review` row stays `plan_review` until the orchestrator reads your reply and
// issues the verdict; an nmq decision row stays `open` unless you happened to answer it
// by clicking an option rather than by typing. Between your answer and the agent's next
// turn — seconds at best, the whole sweep interval at worst — Home asked you again for
// something you had already done.
//
// The fix is to stop equating "the gate is open" with "this needs you". The ball leaves
// your court the moment you RESPOND, not when the agent finally acts on it. Both rules
// below are derived from synced data (task/decision timestamps vs the newest human
// message in that conversation), so every client agrees without storing anything, and
// the item is never lost: it moves to "in flight" as work waiting on an agent, and the
// stall watchdog (stall.ts, same predicate) re-raises it if the agent never acts.

/** Gate states where a human REPLY is the action that moves the task on. */
const REPLY_MOVES_IT = new Set(['design_review', 'plan_review', 'ship_review', 'blocked']);

export interface BallTask {
  state: string;
  /** the transition into the current state — the gate's own age */
  updated_at: string | null;
  /** newest human message in this task's thread (null when the human hasn't spoken) */
  last_human_msg_at?: string | null;
  /** set when this row is a SUBTASK — its gates belong to its parent (docs/24) */
  parent_task_id?: string | null;
}

/**
 * Can a human do anything about this row at all? The queue's entry test, and the answer to
 * "why is this card still here after I dealt with it".
 *
 * A SUBTASK is the case that made this a function. Its life is claim → finish → cancel, and
 * `finish` lands it in `done` — the same state the queue reads as "ready to accept". So every
 * subtask a human or an agent ever finished queued itself as an accept, offering a button the
 * server is required to refuse (`evaluateTransition`: "a subtask has no accept — its parent's
 * gates cover that"). Nothing the human could click would clear it, so it stayed for good, and
 * they accumulate: one per finished subtask, forever (George, 2026-08-04 — "they never
 * disappear… this is clogging the home screen").
 *
 * Every other surface already excludes subtasks — board cards, room counts, the session list —
 * because docs/24 says a subtask rides its parent and is never its own card. The queue was the
 * one place that read `state` without asking whose gate it is. It lives here, next to the other
 * ball rules, so the queue, its badge, ⌘K and the stall watchdog cannot disagree about it.
 */
export function actionableByHuman(t: BallTask): boolean {
  return !t.parent_task_id;
}

/**
 * True when the human has already responded to this gate and the task is now waiting on
 * an agent — so it belongs in "in flight", not in "needs you".
 *
 * Deliberately NOT applied to every gate:
 *  · `done` is cleared by the Accept button (HUMAN_ONLY) — prose does not accept work.
 *  · an unroutable `todo` is cleared by staffing the room — talking to it changes nothing.
 * Those two stay in the queue until the human actually does the thing.
 */
export function awaitingAgent(t: BallTask): boolean {
  if (!REPLY_MOVES_IT.has(t.state)) return false;
  const said = t.last_human_msg_at ? Date.parse(t.last_human_msg_at) : NaN;
  if (!Number.isFinite(said)) return false;
  const gate = t.updated_at ? Date.parse(t.updated_at) : NaN;
  return !Number.isFinite(gate) || said > gate;
}

export interface BallDecision {
  status: string;
  created_at: string;
  /** 0/false = a strict multiple choice; the card refuses free text */
  allow_other?: number | boolean | null;
  /** newest human message in the decision's own conversation (its task thread, else its channel) */
  human_replied_at?: string | null;
}

/**
 * True when a still-`open` card has already been answered in prose and should leave the queue.
 *
 * The `allow_other` guard is the whole safety story, and it is structural rather than a
 * list of card names: a card that refuses free text (permission gates, the design-provider
 * pick, schedule confirmations) CANNOT have been answered by a sentence, so a passing reply
 * must never retire it — those need the exact option, and the agent is blocked on it. A card
 * that accepts free text is one where typing an answer IS answering.
 */
export function decisionHandled(d: BallDecision): boolean {
  if (d.status !== 'open') return false;
  if (!(d.allow_other ?? true)) return false;
  const said = d.human_replied_at ? Date.parse(d.human_replied_at) : NaN;
  if (!Number.isFinite(said)) return false;
  const asked = Date.parse(d.created_at);
  return !Number.isFinite(asked) || said > asked;
}
