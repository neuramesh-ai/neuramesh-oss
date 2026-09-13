// History — a room's archived threads, as an overlay. Extracted from App.tsx (track A4).
import { IconSearch } from '../ui/icons';
import { ProjLogo } from '../components/AgentAvatar';
import { Popover } from '../ui/Popover';
import { historyRows } from '../room-tabs';
import { type TaskAllRow, type WorkspaceProjectRow } from '../bridge/rows-board';
import { THREAD_STATUSES, THREAD_STATUS_LABEL, type ThreadStatus } from '@neuramesh/shared';
import { HistRow } from './HistRow';
import type { RowMarks } from './rowstatus';

// The expanded surface: the v0.63 History page, floated. Identical rows — icon, title, state
// chip, preview line, elapsed — because those are exactly what the rail had to drop, and they
// are the reason this scale exists.
export function HistoryOverlay({ rows, q, onQ, scopeLabel, grouped, projects, projectOf, projFilter, onProjFilter, marksOf, statusFilter, onStatusFilter, onSettle, onQuit, onOpenThread, onOpenTask, onArchive, anchor }: {
  rows: Array<ReturnType<typeof historyRows<TaskAllRow>>[number]>;
  /** the three words a thread can wear, and whether a card is open in it (shell/rowstatus.ts) */
  marksOf: (r: ReturnType<typeof historyRows<TaskAllRow>>[number]) => RowMarks;
  statusFilter: ThreadStatus | null;
  onStatusFilter: (s: ThreadStatus | null) => void;
  /** settle: the thread's status, nothing else. No reverse — unsettle is the toast's undo. */
  onSettle?: (threadId: string) => void;
  q: string;
  onQ: (v: string) => void;
  scopeLabel: string;
  /** the workspace's projects — the overlay spans them all, so it must be able to narrow (2026-08-07) */
  projects: WorkspaceProjectRow[];
  /** channelId → projectId, for the filter */
  projectOf: Map<string, string | null>;
  projFilter: string | null;
  onProjFilter: (projectId: string | null) => void;
  /** only worth naming the room when the list spans more than one */
  grouped: boolean;
  onQuit: () => void;
  /** the overlay is workspace-wide, so a row all but always names a room you are not in */
  onOpenThread: (id: string, channelId: string | null) => void;
  onOpenTask: (id: string) => void;
  onArchive?: (threadId: string, title: string) => void;
  /** where it grows from — the rail's magnifier for ⌘Y, the press for a click (ui/anchor.ts) */
  anchor?: { x: number; y: number } | null;
}) {
  // ONE narrowing, so the count and the list can never disagree (the badge-over-page bug)
  const inProject = projFilter ? rows.filter((r) => r.channelId && projectOf.get(r.channelId) === projFilter) : rows;
  const withStatus = inProject.map((r) => ({ r, ...marksOf(r) }));
  const shown = statusFilter ? withStatus.filter((x) => x.status === statusFilter) : withStatus;
  const count = (s: ThreadStatus) => withStatus.filter((x) => x.status === s).length;
  return (
    // Esc, the click-catcher and the pivot all live in Popover now — this component is the list.
    <Popover label="Search threads" anchor={anchor ?? null} width={720} onClose={onQuit} className="histovl">
      <>
        <div className="histovlhd">
          <IconSearch s={16} />
          <input autoFocus value={q} placeholder={scopeLabel} aria-label="Search threads" onChange={(e) => onQ(e.target.value)} />
          <span className="histcount">{shown.length} {shown.length === 1 ? 'thread' : 'threads'}</span>
        </div>
        {/* STATUS IS A FILTER (2026-09-08): the three words first, with their counts, then the projects */}
        <div className="histovlfilter" role="group" aria-label="Filter threads">
          <button className={statusFilter === null ? 'on' : ''} aria-pressed={statusFilter === null} title="Show every thread" onClick={() => onStatusFilter(null)}>All <b>{withStatus.length}</b></button>
          {THREAD_STATUSES.map((s) => (
            <button key={s} className={statusFilter === s ? 'on' : ''} aria-pressed={statusFilter === s} title={`Show only threads that are ${THREAD_STATUS_LABEL[s].replace('needs you', 'waiting on you')}`} onClick={() => onStatusFilter(s)}>
              <span className={`fdot st-${s}`} aria-hidden /> {THREAD_STATUS_LABEL[s]} <b>{count(s)}</b>
            </button>
          ))}
          {projects.length > 1 && (
            <>
              <span className="fsep" aria-hidden />
              <button className={projFilter === null ? 'on' : ''} onClick={() => onProjFilter(null)}>All projects</button>
              {projects.map((p) => (
                <button key={p.id} className={projFilter === p.id ? 'on' : ''} onClick={() => onProjFilter(p.id)}>
                  <ProjLogo logo={p.logo_url} name={p.name || p.slug} size={13} /> {p.slug}
                </button>
              ))}
            </>
          )}
        </div>
        <div className="histovllist">
          {shown.length === 0 && <div className="histempty">{q.trim() ? <>Nothing matches <b>“{q.trim()}”</b>.</> : statusFilter ? 'No threads with this status.' : projFilter ? 'No threads in this project yet.' : 'Nothing yet — your next message starts the first thread.'}</div>}
          {shown.map(({ r, status, ask, settle }, i) => (
            // the stagger caps at 8 rows: one sweep down the list, never a queue you wait out
            <HistRow key={r.key} r={r} marks={{ status, ask, settle }} grouped={grouped} delayMs={Math.min(i, 8) * 26}
              onOpen={(row) => { row.task ? onOpenTask(row.task.id) : onOpenThread(row.threadId!, row.channelId); onQuit(); }}
              onSettle={onSettle} onArchive={onArchive} />
          ))}
        </div>
        <div className="histovlfoot"><kbd>⏎</kbd> open<kbd>esc</kbd> close<span className="d">{shown.length} of {withStatus.length} · ⌘Y from anywhere</span></div>
      </>
    </Popover>
  );
}
