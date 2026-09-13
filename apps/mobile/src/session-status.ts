// A SESSION ROW'S STATUS (the thread-status round, 2026-09-08): the shared derivation, fed from the
// rows the session list already holds. Pure and apart from sessions.ts, which reaches
// @powersync/react-native at module load, so a node test can hold it (the thread-groups rule).
import type { QueueDecision } from '@neuramesh/client-core';
import { needsYouWhy, ownedGate, threadStatus, type StatusTask, type ThreadStatus } from '@neuramesh/shared';
import { laterOf } from './settle-rules';

export interface ThreadMeta { settled_at: string | null; last_author_kind: string | null; last_at: string | null }

export interface StatusCtx {
  /** the newest open card per conversation and per task — the query orders newest first */
  cardByThread: Map<string, QueueDecision>;
  cardByTask: Map<string, QueueDecision>;
  threadMeta: Map<string, ThreadMeta>;
  /** the units each conversation OWNS (tasks.origin_thread_id): their gates show on the owner's row */
  ownedByThread: Map<string, StatusTask[]>;
  /** settles made on this phone, ahead of sync (settle.ts) */
  settledLocally?: Map<string, string> | undefined;
  agentName: (id: string) => string | null;
}

/** index the open cards once: the FIRST card seen per key is the newest (OPEN_DECISIONS orders desc) */
/** group the anchored units under the conversation that owns them */
export function ownedIndex(tasks: ReadonlyArray<StatusTask & { origin_thread_id?: string | null }>): Map<string, StatusTask[]> {
  const out = new Map<string, StatusTask[]>();
  for (const t of tasks) {
    if (!t.origin_thread_id || t.parent_task_id) continue;
    const list = out.get(t.origin_thread_id);
    if (list) list.push(t);
    else out.set(t.origin_thread_id, [t]);
  }
  return out;
}

export function cardIndex(decisions: readonly QueueDecision[]): Pick<StatusCtx, 'cardByThread' | 'cardByTask'> {
  const cardByThread = new Map<string, QueueDecision>();
  const cardByTask = new Map<string, QueueDecision>();
  for (const d of decisions) {
    if (d.thread_id && !cardByThread.has(d.thread_id)) cardByThread.set(d.thread_id, d);
    if (d.task_id && !cardByTask.has(d.task_id)) cardByTask.set(d.task_id, d);
  }
  return { cardByThread, cardByTask };
}

export function rowStatus(
  r: { threadId: string | null; task: (StatusTask & { id: string }) | null },
  live: boolean,
  ctx: StatusCtx,
): { status: ThreadStatus; why: string | null; settledAt: string | null } {
  const meta = r.threadId ? ctx.threadMeta.get(r.threadId) : undefined;
  const card = (r.task ? ctx.cardByTask.get(r.task.id) : undefined) ?? (r.threadId ? ctx.cardByThread.get(r.threadId) : undefined) ?? null;
  const settledAt = laterOf(meta?.settled_at ?? null, r.threadId ? ctx.settledLocally?.get(r.threadId) ?? null : null);
  const owned = r.threadId ? ctx.ownedByThread.get(r.threadId) : undefined;
  const input = { task: r.task, card: card ? { ...card, status: 'open' } : null, live, lastAuthorKind: meta?.last_author_kind ?? null, lastAt: meta?.last_at ?? null, settledAt, owned };
  const status = threadStatus(input);
  // the why: a card, else the row's own gate, else the owned unit that waits
  const why = status === 'needs_you' ? needsYouWhy({ task: r.task ?? ownedGate(input), card, asker: card ? ctx.agentName(card.asker_id) : null }) : null;
  return { status, why, settledAt };
}

export function countStatuses(rows: ReadonlyArray<{ status: ThreadStatus }>): Record<ThreadStatus, number> {
  const counts: Record<ThreadStatus, number> = { needs_you: 0, in_progress: 0, settled: 0 };
  for (const r of rows) counts[r.status] += 1;
  return counts;
}
