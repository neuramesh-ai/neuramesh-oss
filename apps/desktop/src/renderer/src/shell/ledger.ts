// HOME'S LEDGER (the Home-threads round, 2026-09-11; docs/design/home-threads-2026-09): the same
// rows the ⌘Y overlay, the rail and the bell read, shaped for the landing. Two groups, never the
// day buckets (George): the asks pinned first, then Recent. Pure and injected, so every boundary
// is assertable; the caller supplies the marks (shell/rowstatus.ts) and the project of each room.
import type { ThreadStatus } from '@neuramesh/shared';
import type { RowMarks } from './rowstatus';

export interface LedgerRow<R> { r: R; marks: RowMarks }
export interface Ledger<R> {
  /** the rows that need the human, newest first — pinned above Recent, absent when the status
   *  filter names another word */
  needs: LedgerRow<R>[];
  /** everything else the filter admits, newest first, capped — ⌘Y is the door to the rest */
  recent: LedgerRow<R>[];
  /** how many rows Recent had before the cap */
  recentTotal: number;
  /** the chip counts, over the project-narrowed set (ONE narrowing, so a count and its list agree) */
  counts: Record<ThreadStatus, number> & { all: number };
}

/** the newest rows a landing shows before it points at ⌘Y */
export const LEDGER_CAP = 40;

export function ledgerOf<R extends { channelId: string | null }>(input: {
  rows: R[];
  marksOf: (r: R) => RowMarks;
  status: ThreadStatus | null;
  projectId: string | null;
  projectOf: (channelId: string) => string | null | undefined;
  cap?: number;
}): Ledger<R> {
  const cap = input.cap ?? LEDGER_CAP;
  const inProject = input.projectId ? input.rows.filter((r) => !!r.channelId && input.projectOf(r.channelId) === input.projectId) : input.rows;
  const marked = inProject.map((r) => ({ r, marks: input.marksOf(r) }));
  const counts = { all: marked.length, needs_you: 0, in_progress: 0, settled: 0 } as Ledger<R>['counts'];
  for (const m of marked) counts[m.marks.status] += 1;
  const asks = marked.filter((m) => m.marks.status === 'needs_you');
  // the needs-you group leads when nothing narrows, or when the filter names it; any other word
  // means the person asked for that word alone, so the group yields
  const needs = input.status === null || input.status === 'needs_you' ? asks : [];
  const rest = input.status === null
    ? marked.filter((m) => m.marks.status !== 'needs_you')
    : input.status === 'needs_you' ? [] : marked.filter((m) => m.marks.status === input.status);
  return { needs, recent: rest.slice(0, cap), recentTotal: rest.length, counts };
}
