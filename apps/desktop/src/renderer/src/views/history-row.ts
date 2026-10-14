import { plainTitle, type HistoryRow } from '../room-tabs';
import type { TaskAllRow } from '../bridge/rows-board';
import type { RowKind } from '../lib/rowglyph';

export function kindOf(r: HistoryRow<TaskAllRow>): RowKind { return r.engineeringSessionId || r.kind === 'coding' ? 'code' : r.task ? 'task' : r.scheduleId ? 'routine' : 'chat'; }
/** a row the coding runtime drives: a legacy Engineering session (its own floor) or a coding THREAD (0144, the one surface) */
export const codeDriven = (r: HistoryRow<TaskAllRow>): boolean => !!r.engineeringSessionId || r.kind === 'coding';
/** an engineering session's state, in the vocabulary a human reads (#391's runtime states) */
export const ENG_LABEL: Record<string, string> = { idle: 'idle', streaming: 'working', awaiting_approval: 'needs your approval', resumable: 'paused', completed: 'completed', error: 'failed' };
export function titleOf(r: HistoryRow<TaskAllRow>): string { return r.task ? plainTitle(r.task.title) : r.title; }

/**
 * Can this row be archived (0108)?
 *
 * CHAT THREADS ONLY, decided in the design round: a task thread is the board's record of a work
 * attempt, so hiding it would leave a task that still counts as open with nowhere to read it. A
 * legacy loose room message (`rootMessageId`, no thread of its own) has nothing to archive either.
 */
export function archivableThreadId(row: HistoryRow<TaskAllRow>): string | null {
  if (row.state || row.task || row.rootMessageId) return null;
  return row.threadId;
}
