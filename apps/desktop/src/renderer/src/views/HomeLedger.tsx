// HOME'S LEDGER (docs/design/home-threads-2026-09, George 2026-09-11): the landing grows a list
// under the composer. The ⌘Y overlay's own filter chips, then TWO groups and never the day buckets:
// the asks pinned first under NEEDS YOU, then RECENT, capped, with ⌘Y as the door to the rest. The
// rows are the overlay's rows (shell/HistRow.tsx) off the same derivation the rail and the bell read,
// so the four things that need you are the same four everywhere. Search stays ⌘Y's: the overlay keeps
// the only search field in the product (docs/35 §3.3), and the well here is a door to it.
import { useEffect, useMemo, useState } from 'react';
import { IconSearch } from '../ui/icons';
import { ScopePill } from '../ui/ScopeBar';
import { HistRow, type HistRowData } from '../shell/HistRow';
import { LEDGER_CAP, ledgerOf, type LedgerRow } from '../shell/ledger';
import type { RowMarks } from '../shell/rowstatus';
import type { ScopeProps } from '../shell/useScopeMemory';
import { type WorkspaceProjectRow } from '../bridge/rows-board';
import { THREAD_STATUSES, THREAD_STATUS_LABEL, type ThreadStatus } from '@neuramesh/shared';

/** the project narrowing rides the shell's scope memory (shell/useScopeMemory.ts), keyed `home`, so it
 *  survives navigation like every other destination's; the status word is a toggle, not a scope, and stays here */
export interface HomeLedgerProps extends ScopeProps {
  rows: HistRowData[];
  marksOf: (r: HistRowData) => RowMarks;
  projects: WorkspaceProjectRow[];
  /** channelId → projectId, for the project narrowing */
  projectOf: Map<string, string | null>;
  onOpenThread: (id: string, channelId: string | null) => void;
  onOpenTask: (id: string) => void;
  onSettle: (threadId: string) => void;
  onArchive?: (threadId: string, title: string) => void;
  /** the ⌘Y door */
  onHistory: () => void;
}

export function HomeLedger({ rows, marksOf, projects, projectOf, scope, setScope, onOpenThread, onOpenTask, onSettle, onArchive, onHistory }: HomeLedgerProps) {
  const [status, setStatus] = useState<ThreadStatus | null>(null);
  const proj = scope.projectId;
  // Recent shows the newest rows and `Show n more` lifts the cap in steps (the rail's idiom); a new
  // narrowing starts at the first step again, because the steps were taken on a different list
  const [pages, setPages] = useState(1);
  useEffect(() => { setPages(1); }, [status, proj]);
  const ledger = useMemo(() => ledgerOf({ rows, marksOf, status, projectId: proj, projectOf: (id) => projectOf.get(id), cap: LEDGER_CAP * pages }), [rows, marksOf, status, proj, projectOf, pages]);
  // a fresh workspace has nothing to list: the stage stays the greeting and the composer
  if (!rows.length) return null;
  const active = projects.filter((p) => p.status === 'active');
  const open = (r: HistRowData) => { if (r.task) onOpenTask(r.task.id); else onOpenThread(r.threadId!, r.channelId); };
  let i = 0;
  const rowOf = (m: LedgerRow<HistRowData>) => (
    <HistRow key={m.r.key} r={m.r} marks={m.marks} grouped delayMs={Math.min(i++, 8) * 26} onOpen={open} onSettle={onSettle} onArchive={onArchive} />
  );
  const empty = ledger.needs.length + ledger.recent.length === 0;
  return (
    <div className="ledger">
      {/* STATUS IS A FILTER (2026-09-08): the three words first, with their counts, then the scope */}
      <div className="histovlfilter ledgerfilt" role="group" aria-label="Filter threads">
        <button className={status === null ? 'on' : ''} aria-pressed={status === null} title="Show every thread" onClick={() => setStatus(null)}>All <b>{ledger.counts.all}</b></button>
        {THREAD_STATUSES.map((s) => (
          <button key={s} className={status === s ? 'on' : ''} aria-pressed={status === s} title={`Show only threads that are ${THREAD_STATUS_LABEL[s].replace('needs you', 'waiting on you')}`} onClick={() => setStatus(s)}>
            <span className={`fdot st-${s}`} aria-hidden /> {THREAD_STATUS_LABEL[s]} <b>{ledger.counts[s]}</b>
          </button>
        ))}
        <span className="ledgersp" />
        {active.length > 1 && (
          <ScopePill label="Project" active={proj} set={proj !== null} onClear={() => setScope({ projectId: null })} onPick={(projectId) => setScope({ projectId })}
            items={[{ id: null, label: 'All projects' }, ...active.map((p) => ({ id: p.id, label: p.name || p.slug }))]} />
        )}
        <button type="button" className="ledgersearch" onClick={onHistory} title="Search every thread · ⌘Y"><IconSearch s={13} />Search threads<kbd>⌘Y</kbd></button>
      </div>
      {ledger.needs.length > 0 && <div className="sgroup ny">Needs you · {ledger.needs.length}</div>}
      {ledger.needs.map(rowOf)}
      {ledger.recent.length > 0 && <div className="sgroup">{status ? `${THREAD_STATUS_LABEL[status]} · ${ledger.recentTotal}` : 'Recent'}</div>}
      {ledger.recent.map(rowOf)}
      {empty && <div className="histempty">{status ? 'No threads with this status.' : 'No threads in this project yet.'}</div>}
      {ledger.recentTotal > ledger.recent.length && (
        <button type="button" className="sallrow ledgermore" onClick={() => setPages((n) => n + 1)}>Show {Math.min(LEDGER_CAP, ledger.recentTotal - ledger.recent.length)} more</button>
      )}
      <button type="button" className="sallrow" onClick={onHistory}>Search every conversation <span className="k">⌘Y</span></button>
    </div>
  );
}
