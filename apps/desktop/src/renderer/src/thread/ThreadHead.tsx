// THE TASK THREAD'S HEAD ROW — where you are, what phase it is in, and the way out.
//
// The first zone of the task panel (docs/25): the crumb leads the header, exactly as it does on
// a chat session (docs/35 §3.4), then the phase spectrum, then close. Split out in the
// state-ownership round because it reads NINE things — the least-coupled zone in a component
// that declares 127 bindings, which is what made it the one worth taking.
import { PhaseRing } from '../task/BeatsTracker';
import { STATE_LABEL } from '../task/labels';
import { IconActivity, IconArrowUp, IconPause, IconTerm, IconTrash } from '../ui/icons';
import { KindChip, ThreadCrumb, ThreadSettleBtn, ThreadStatusChip, type HeadStatus } from './parts';
import type { TaskRow } from '../bridge/rows-board';
import type { JourneyLeg } from '@neuramesh/shared';
import type { Dispatch, SetStateAction } from 'react';

export function ThreadHead({ act, back, blocking, busy, channelSlug, crumbProject, editDetails, isContent, marks, onClose, onOpenTerminal, onSettle, onViewLogs, peek, setBlocking, setClosing, spectrumLegs, task }: {
  /** what this task's thread is doing, and the act its stamp offers (shell/rowstatus.ts) */
  marks?: HeadStatus | null;
  onSettle?: (threadId: string) => void;
  /** issue a command against this task — the panel's one write path (thread/task/Data.ts) */
  act: (type: string, fb?: string, opts?: { silentThread?: boolean }) => Promise<unknown>;
  blocking: boolean;
  setBlocking: Dispatch<SetStateAction<boolean>>;
  setClosing: Dispatch<SetStateAction<boolean>>;
  // ── the panel's own props, passed straight through ─────────────────────────────────────────
  task: TaskRow;
  channelSlug: string;
  crumbProject?: { name: string; logo_url?: string | null } | null;
  peek?: { onFull: () => void };
  back: string;
  onClose: () => void;
  onOpenTerminal?: (t: TaskRow) => void;
  onViewLogs: () => void;
  busy: boolean;
  editDetails: boolean;
  isContent: boolean;
  /** the phase spectrum's legs — derived, never stored (shared journeyFor) */
  spectrumLegs: JourneyLeg[];
}) {
  return (
  <div className="thead">
    {/* the crumb leads the header — same anatomy as a chat session (docs/35 §3.4): this
        surface replaced the list it was opened from, so it names the way back.
        IN A TASK TAB (the side-panel round, 2026-10-03; the task peek of 2026-08-10 before it)
        there is nothing to go back TO: the thread it opened from is still on screen beside it.
        So the crumb's seat carries the forward door instead, and the tab strip's ✕ is the close. */}
    {peek ? (
      <span className="pkctl">
        <button className="pkfull" title="Open the task on the whole sheet" onClick={peek.onFull}>Open the task ›</button>
      </span>
    ) : (
      <button className="scrumb" title="back — Esc" aria-label={`Back to ${back}`} onClick={onClose}>‹ {back}</button>
    )}
    {/* the same place-crumb the chat header carries — project › #room, on the LEFT with the
        other wayfinding. A task thread knew its channel and either told nobody or wedged it
        among the far-right icon buttons; two identical headers now answer "where am I" the
        same way (George, 2026-08-09). */}
    {/* PEEK SCALE (docs/25 §1b): the project crumb is wayfinding for a surface you NAVIGATED
        to — a peek was opened from the thread beside it, so "where am I" is already answered
        on screen. The room still shows, because which room a task lives in is a fact about
        the task; the project name is the part that was only ever repeating the frame. */}
    {peek ? <span className="pkroom">#{channelSlug}</span> : <ThreadCrumb project={crumbProject} slug={channelSlug} />}
    <span className="tid">#{task.number}</span>
    <span className={`chip c-${task.state}`}>{STATE_LABEL[task.state]}</span>
    <KindChip kind={task.kind} />
    {/* the journey rides WITH the state chip: the chip says where you are in the FSM,
        the ring says where you are in the journey — one status cluster, two resolutions */}
    <PhaseRing legs={spectrumLegs} />
    {/* the thread's own word, beside the task's (settle round): the state chip says where the WORK
        is, this says whether it waits on you — they are different questions and always were */}
    <ThreadStatusChip head={marks} />
    {/* …and the header's ACTIONS mostly stay on the full surface: opening a terminal in the
        worktree or trawling activity are "I am working this now" moves, which is what
        `Open full ›` is one click away for. CLOSING THE TASK IS THE EXCEPTION (George live,
        2026-08-10) — deciding a task shouldn't exist is exactly the call you make while
        reading it beside the conversation that spawned it, and it keeps its type-to-confirm
        modal, so a glance can't delete anything by accident. Gated here rather than hidden
        in CSS: a control that exists but cannot be seen is the worse of the two bugs. */}
    <div className="theadact">
      {/* SETTLE, leading the cluster (settle round, 2026-09-09): it is not an accept — the board
          does not move and the pull request stays open. It only says you have seen this, so the
          thread leaves the needs-you queue. Merging still takes your word in the thread. */}
      <ThreadSettleBtn head={marks} onSettle={onSettle} />
      {!peek && task.state === 'in_progress' && (
        <button className={`navpin${blocking ? ' on' : ''}`} title="block task — pause it so it can be closed" onClick={() => setBlocking((b) => !b)}><IconPause s={14} /></button>
      )}
      {/* a parked idea's one move — a header action by the delete/activity buttons,
          not a gate card over a composer (a backlog item has no surface to gate) */}
      {!peek && task.state === 'backlog' && !editDetails && (
        <button className="navpin" disabled={busy} title="promote to To Do — the orchestrator triages it from there" onClick={() => void act('task.promote')}><IconArrowUp s={14} /></button>
      )}
      {['backlog', 'todo', 'designing', 'design_review', 'planning', 'plan_review', 'blocked', 'in_progress', 'in_review', 'done'].includes(task.state) && (
        <button className="navpin danger" title={task.state === 'in_progress' ? 'stop the agent & close this task' : 'close this task'} onClick={() => setClosing(true)}><IconTrash s={14} /></button>
      )}
      {/* the terminal is a WAY IN, not a view of the task — it belongs with the other
          openers here, next to activity, instead of holding a slot in a tab strip */}
      {!peek && !isContent && (() => { const avail = !!task.branch || ['in_review', 'done', 'accepted'].includes(task.state); return (
        <button className="navpin" disabled={!avail} title={avail ? 'open a terminal in this task’s worktree, in the side panel' : 'no local workspace yet — opens once an agent runs this task here'} aria-label="Open a terminal in this task’s worktree" onClick={() => onOpenTerminal?.(task)}><IconTerm s={14} /></button>
      ); })()}
      {!peek && <button className="navpin" title="agent activity for this task" onClick={onViewLogs}><IconActivity s={14} /></button>}
      {/* the Workbench toggle retired with the card (the side-panel round, 2026-10-03): the task's
          details are the side panel's Overview tab, and the panel's one switch is the frame top's */}
    </div>
  </div>
  );
}
