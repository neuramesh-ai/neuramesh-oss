// 0137: SETTLE, and the HUMAN'S WORD — leaf helpers of both stores, kept out of pgstore.ts and
// memory.ts on their ratchets' own terms (the thread-machine.ts precedent).
//
// Settle stamps threads.settled_at and touches nothing else: not updated_at (a settled thread must
// not float to the top of a recency list), not the board. The human's word is the evidence an agent
// accept is refused without: a HUMAN message in the task's thread NEWER than the review verdict.
import type postgres from 'postgres';
import { isCardOrMarker } from '@neuramesh/shared';
import { DomainError } from '../errors';

/** undefined = no such thread, null = a chat thread (the archive and settle handlers' first read) */
export async function threadTaskIdSql(sql: postgres.Sql, workspace: string, threadId: string): Promise<string | null | undefined> {
  const [row] = await sql<Array<{ task_id: string | null }>>`select task_id from threads where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid`;
  return row ? row.task_id : undefined;
}

export async function setThreadSettledSql(sql: postgres.Sql, workspace: string, threadId: string, settled: boolean): Promise<void> {
  const [row] = await sql<Array<{ id: string }>>`update threads set settled_at = ${settled ? sql`now()` : null}
    where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid returning id`;
  if (!row) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);
}

/** the task's own messages, or its thread's (thread-per-task); after the verdict, else after the
 *  task's last change — `done` is frozen, so for a done task that IS the moment review passed.
 *  What a client posts for the person is a click or a record, never their word (shared
 *  isCardOrMarker): the connected divider the GitHub grant posts, a marker line, and a card's answer.
 *  The verdict card's Approve posts "**…** → Approve #N" right after the approve stamps approved_at,
 *  so a click that said Approve once counted as the word an agent accept needs (2026-10-05). The rule
 *  is read in code, the same function the memory twin reads, so the two stores cannot drift. */
export async function latestHumanWordSql(sql: postgres.Sql, taskId: string): Promise<{ id: string; createdAt: string } | null> {
  const rows = await sql<Array<{ id: string; created_at: string; body: string }>>`select m.id, m.created_at, m.body
    from messages m join tasks t on t.id = ${taskId}::uuid and m.workspace_id = t.workspace_id
    where m.author_kind = 'human'
      and (m.task_id = t.id or m.thread_id in (select th.id from threads th where th.task_id = t.id))
      and m.created_at > coalesce(t.approved_at, t.updated_at)
    order by m.created_at desc limit 50`;
  const row = rows.find((r) => !isCardOrMarker(r.body));
  return row ? { id: row.id, createdAt: row.created_at } : null;
}

// ── the memory store's twins ──
export function settleMemoryThread(threads: Array<{ id: string; workspace: string; settledAt?: string | null }>, workspace: string, threadId: string, settled: boolean): void {
  const t = threads.find((x) => x.id === threadId && x.workspace === workspace);
  if (!t) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);
  t.settledAt = settled ? new Date().toISOString() : null;
}

/** the reducer stamps updatedAt on every transition and `done` is frozen, so `since` is the moment
 *  review passed (the pg store reads approved_at first) */
export function pickHumanWord(
  messages: ReadonlyArray<{ id: string; createdAt: string; taskId: string | null; threadId?: string | null; author: { kind: string }; body: string }>,
  threads: ReadonlyArray<{ id: string; taskId: string | null }>,
  taskId: string,
  since: string,
): { id: string; createdAt: string } | null {
  const threadIds = new Set(threads.filter((t) => t.taskId === taskId).map((t) => t.id));
  const words = messages
    .filter((m) => m.author.kind === 'human' && !isCardOrMarker(m.body) && (m.taskId === taskId || (!!m.threadId && threadIds.has(m.threadId))) && m.createdAt > since)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const w = words[0];
  return w ? { id: w.id, createdAt: w.createdAt } : null;
}
