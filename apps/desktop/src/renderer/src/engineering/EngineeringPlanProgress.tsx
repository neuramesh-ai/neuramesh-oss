import { useEffect, useId, useRef, useState } from 'react';
import { stripMarkdownInline, type EngineeringSession } from '@neuramesh/shared';
import { BeatCheck } from '../task/BeatsTracker';
import './EngineeringPlanProgress.css';

/** The coding counterpart of the beats dial: explicit recorded steps, with a stable anchor. */
export function EngineeringPlanProgress({ session, onOpenPlan }: { session: EngineeringSession; onOpenPlan?: () => void }) {
  const progress = session.planProgress;
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => { setOpen(false); setPinned(false); }, [session.id, progress?.id]);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (root.current?.contains(document.activeElement)) root.current.querySelector<HTMLButtonElement>('.codeplandial')?.focus(); setOpen(false); setPinned(false); } };
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setPinned(false); } };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  if (!progress?.started || session.mode !== 'act') return null;
  const done = progress.statuses.filter(s => s === 'completed').length;
  const total = progress.statuses.length;
  const running = session.state === 'streaming';
  const current = progress.statuses.indexOf('in_progress');
  const state = done === total ? 'Plan complete' : session.state === 'awaiting_approval' ? 'Waiting for approval' : running ? 'Executing plan' : 'Plan paused';
  return <div className="codeplanprogress" ref={root} data-plan-progress data-completed={done} data-total={total}
    onMouseLeave={() => { if (!pinned && !root.current?.contains(document.activeElement)) setOpen(false); }}
    onBlur={event => { if (!pinned && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button className={`codeplandial${running && done < total ? ' running' : ''}`} type="button" aria-expanded={open} aria-controls={id}
      onMouseEnter={() => setOpen(true)} aria-label={`Plan progress: ${done} of ${total} steps complete. ${state}`} onFocus={() => setOpen(true)}
      onClick={() => { setPinned(!pinned); setOpen(!pinned); }}>
      <svg viewBox="0 0 44 44" aria-hidden><circle className="codeplantrack" cx="22" cy="22" r="19" /><circle className="codeplanarc" cx="22" cy="22" r="19" pathLength="100" strokeDasharray={`${done / total * 100} 100`} /></svg>
      <span aria-hidden><b>{done}</b>/{total}</span>
    </button>
    <span className="codeplanannounce" role="status" aria-live="polite">{done} of {total} plan steps complete. {state}{running && current >= 0 ? `: ${stripMarkdownInline(progress.plan.steps[current]!.description)}` : ''}</span>
    {open && <section id={id} className="codeplanpeek" aria-label="Plan execution steps" tabIndex={0}>
      <header><b>{state}</b><span>{done}/{total} complete</span></header>
      <ol>{progress.plan.steps.map((step, index) => {
        const status = progress.statuses[index]!;
        const label = status === 'completed' ? 'Done' : status === 'in_progress' ? (running ? 'Working' : 'Paused') : 'Pending';
        const description = stripMarkdownInline(step.label ?? step.description).replace(/\s+/g, ' ').trim();
        return <li key={index} className={status} aria-current={status === 'in_progress' ? 'step' : undefined}>
          <span className="beatind" aria-hidden>{status === 'completed' ? <BeatCheck /> : status === 'in_progress' ? <span className={running ? 'beatdot' : 'beatring'} /> : <span className="beatring" />}</span>
          <span className="codeplanstep" title={`${stripMarkdownInline(step.description)} (${step.target})`}>{description}</span><small>{label}</small>
        </li>;
      })}</ol>
      {onOpenPlan && <button className="codeplanopen" onClick={() => { setOpen(false); setPinned(false); onOpenPlan(); }}>Open full plan <span aria-hidden>↗</span></button>}
    </section>}
  </div>;
}
