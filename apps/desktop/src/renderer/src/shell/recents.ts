import type { HistoryRow } from '@neuramesh/shared';
import type { TaskAllRow } from '../bridge/rows-board';
import type { HistoryThreadRow } from '../bridge/rows-rooms';
import type { MarkableRow, RowMarks } from './rowstatus';

export const RECENT_GROUPS = ['working', 'idle', 'settled'] as const;
export type RecentGroup = typeof RECENT_GROUPS[number];
export const RECENT_LABEL: Record<RecentGroup, string> = { working: 'Working', idle: 'Idle', settled: 'Settled' };
export interface RecentMarks extends RowMarks { group: RecentGroup }
type Row = HistoryRow<TaskAllRow>;
const time = (value?: string | null) => value ? Date.parse(value) : Number.NaN;
const isCode = (row: Row) => row.kind === 'coding' || !!row.engineeringSessionId;
function isLive(row: Row, ids: Set<string>): boolean {
  if (isCode(row)) return row.engineeringState === 'streaming';
  return [row.threadId, row.task?.id].some((id) => !!id && ids.has(id));
}
function coveredByStamp(stamp: number, activity: number): boolean {
  return Number.isFinite(stamp) && Number.isFinite(activity) && stamp >= activity;
}

/** The rail distinguishes a quiet reply from an explicit human settle. The persisted stamp
 * covers only existing activity. New messages, code turns, and requests reopen the row. */
export function makeRecentMarks(i: {
  threads: HistoryThreadRow[];
  liveIds: Set<string>;
  marksOf: (row: MarkableRow) => RowMarks;
}): (row: Row) => RecentMarks {
  const threads = new Map(i.threads.map((thread) => [thread.id, thread]));
  return (row) => {
    const marks = i.marksOf(row);
    const thread = row.threadId ? threads.get(row.threadId) : undefined;
    const live = isLive(row, i.liveIds);
    const stamp = Math.max(...[thread?.settled_at, row.task?.settled_at].map(time).filter(Number.isFinite));
    // Code-session updated_at includes reconnects. The API clears the settle stamp when
    // a prompt, reply or approval lands, so a mere view of the thread must not reopen it.
    const activity = Math.max(...[isCode(row) ? thread?.updated_at : row.when, thread?.last_at, row.task?.updated_at].map(time).filter(Number.isFinite));
    // Non-code marks already compare decision and owned-unit timestamps with the stamp.
    const newAsk = !isCode(row) && marks.status === 'needs_you';
    const settled = !live && !newAsk && coveredByStamp(stamp, activity);
    const group: RecentGroup = settled ? 'settled'
      : live || marks.status !== 'settled' ? 'working' : 'idle';
    return {
      ...marks, group,
      status: settled ? 'settled' : marks.status,
      ask: !settled && marks.ask,
      // A running agent remains visible. Once it pauses or replies, the user can settle it.
      settle: !!row.threadId && !row.engineeringSessionId && !settled && !live,
    };
  };
}

/** Partition before paging, so a long settled history cannot hide current work. */
export function recentGroups<R extends { when: string }>(rows: R[], groupOf: (row: R) => RecentGroup): Record<RecentGroup, R[]> {
  const groups: Record<RecentGroup, R[]> = { working: [], idle: [], settled: [] };
  for (const row of rows) groups[groupOf(row)].push(row);
  for (const group of RECENT_GROUPS) groups[group].sort((a, b) => time(b.when) - time(a.when));
  return groups;
}
