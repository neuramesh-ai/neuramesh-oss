// Subtasks (docs/24) — companion work riding THIS task: the dock section with the boss
// check-off (finish from anywhere), cancel, and the add box.
//
// A parent refuses submit/accept/approve_ship_plan/execute_ship while any subtask is open
// (SUBTASKS_PENDING, server-side) — the tok and the warm state here only SHOW that gate.
// Split out of thread/TaskThread.tsx; the same JSX values, built in the same order.
import { useState } from 'react';
import { nm as nmBridge } from '../../bridge/nm';
import type { TaskRow } from '../../bridge/rows-board';
import type { AgentRow } from '../../bridge/rows-crew';

const nm = nmBridge;

export function useSubtasks(d: {
  task: TaskRow;
  subtasks?: TaskRow[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  actErr: string;
  setActErr: (v: string) => void;
  agents: AgentRow[];
  act: (type: string, fb?: string, opts?: { silentThread?: boolean }) => Promise<void>;
  onOpenTask?: (id: string) => void;
}) {
  const { task, subtasks, busy, setBusy, actErr, setActErr, agents, act, onOpenTask } = d;
  const subs = subtasks ?? [];
  const openSubs = subs.filter((x) => x.state !== 'done' && x.state !== 'closed');
// Subtasks (docs/24): companion work riding THIS task — section in the dock
// with the boss check-off (finish from anywhere), cancel, and an add box.
const [subAddOpen, setSubAddOpen] = useState(false);
const [subAddTitle, setSubAddTitle] = useState('');
const finishSub = async (id: string) => {
  if (!nm || busy) return;
  setBusy(true); setActErr('');
  try { await nm.taskAction('task.finish_subtask', id); }
  catch (e) { setActErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 110) : 'could not finish the subtask'); }
  finally { setBusy(false); }
};
const cancelSub = async (id: string) => {
  if (!nm || busy) return;
  setBusy(true); setActErr('');
  try { await nm.taskAction('task.cancel', id); }
  catch (e) { setActErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 110) : 'could not cancel the subtask'); }
  finally { setBusy(false); }
};
const addSub = async () => {
  if (!nm || busy || !subAddTitle.trim()) return;
  setBusy(true); setActErr('');
  try { await nm.subtaskAdd(task.id, subAddTitle.trim()); setSubAddTitle(''); setSubAddOpen(false); }
  catch (e) { setActErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 110) : 'could not add the subtask'); }
  finally { setBusy(false); }
};
const subsGateOpen = ['in_progress', 'done', 'ship_review', 'releasing', 'in_review', 'todo', 'blocked'].includes(task.state);
const doneSubs = subs.length - openSubs.length;
// the subtasks tok shows wherever the old card did; it WARMS when open subtasks are
// actually holding an armed gate (review/ship), so the count asks for you before you click
const subTok = !task.parent_task_id && (subs.length > 0 || subsGateOpen) && !['accepted', 'closed', 'backlog'].includes(task.state);
const subsWarm = openSubs.length > 0 && ['in_review', 'done', 'ship_review', 'releasing'].includes(task.state);
const subRows = (
  <>
    {subs.map((x) => {
      const done = x.state === 'done' || x.state === 'closed';
      const who = agents.find((a) => a.id === x.assignee_id || a.id === x.offered_agent_id)?.name ?? null;
      return (
        <div key={x.id} className={`subrow2${done ? ' done' : ''}`}>
          <button className="shiptick" disabled={busy || done} title={done ? undefined : 'check it off (the boss override) — the assignee also finishes it on delivery'} onClick={() => void finishSub(x.id)}>
            {done ? (
              <svg className="ckc" viewBox="0 0 17 17"><circle cx="8.5" cy="8.5" r="8" /><path d="M5.4 8.9l2.1 2.1 4-4.6" /></svg>
            ) : x.state === 'in_progress' ? <span className="sactive" /> : <span className="beatring" />}
          </button>
          {/* the row IS the door (founder, rerun round): a subtask's acceptance card lives in
              its OWN thread now, so id+title open it — before this, only "Open parent" existed
              and a rail row was dead weight the human had to route around */}
          <button className="subopen" title={`open #${x.number}`} onClick={() => onOpenTask?.(x.id)}>
            <span className="sid">#{x.number}</span>
            <span className="ti" title={x.title}>{x.title}</span>
          </button>
          {who && <span className="who">{who}</span>}
          {!done && <button className="subx" title="cancel this subtask" disabled={busy} onClick={() => void cancelSub(x.id)}>✕</button>}
        </div>
      );
    })}
    <div className="subfoot">
      {subAddOpen ? (
        <div className="tbounce" style={{ margin: 0, flex: 1, minWidth: 220 }}>
          <input value={subAddTitle} onChange={(e) => setSubAddTitle(e.target.value)} placeholder="companion work — rides this thread; gates the next step" autoFocus
            onKeyDown={(e) => e.key === 'Enter' && subAddTitle.trim() && void addSub()} />
          <button className="btn sm" disabled={busy || !subAddTitle.trim()} onClick={() => void addSub()}>Add</button>
        </div>
      ) : (
        <button className="btn ghost sm" disabled={busy} onClick={() => setSubAddOpen(true)}>+ Add subtask</button>
      )}
      {openSubs.length > 0 && <span className="sublock">⌀ submit · accept · ship stay locked while a subtask is open</span>}
    </div>
  </>
);

// this row IS a subtask: a lean dock — finish/cancel + a jump to the parent
// A done subtask docks only the jump home (founder, rerun round: the "no accept of its own"
// disclaimer lectured FSM internals at a human who just wanted the work — the deliverable's
// own card in this thread is the acceptance surface, and the parent link is the way back).
const subtaskDone = task.parent_task_id && ['done', 'closed'].includes(task.state) && onOpenTask ? (
  <div className="tactions">
    <button className="btn ghost" onClick={() => onOpenTask(task.parent_task_id!)}>Open parent ↗</button>
  </div>
) : null;
const subtaskActions = task.parent_task_id && !['done', 'closed'].includes(task.state) ? (
  <div className="tactions">
    <button className="btn accept" disabled={busy} onClick={() => void finishSub(task.id)}>✓ Mark done</button>
    <button className="btn" disabled={busy} onClick={() => void act('task.cancel')}>Cancel</button>
    {onOpenTask && <button className="btn ghost" onClick={() => onOpenTask(task.parent_task_id!)}>Open parent ↗</button>}
    {actErr && <span className="acterr">{actErr}</span>}
  </div>
) : null;
  return { subs, openSubs, doneSubs, subRows, subTok, subsWarm, subtaskActions, subtaskDone };
}
