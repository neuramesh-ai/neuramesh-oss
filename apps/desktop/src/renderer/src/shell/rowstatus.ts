// A SESSION ROW'S STATUS ON THE DESKTOP (the thread-status round, 2026-09-08): the shared derivation
// (shared/threadstatus.ts), fed from the rows the shell already holds — every task with its
// last-human-message stamp, every open card, the live ids, and the thread rows' settle stamps and
// last speaker. The ⌘Y overlay filters and chips by it; the phone's Threads tab runs the same rule.
import { canSettle, decisionHandled, threadStatus, type ThreadStatus } from '@neuramesh/shared';
import type { HistoryRow } from '@neuramesh/shared';
import type { DecisionAllRow, TaskAllRow } from '../bridge/rows-board';
import type { HistoryThreadRow } from '../bridge/rows-rooms';

const laterOf = (a: string | null | undefined, b: string | null | undefined) => (!a ? b ?? null : !b ? a : a > b ? a : b);

/** what a row wears: its status, whether a card is open in it (the ask pulse, as on the phone), and
 *  whether a settle control belongs on it at all — false when a stamp would move nothing.
 *  There is no reverse act here: unsettle is the toast's undo, never a control (shared canSettle) */
export interface RowMarks { status: ThreadStatus; ask: boolean; settle: boolean }

/** all a row has to carry to be marked — so the OPEN session can ask the same question the rail's
 *  rows do, without a HistoryRow to hand (the thread head's chip and Settle, 2026-09-09) */
export type MarkableRow = Pick<HistoryRow<TaskAllRow>, 'threadId' | 'task'>;

/** what a drafted post has to carry to count (the nm.contentAll() rows): its unit, its birth, its state */
export type DraftLike = { task_id: string | null; created_at: string; status: string };

/** drafted posts still waiting, per unit: how many, and the newest one's birth */
function draftsByUnit(drafts: DraftLike[]): Map<string, { n: number; at: string }> {
  const out = new Map<string, { n: number; at: string }>();
  for (const d of drafts) {
    if (d.status !== 'draft' || !d.task_id) continue;
    const cur = out.get(d.task_id);
    out.set(d.task_id, { n: (cur?.n ?? 0) + 1, at: laterOf(cur?.at, d.created_at) ?? d.created_at });
  }
  return out;
}

export function makeRowMarks(i: { decisions: DecisionAllRow[]; liveIds: Set<string>; threads: HistoryThreadRow[]; tasks?: TaskAllRow[]; drafts?: DraftLike[] }): (r: MarkableRow) => RowMarks {
  // the units each conversation OWNS (docs/41): an anchored unit has no row, so its gate shows on the owner's
  const ownedByThread = new Map<string, TaskAllRow[]>();
  for (const t of i.tasks ?? []) {
    if (!t.origin_thread_id || t.parent_task_id) continue;
    const list = ownedByThread.get(t.origin_thread_id);
    if (list) list.push(t);
    else ownedByThread.set(t.origin_thread_id, [t]);
  }
  // the newest OPEN card per conversation and per task (the watch orders newest first)
  const byThread = new Map<string, DecisionAllRow>();
  const byTask = new Map<string, DecisionAllRow>();
  for (const d of i.decisions) {
    if (d.status !== 'open' || decisionHandled(d)) continue;
    if (d.thread_id && !byThread.has(d.thread_id)) byThread.set(d.thread_id, d);
    if (d.task_id && !byTask.has(d.task_id)) byTask.set(d.task_id, d);
  }
  // drafted posts still waiting, per unit (the release-drafts round, §4.5): a conversation carries the
  // drafts of the content units it OWNS, so they lift it exactly as an owned unit's gate does. Only
  // the owned units count — a task's own row already wears its state. Absent (the other callers,
  // shell/useNavBands.ts), the rule is inert.
  const draftsByTask = draftsByUnit(i.drafts ?? []);
  const threadById = new Map(i.threads.map((t) => [t.id, t]));
  return (r) => {
    const th = r.threadId ? threadById.get(r.threadId) : undefined;
    const card = (r.task ? byTask.get(r.task.id) : undefined) ?? (r.threadId ? byThread.get(r.threadId) : undefined) ?? null;
    const owned = r.threadId ? ownedByThread.get(r.threadId) : undefined;
    const waits = (owned ?? []).flatMap((u) => draftsByTask.get(u.id) ?? []);
    const input = {
      task: r.task,
      card,
      live: (!!r.task && i.liveIds.has(r.task.id)) || (!!r.threadId && i.liveIds.has(r.threadId)),
      lastAuthorKind: th?.last_author_kind ?? null,
      lastAt: th?.last_at ?? null,
      settledAt: laterOf(th?.settled_at, r.task?.settled_at),
      owned,
      draftsWaiting: waits.reduce((n, w) => n + w.n, 0),
      draftsAt: waits.reduce<string | null>((at, w) => laterOf(at, w.at), null),
    };
    // one input, both answers — the word on the row and the act its control offers can never drift
    return { status: threadStatus(input), ask: card !== null, settle: !!r.threadId && canSettle(input) };
  };
}
