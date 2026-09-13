// THREAD STATUS (George, 2026-09-08: "threads should have status so a user can settle a thread (if in
// needs you) resulting in the thread state moving to settled; Threads can be settled, needs you, in
// progress; Status becomes a filter for threads; applies across board, web, mobile, desktop").
//
// Three words, ONE derivation, so the phone's Home, its Threads filter, the desktop bell and the ⌘Y
// overlay can never disagree about what a thread is doing. Two of the three are read off what already
// syncs — the who-holds-the-ball rules in needsyou.ts, open runs, who spoke last. Only the third has a
// column: `threads.settled_at` (0137), the human's "I have seen this". The stamp is a MOMENT: a gate or a
// card born after it needs the human again, so a settled thread can never hide new work.
//
// What settle is NOT: an accept, an approve or a dismiss. The board does not move. A done task stays
// done, its PR unmerged, until the human says merge in the thread (accept on the human's word,
// handler.ts). Buttons left the queue; words did not.
import { actionableByHuman, awaitingAgent, decisionHandled, type BallDecision, type BallTask } from './needsyou';

export type ThreadStatus = 'needs_you' | 'in_progress' | 'settled';

export const THREAD_STATUSES: readonly ThreadStatus[] = ['needs_you', 'in_progress', 'settled'];

/** the row's word for each status — a chip, a filter label */
export const THREAD_STATUS_LABEL: Record<ThreadStatus, string> = { needs_you: 'needs you', in_progress: 'in progress', settled: 'settled' };

/** the gates where the human is the one who moves the task (the bell's queue, needsyou.ts) */
const HUMAN_GATES = new Set(['design_review', 'plan_review', 'ship_review', 'done', 'blocked']);
/** states where someone is at work, or the work waits for an agent to take it */
const ACTIVE = new Set(['todo', 'planning', 'designing', 'in_progress', 'in_review', 'shipping', 'releasing', 'verifying']);

export interface StatusTask extends BallTask {
  /** `setup` = the human-walked checklist (docs/39): open until finished or cancelled */
  kind?: string | null;
  /** a born-approved unit rests in plan_review with the stamp set — there is no plan to review */
  plan_approved_at?: string | null;
  pr_number?: number | null;
}

export interface StatusInput {
  /** the session's task, when it has one */
  task: StatusTask | null;
  /**
   * The units this conversation OWNS (tasks.origin_thread_id, docs/41): an anchored unit never earns
   * a session row, so its gate has nowhere to show but here. Any owned unit on a human gate makes
   * the conversation need you, and names why.
   */
  owned?: StatusTask[];
  /** the newest OPEN card in this session (asked on its task, or in the thread) */
  card: BallDecision | null;
  /** an open run under this session — the one liveness signal (docs/29 §10) */
  live: boolean;
  /** who spoke last in the thread: a human last = the agent owes a reply */
  lastAuthorKind: string | null;
  lastAt: string | null;
  /** threads.settled_at */
  settledAt: string | null;
}

/** true when `at` is newer than the stamp — or when there is no stamp, or no time to compare (an
 *  unknown moment is never hidden by a settle: the honest default is "still needs you") */
export function afterSettle(at: string | null | undefined, settledAt: string | null): boolean {
  if (!settledAt) return true;
  const stamp = Date.parse(settledAt);
  if (!Number.isFinite(stamp)) return true;
  const when = at ? Date.parse(at) : NaN;
  return Number.isFinite(when) ? when > stamp : true;
}

/** does this task's gate wait on a human right now — the bell's entry rules, in one place */
export function gateNeedsHuman(t: StatusTask): boolean {
  if (!actionableByHuman(t)) return false;
  // an open setup checklist is the human's own item, unswayed by thread replies (docs/39)
  if (t.kind === 'setup') return t.state === 'todo' || t.state === 'in_progress';
  if (!HUMAN_GATES.has(t.state)) return false;
  if (t.state === 'plan_review' && t.plan_approved_at) return false;
  return !awaitingAgent(t);
}

/** the owned unit whose gate waits on the human, if any — the row's reason */
export function ownedGate(i: Pick<StatusInput, 'owned' | 'settledAt'>): StatusTask | null {
  return (i.owned ?? []).find((u) => gateNeedsHuman(u) && afterSettle(u.updated_at, i.settledAt)) ?? null;
}

export function threadStatus(i: StatusInput): ThreadStatus {
  const t = i.task;
  const gate = (!!t && gateNeedsHuman(t) && afterSettle(t.updated_at, i.settledAt)) || !!ownedGate(i);
  const card = !!i.card && i.card.status === 'open' && !decisionHandled(i.card) && afterSettle(i.card.created_at, i.settledAt);
  if (gate || card) return 'needs_you';
  if (i.live) return 'in_progress';
  // an owned unit still moving keeps the conversation in progress
  if ((i.owned ?? []).some((u) => ACTIVE.has(u.state) || (u.state === 'plan_review' && !!u.plan_approved_at))) return 'in_progress';
  if (t) {
    if (t.kind === 'setup') return t.state === 'todo' || t.state === 'in_progress' ? 'needs_you' : 'settled';
    if (ACTIVE.has(t.state)) return 'in_progress';
    if (t.state === 'plan_review' && t.plan_approved_at) return 'in_progress';
    // a gate the human already answered: the agent's turn
    if (HUMAN_GATES.has(t.state) && awaitingAgent(t)) return 'in_progress';
    if (t.state === 'accepted' || t.state === 'closed' || t.state === 'backlog') return 'settled';
  }
  // a chat where you spoke last: the agent owes a reply — unless you settled it since
  if (i.lastAuthorKind === 'human' && afterSettle(i.lastAt, i.settledAt)) return 'in_progress';
  return 'settled';
}

/**
 * Is anything in this thread STILL covered by the stamp — a human gate, an open card, or your own
 * last word? These are exactly the three clauses `threadStatus` runs through `afterSettle`, and so
 * exactly what a settle can move. Liveness and an active FSM state are deliberately absent: the
 * stamp does not gate them, and never did.
 */
function stampCovers(i: StatusInput): boolean {
  const t = i.task;
  if (t && gateNeedsHuman(t) && afterSettle(t.updated_at, i.settledAt)) return true;
  if (ownedGate(i)) return true;
  if (i.card && i.card.status === 'open' && !decisionHandled(i.card) && afterSettle(i.card.created_at, i.settledAt)) return true;
  return i.lastAuthorKind === 'human' && afterSettle(i.lastAt, i.settledAt);
}

/**
 * Can a settle move anything here — that is, does a settle control belong on this row at all?
 *
 * The control has to be the truth (George, 2026-09-09: "not sure what bring back means"). The
 * desktop used to read the act off the derived WORD — Settle on every needs-you row, Bring back on
 * every settled one — which put a verb on rows that could not move: a thread that reads as settled
 * because the agent simply spoke last has no stamp to clear, and a thread an agent is working in
 * has nothing for a stamp to hide. Ask the stamp instead of the word.
 *
 * There is deliberately NO standing reverse act (George, same day: "not sure we need the back to
 * needs you button"). `thread.unsettle` survives as the UNDO of a settle you just made — the
 * phone's model since the thread-status round, and what docs/35 §5 already asked for — so no
 * surface carries a verb for a state you rarely reverse. A gate or a card born after the stamp
 * brings the thread back on its own, which is the path that actually gets taken.
 */
export function canSettle(i: StatusInput): boolean {
  return stampCovers(i);
}

/**
 * WHY a row needs you — the snippet on a needs-you row says it, so the person can decide from the
 * list (frame 1 of the thread-status design). A card is the more direct ask, so it leads.
 */
export function needsYouWhy(i: { task: StatusTask | null; card: { question: string } | null; asker?: string | null }): string | null {
  if (i.card) return `${i.asker ?? 'An agent'} asks: ${i.card.question}`;
  const t = i.task;
  if (!t) return null;
  if (t.kind === 'setup') return 'Setup is not finished.';
  switch (t.state) {
    case 'plan_review': return 'The plan waits for your approval.';
    case 'design_review': return 'The mockups wait for your approval.';
    case 'ship_review': return 'The release plan waits for your approval.';
    case 'done': return t.pr_number ? `Review passed. Say merge to land PR #${t.pr_number}.` : 'Review passed. Say accept to close it.';
    case 'blocked': return 'Blocked. It waits for you.';
    default: return null;
  }
}
