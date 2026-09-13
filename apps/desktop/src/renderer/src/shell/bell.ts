// THE BELL's queue (2026-08-16 — the shell-simplification round).
//
// Home stopped being a screen. Of its three sections two were already elsewhere: **Recent** is
// the nav tree and the ⌘Y overlay rendering the same `historyRows` derivation, and **In flight**
// is the tree's live rows, the tab-0 pulse and the processes popover — docs/29 §10 asks for one
// liveness signal and Home was the fourth. Only the **needs-you queue** had nowhere else to live,
// so it got somewhere that is not a screen: a bell at the head of the workspace strip's right
// rail, leading the crew clusters, ungated, on every surface.
//
// This module is that queue, pure — the derivation moved out of `HomeView` unchanged so its two
// non-obvious rules survive the move and are testable:
//
//   · `actionableByHuman` is the entry test under everything. A SUBTASK's gates belong to its
//     parent, so a finished one queued itself as an accept the server is required to refuse — a
//     card no click could ever clear, one per subtask, forever.
//   · A gate you have already replied to is `awaitingAgent` and leaves the queue AT ONCE. It is
//     not dropped silently: it rides the in-flight lane below with "you replied" on it.
//
// The scope pills retired with Home (they narrowed its sections; every destination carries its
// own ScopeBar, and a notification tray with two filters on it is the chrome this round deletes).
import { actionableByHuman, afterSettle, awaitingAgent, decisionHandled, unroutableTodos } from '@neuramesh/shared';
import type { AgentRow } from '../bridge/rows-crew';
import type { DecisionAllRow, RunUI, TaskAllRow } from '../bridge/rows-board';
import type { HomeConvoRow } from '../bridge/rows-rooms';

/** a task row, or one card standing for N identical asks (the same question from several rooms) */
export type BellRow =
  | { kind: 'task'; id: string; t: TaskAllRow }
  | { kind: 'decision'; id: string; g: DecisionAllRow[] };

export interface BellQueue {
  /** in the order they render: accepts · decisions · the rest */
  rows: BellRow[];
  /** the badge. Drops the moment the server confirms an action, even while a row collapses */
  count: number;
}

export interface BellInput {
  tasks: TaskAllRow[];
  decisions: DecisionAllRow[];
  agents: AgentRow[];
  /**
   * Ids whose action the server CONFIRMED — out of the count immediately, and out of the list
   * once their collapse finishes. This is NOT optimistic removal: it runs only after an `await`
   * returned without throwing, and it self-heals (the caller clears the set on a timer), so a
   * command that succeeded WITHOUT moving the row brings the card back rather than hiding it
   * inside a badge that silently disagrees.
   */
  gone?: Set<string>;
  /** …the subset still playing that collapse: in the list, out of the count */
  leaving?: Set<string>;
}

const ts = (s: string | null | undefined) => (s ? Date.parse(s) : 0);
const byRecency = (a: TaskAllRow, b: TaskAllRow) => ts(b.updated_at) - ts(a.updated_at);
/** the later of a card's two possible stamps: its conversation's, and its task's thread's */
const laterOf = (a: string | null | undefined, b: string | null | undefined) => (!a ? b ?? null : !b ? a : a > b ? a : b);
/** SETTLED (0137): a human said "I have seen this" AFTER the gate opened — it leaves the queue until
 *  the task moves again. The stamp is read against the gate's own age, never as a flag. */
const unsettled = (t: TaskAllRow) => afterSettle(t.updated_at, t.settled_at ?? null);
/** the thread a row's Settle acts on: a task's own thread, or the conversation a card was asked in */
export const settleTarget = (r: BellRow): string | null =>
  r.kind === 'task' ? r.t.thread_id ?? null : r.g[0]!.thread_id ?? r.g[0]!.task_thread_id ?? null;

export function bellQueue({ tasks, decisions, agents, gone, leaving }: BellInput): BellQueue {
  const isGone = (id: string) => !!gone?.has(id);
  const isLeaving = (id: string) => !!leaving?.has(id);
  const live = <T extends { id: string }>(rows: T[]) => rows.filter((r) => !isGone(r.id) || isLeaving(r.id));
  const counted = <T extends { id: string }>(rows: T[]) => rows.filter((r) => !isGone(r.id));

  const answered = (t: TaskAllRow) => awaitingAgent(t);
  const mine = (t: TaskAllRow) => actionableByHuman(t) && !answered(t) && unsettled(t);
  const gate = (state: string) => live(tasks.filter((t) => t.state === state && mine(t))).sort(byRecency);

  // A DONE setup task has no accept (SETUP_TASK_TRANSITIONS), so letting it into `ready` would
  // dock the finished-subtask trap's button all over again. The open wizard gets its own list.
  const readyQ = live(tasks.filter((t) => t.state === 'done' && t.kind !== 'setup' && actionableByHuman(t) && unsettled(t))).sort(byRecency);
  // an open setup checklist is the human's own item — unswayed by thread replies, it stays until
  // the wizard finishes or the task is cancelled
  const setupQ = live(tasks.filter((t) => t.kind === 'setup' && (t.state === 'todo' || t.state === 'in_progress') && actionableByHuman(t) && unsettled(t))).sort(byRecency);
  const shipsQ = gate('ship_review');
  const designsQ = gate('design_review');
  // born-approved units (a routine's hands-off create, 2026-08-19) rest in plan_review with the
  // stamp already set — there is no plan to review, so they never enter the queue
  const plansQ = live(tasks.filter((t) => t.state === 'plan_review' && !t.plan_approved_at && mine(t))).sort(byRecency);
  const blockedQ = gate('blocked');
  // todo tasks nobody can EVER take (their room has no non-orchestrator agent): the board says
  // todo, but nothing moves until a human staffs the room
  const unroutableQ = live(unroutableTodos(tasks, agents).filter((t) => actionableByHuman(t) && unsettled(t))).sort(byRecency);

  // open nmq cards, longest-waiting first — an unanswered question is an agent that did
  // everything it could without you. A card answered in prose is already gone from here;
  // strict-choice cards (permission gates and friends) are exempt by construction.
  const decisionsQ = live(decisions.filter((d) => d.status === 'open' && !decisionHandled(d) && afterSettle(d.created_at, laterOf(d.thread_settled_at, d.task_settled_at))))
    .sort((a, b) => ts(a.created_at) - ts(b.created_at));
  // an agent's multi-question card arrives as N rows sharing message_id — stepped as ONE card
  const groups: DecisionAllRow[][] = [];
  {
    const byMsg = new Map<string, DecisionAllRow[]>();
    for (const d of decisionsQ) {
      const k = d.message_id ?? d.id;
      const g = byMsg.get(k);
      if (g) g.push(d);
      else { const ng = [d]; byMsg.set(k, ng); groups.push(ng); }
    }
  }

  // most-actionable first: accepts unblock shipped work, then decisions (answerable in one
  // click), then design gates (they hold the whole pipeline before planning), then plans, then
  // blocked, then setup checklists (yours to finish, urgent never), then unstaffed rooms
  // (structural — they wait indefinitely, not urgently).
  const tail = [...shipsQ, ...designsQ, ...plansQ, ...blockedQ, ...setupQ, ...unroutableQ];
  const rows: BellRow[] = [
    ...readyQ.map((t) => ({ kind: 'task' as const, id: t.id, t })),
    ...groups.map((g) => ({ kind: 'decision' as const, id: g[0]!.id, g })),
    ...tail.map((t) => ({ kind: 'task' as const, id: t.id, t })),
  ];
  const count = counted([...readyQ, ...tail]).length + counted(decisionsQ).length;
  return { rows, count };
}

/** the row's leading chip: what KIND of thing is waiting, in the queue's own words */
export function bellKind(t: TaskAllRow): string {
  if (t.kind === 'setup') return 'setup';
  if (t.state === 'done') return 'ready';
  if (t.state === 'blocked') return 'blocked';
  return t.state.replace(/_/g, ' ');
}

// ── the IN FLIGHT lane ────────────────────────────────────────────────────────────────────────
// What is moving right now, as opposed to what is waiting for you. It rode Home; it rides the
// popover's second section now, unscoped (the pills retired with Home) and unchanged otherwise.
export type BellFlight =
  | { kind: 'run'; when: string; r: RunUI }
  | { kind: 'task'; when: string; t: TaskAllRow }
  | { kind: 'convo'; when: string; c: HomeConvoRow };

/** every MOVING phase — offered, designed, planned, built, reviewed, shipped — plus a gate you
 *  have already answered: it is waiting on an agent now, so it belongs here rather than nagging
 *  you again, and it is never silently dropped. */
const MOVING = ['todo', 'designing', 'planning', 'in_progress', 'in_review', 'shipping', 'verifying', 'releasing'];

export function bellFlight({ tasks, convos, runs, now }: {
  tasks: TaskAllRow[]; convos: HomeConvoRow[]; runs: RunUI[]; now?: number;
}): BellFlight[] {
  const t0 = now ?? Date.now();
  const answered = (t: TaskAllRow) => awaitingAgent(t);
  // sorted by the last thing that HAPPENED to it, which for an answered gate is your reply, not
  // the older transition — otherwise the row you just acted on sinks under the cap
  const flightAt = (t: TaskAllRow) => Math.max(ts(t.updated_at), answered(t) ? ts(t.last_human_msg_at) : 0);
  // an open SETUP task is never "in flight": no agent moves it, and it is already queued above as
  // the human's own item — being in both would be the badge-vs-page split again
  const taskQ = tasks
    .filter((t) => !t.parent_task_id && t.kind !== 'setup' && (MOVING.includes(t.state) || answered(t)))
    .sort((a, b) => flightAt(b) - flightAt(a))
    .slice(0, 8);
  // live CHAT conversations (task-less threads with traffic in the last day) — a convo that
  // upgrades into a task leaves this set and appears as its task row
  const convoQ = convos.filter((c) => !c.task_id && t0 - ts(c.updated_at) < 24 * 3600e3).slice(0, 8);
  // an open RUN is work happening right now that belongs to no board column. Parents only; a leg
  // is detail that belongs on the card, not in a workspace list.
  const runQ = runs.filter((r) => r.state === 'running' && !r.parent_run_id && r.kind !== 'wake');
  // a task whose execution has an open run is ALREADY represented by that run's row (which
  // carries the live step) — listing both says the same thing twice, one line apart
  const runTaskIds = new Set(runQ.map((r) => r.task_id).filter(Boolean));
  return [
    ...runQ.map((r) => ({ kind: 'run' as const, when: r.updated_at, r })),
    ...convoQ.map((c) => ({ kind: 'convo' as const, when: c.updated_at, c })),
    ...taskQ.filter((t) => !runTaskIds.has(t.id)).map((t) => ({ kind: 'task' as const, when: new Date(flightAt(t)).toISOString(), t })),
  ].sort((a, b) => ts(b.when) - ts(a.when)).slice(0, 10);
}
