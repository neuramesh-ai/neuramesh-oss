// THE ⌘Y ROW, as one component (the Home-threads round, 2026-09-11). The overlay drew it inline;
// Home's ledger draws the same row under the composer, so the row moved here and both render it.
// Icon → title + state chip + status chip → snippet → the ask pulse → room and age; the row's one
// act (Settle) and the archive sit beside the button, revealed on hover or focus with their seats
// reserved (tokens.css .histwrap.stl / .arch).
import { IconArchive, IconThreads } from '../ui/icons';
import { STATE_LABEL } from '../task/labels';
import { archivableThreadId } from '../views/HistoryRail';
import { historyRows } from '../room-tabs';
import { timeAgo } from '../lib/time';
import { type TaskAllRow } from '../bridge/rows-board';
import { dialFraction, THREAD_STATUS_LABEL } from '@neuramesh/shared';
import type { RowMarks } from './rowstatus';

export type HistRowData = ReturnType<typeof historyRows<TaskAllRow>>[number];

export function HistRow({ r, marks, grouped, delayMs, onOpen, onSettle, onArchive }: {
  r: HistRowData;
  marks: RowMarks;
  /** only worth naming the room when the list spans more than one */
  grouped: boolean;
  /** the entrance stagger — a sweep down the list, capped by the caller */
  delayMs?: number;
  onOpen: (r: HistRowData) => void;
  /** settle: the thread's status, nothing else. No reverse — unsettle is the toast's undo. */
  onSettle?: (threadId: string) => void;
  onArchive?: (threadId: string, title: string) => void;
}) {
  const { status, ask, settle } = marks;
  const archiveId = archivableThreadId(r);
  return (
    <span className={`histwrap${archiveId ? ' arch' : ''}${onSettle && r.threadId && settle ? ' stl' : ''}`}>
      <button className="histrow" style={delayMs !== undefined ? { animationDelay: `${delayMs}ms` } : undefined} onClick={() => onOpen(r)}>
        <span className="histico">{r.task ? <StateDial state={r.task.state} /> : <IconThreads s={14} />}</span>
        <span className="histbody">
          <span className="histtitle"><span>{r.title}</span>{r.task && <span className={`chip c-${r.task.state}`}>{STATE_LABEL[r.task.state as keyof typeof STATE_LABEL] ?? r.task.state}</span>}<span className={`chip st-${status}`}>{THREAD_STATUS_LABEL[status]}</span></span>
          <span className="histsnip">{r.snip}</span>
        </span>
        {/* scoped to one room, `#dev` on all sixteen rows is noise, not information */}
        {ask && <span className="histask" aria-label="A question waits in this thread" title="A question waits in this thread" />}
        <span className="histwhen">{grouped && <span className="histchan">#{r.channelSlug}</span>}{timeAgo(r.when)}</span>
      </button>
      {/* the row's one act — offered only when the stamp can move something (shared canSettle,
          2026-09-09): reading it off the WORD put `Bring back` on threads with no stamp to clear */}
      {onSettle && r.threadId && settle && (
        <button type="button" className="histsettle" title="Settle this thread. Its status, nothing else."
          onClick={(e) => { e.stopPropagation(); onSettle(r.threadId!); }}>Settle</button>
      )}
      {onArchive && archiveId && (
        <button type="button" className="histarch" title="Archive the conversation. It moves to Settings › Archived chats." aria-label="Archive conversation"
          onClick={(e) => { e.stopPropagation(); onArchive(archiveId, r.title); }}><IconArchive s={13} /></button>
      )}
    </span>
  );
}

// THE PHASE DIAL, as the phone draws it (apps/mobile/src/session-row.tsx): a ring on a dim track,
// filled to where the journey stands, in the state's hue. The tile keeps its seat; the ring says
// the phase at a glance, so a needs-you task and a settled one read apart before the chip is read.
const RING_R = 6.4;
const RING_C = 2 * Math.PI * RING_R;
export function StateDial({ state }: { state: string }) {
  const frac = dialFraction(state);
  return (
    <svg className={`histdial s-${state}`} width="16" height="16" viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r={RING_R} className="track" strokeWidth="2.6" fill="none" />
      <circle cx="9" cy="9" r={RING_R} stroke="currentColor" strokeWidth="2.6" fill="none" strokeDasharray={`${RING_C * frac} ${RING_C}`} />
    </svg>
  );
}
