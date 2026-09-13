// THE BELL and its popover (2026-08-16) — what used to be Home's needs-you queue.
//
// It leads the workspace strip's right rail, before the crew clusters, and unlike them it is
// NEVER gated: the clusters stand down the moment a task or thread opens, which is most of the
// time, and a queue you can only see from one surface is a queue you forget. The badge wears the
// notification treatment Home's nav row had (`--link` fill, not the informational `--panel3`) —
// one signal, one derivation (`askIds` / `bellQueue`), never a second.
//
// A row is a door, not a form (the 2026-08-07 ruling, kept): the full card — options, free text,
// Answer — renders in the THREAD, which is where answering happens. This holds one line per ask
// and opens the conversation on click. Dismiss survives as the hover ✕.
//
// In flight rides below as a quieter second section, so the one place you check "what needs me"
// answers "what is moving" in the same glance — and so the four-way liveness split docs/29 §10
// warns about does not grow a fifth surface.
import { IconSearch } from '../ui/icons';
import { Orb } from '../ui/Orb';
import { STATE_LABEL } from '../task/labels';
import { bellKind, type BellRow } from './bell';
import { plainTitle } from '../room-tabs';
import { runElapsed } from '@neuramesh/shared';
import { timeAgo } from '../lib/time';
import { useEffect, useRef, type ReactNode } from 'react';
import type { DecisionAllRow, RunUI, TaskAllRow } from '../bridge/rows-board';
import type { HomeConvoRow } from '../bridge/rows-rooms';

export type FlightRow =
  | { kind: 'run'; r: RunUI }
  | { kind: 'task'; t: TaskAllRow }
  | { kind: 'convo'; c: HomeConvoRow };

export function BellPopover({
  rows, count, flight, leaving, busyId, liveThreads, agentName, agentRole, orbState, answered,
  onOpenTask, onOpenConvo, onSettle, onHistory, onClose, alertsSection, alertCount,
}: {
  rows: BellRow[];
  count: number;
  /** the attention rows (failure-alerts round), composed by App from the SAME derivation the
   *  Home bar renders — pinned above the queue, never counted into needs-you (an alert is not
   *  a task, the invitation-card rule) */
  alertsSection?: ReactNode;
  alertCount?: number;
  flight: FlightRow[];
  /** ids mid-collapse — the row shrinks rather than vanishing under the cursor */
  leaving: Set<string>;
  busyId: string | null;
  /** `${channelId}:${threadId}` → the agent streaming into it right now */
  liveThreads: Record<string, string>;
  agentName: (id: string | null) => string | null;
  agentRole: (id: string | null) => string | null;
  orbState: (step: string, role: string | null) => string;
  answered: (t: TaskAllRow) => boolean;
  onOpenTask: (id: string) => void;
  onOpenConvo: (channelId: string, threadId: string) => void;
  /** SETTLE (0137): the row's one act — the thread's status, nothing else. The ✕ that only decision
   *  rows had (decision.dismiss) retired with it: a settle is not a dismiss, and every row gets one. */
  onSettle: (threadId: string, rowId: string) => void;
  onHistory: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest?.('.bellbtn')) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);

  const taskRow = (t: TaskAllRow) => {
    const who = agentName(t.assignee_id);
    return (
      <div key={t.id} className={`nyrow${leaving.has(t.id) ? ' resolving' : ''}`} role="button" tabIndex={0}
        onClick={() => { onOpenTask(t.id); onClose(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { onOpenTask(t.id); onClose(); } }}>
        <span className={`nykind${t.kind === 'setup' ? ' setup' : ` s-${t.state}`}`}>{bellKind(t)}</span>
        <span className="nytext"><b>#{t.number}</b> {plainTitle(t.title)}{who ? <span className="nywho"> · {who}</span> : null}</span>
        <span className="nymeta">#{t.channel_slug} · {timeAgo(t.updated_at)}</span>
        {t.thread_id && (
          <button className="nysettle" aria-label="Settle" title="Settle — the thread leaves Needs you; the task does not move" disabled={busyId === t.id}
            onClick={(e) => { e.stopPropagation(); onSettle(t.thread_id!, t.id); }}>Settle</button>
        )}
        <span className="nygo" aria-hidden>›</span>
      </div>
    );
  };
  const decisionRow = (g: DecisionAllRow[]) => {
    const d = g[0]!;
    const asker = agentName(d.asker_id);
    // task decisions open the task; the rest open the thread they were asked in. A legacy row
    // with neither keeps only its ✕ — there is nothing to navigate to.
    const open = () => {
      if (d.task_id) onOpenTask(d.task_id);
      else if (d.thread_id) onOpenConvo(d.channel_id, d.thread_id);
      else return;
      onClose();
    };
    return (
      <div key={d.id} className={`nyrow${leaving.has(d.id) ? ' resolving' : ''}`} role="button" tabIndex={0}
        onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); }}>
        <span className="nykind decision">decision</span>
        <span className="nytext">{asker ? <b>{asker} asks: </b> : null}{d.question}</span>
        <span className="nymeta">{g.length > 1 ? `${g.length} rooms` : `#${d.channel_slug}`} · {timeAgo(d.created_at)}</span>
        {(d.thread_id ?? d.task_thread_id) && (
          <button className="nysettle" aria-label="Settle" title="Settle — the thread leaves Needs you; the question stays open in it" disabled={busyId === d.id}
            onClick={(e) => { e.stopPropagation(); onSettle((d.thread_id ?? d.task_thread_id)!, d.id); }}>Settle</button>
        )}
        <span className="nygo" aria-hidden>›</span>
      </div>
    );
  };

  return (
    <div className="bellpop" ref={ref} role="dialog" aria-label="Needs you">
      <div className="bellhd">
        <h4>Needs you</h4>
        {count > 0 && <span className="n">{count}</span>}
        {(alertCount ?? 0) > 0 && <span className="natt">{alertCount} attention</span>}
        <span className="esc" aria-hidden>esc</span>
      </div>
      <div className="belllist">
        {alertsSection}
        {!rows.length && (
          <div className="bellclear" role="status">
            <b>All clear.</b>
            <span>Nothing needs you{flight.length ? ` — ${flight.length} moving.` : '.'}</span>
          </div>
        )}
        {rows.map((r) => (r.kind === 'task' ? taskRow(r.t) : decisionRow(r.g)))}
        {flight.length > 0 && (
          <>
            <div className="bellsect">In flight <span className="rule" /> {flight.length}</div>
            {flight.map((r) => (r.kind === 'run' ? (
              <div key={r.r.id} className="frow" role="button" tabIndex={0}
                onClick={() => { if (r.r.task_id) onOpenTask(r.r.task_id); else if (r.r.thread_id) onOpenConvo(r.r.channel_id, r.r.thread_id); onClose(); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && r.r.task_id) { onOpenTask(r.r.task_id); onClose(); } }}>
                <Orb state={orbState(r.r.step ?? '', agentRole(r.r.agent_id)) as never} label={r.r.step ?? 'working'} />
                <span className="ftitle">{plainTitle(r.r.title)}</span>
                <span className="fbeat">{agentName(r.r.agent_id) ?? 'agent'}{r.r.total > 0 ? ` · ${r.r.done} of ${r.r.total}` : ''}</span>
                <span className="fwhen">{runElapsed({ startedAt: r.r.started_at, endedAt: r.r.ended_at })}</span>
              </div>
            ) : r.kind === 'task' ? (
              <div key={r.t.id} className="frow" role="button" tabIndex={0}
                onClick={() => { onOpenTask(r.t.id); onClose(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { onOpenTask(r.t.id); onClose(); } }}>
                <span className={`chip c-${r.t.state}`}>{STATE_LABEL[r.t.state as keyof typeof STATE_LABEL] ?? r.t.state}</span>
                <span className="ftitle">#{r.t.number} · {plainTitle(r.t.title)}</span>
                <span className="fbeat">{agentName(r.t.assignee_id) ?? `#${r.t.channel_slug}`}</span>
                {/* the answered gate: say why it left the queue, so it never reads as a card that
                    quietly vanished */}
                {answered(r.t)
                  ? <span className="fwhen fanswered">you replied · {timeAgo(r.t.last_human_msg_at ?? r.t.updated_at)}</span>
                  : <span className="fwhen">{timeAgo(r.t.updated_at)}</span>}
              </div>
            ) : (
              <div key={r.c.id} className="frow" role="button" tabIndex={0}
                onClick={() => { onOpenConvo(r.c.channel_id, r.c.id); onClose(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { onOpenConvo(r.c.channel_id, r.c.id); onClose(); } }}>
                <span className="chip c-chat">chat</span>
                <span className="ftitle">{plainTitle(r.c.title)}</span>
                <span className="fbeat">#{r.c.channel_slug}</span>
                {(() => {
                  const who = liveThreads[`${r.c.channel_id}:${r.c.id}`];
                  if (who) return <span className="fwhen flive">{who} is replying…</span>;
                  if (r.c.last_author_kind === 'agent') return <span className="fwhen flive">awaiting your reply</span>;
                  return <span className="fwhen">{timeAgo(r.c.updated_at)}</span>;
                })()}
              </div>
            )))}
          </>
        )}
      </div>
      <div className="bellfoot">
        <span>Answering happens in the thread.</span>
        <button onClick={() => { onClose(); onHistory(); }}><IconSearch s={12} /> History ⌘Y</button>
      </div>
    </div>
  );
}

/** the rail's first tenant — ungated, on every surface, wearing the one notification count */
export function BellButton({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  return (
    <button className={`bellbtn${open ? ' on' : ''}`} onClick={onToggle} aria-expanded={open}
      data-tip={count ? `${count} need${count === 1 ? 's' : ''} your attention` : 'Nothing needs you'}
      aria-label={count ? `Needs you — ${count} waiting` : 'Needs you — nothing waiting'}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
        <path d="M13.7 20a2 2 0 0 1-3.4 0" />
      </svg>
      {count > 0 && <span className="belln">{count > 99 ? '99+' : count}</span>}
    </button>
  );
}
