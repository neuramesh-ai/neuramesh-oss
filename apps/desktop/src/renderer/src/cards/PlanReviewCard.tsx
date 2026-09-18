// The plan-review card (2026-08-19, founder direction): approve / request-changes live as a
// thread-native card — the question-card idiom, richer. The embedded preview of the plan document
// comes first and the response pills sit underneath it (one component — read, then rule); the ↗
// icon top-right opens the full document in its own tab, unnamed because the message prose right
// above the card already names the file. The ‹plan:vN› marker in the message body is what summons
// it (ThreadMessage), the way ‹wb:id› summons a whiteboard snapshot and ‹task:id› a unit card.
//
// States mirror VerdictCard's honesty rules: the LIVE task wins over the message's snapshot —
// an approved plan renders as the compact ✓ line, a superseded version says so instead of
// showing a stale document, and a routine-born unit (approved at birth) never shows pills.
import { useState } from 'react';
import { executionLegLabel, planArtifactName, renderPlanMarkdown } from '@neuramesh/shared';
import { nm } from '../bridge/nm';
import { Md } from '../md/Md';
import type { TaskRow } from '../bridge/rows-board';

export function PlanReviewCard({ version, task, onOpenPlan, onArmRevise, handsOff = false }: {
  version: number;
  task: TaskRow;
  /** a routine-born unit: the plan was approved by the routine, and the record says so */
  handsOff?: boolean;
  onOpenPlan: (name?: string) => void;
  onArmRevise: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const workPlan = ((): { legs: string[]; subtasks: string[]; approach: string; version: number } | null => {
    if (!task.work_plan) return null;
    try { return JSON.parse(task.work_plan) as { legs: string[]; subtasks: string[]; approach: string; version: number }; } catch { return null; }
  })();
  if (!workPlan) return null;
  const name = planArtifactName(version);

  // a newer plan exists — this card's round is history, and a stale document must not invite a verdict
  if (workPlan.version > version) {
    return <div className="fomini" role="note">plan v{version} was revised — see v{workPlan.version} below.</div>;
  }
  // approved (by the human's pill here, or born approved on a routine) — the compact record
  if (sent || task.plan_approved_at || task.state !== 'plan_review') {
    const how = task.plan_approved_at && handsOff ? 'auto-approved · routine' : task.state === 'plan_review' || task.plan_approved_at ? 'approved' : `moved on (${task.state})`;
    return (
      <div className="focard sent">
        <span className="fotick">✓</span>
        <span className="foq">Implementation plan v{version}</span>
        <span className="foa">{how}</span>
        <button className="planopenlink" onClick={() => onOpenPlan(name)}>open {name}</button>
      </div>
    );
  }

  const approve = async (): Promise<void> => {
    if (!nm || busy) return;
    setBusy(true); setErr('');
    try {
      // as the HUMAN, from their own client — the click IS the sign-off (approve_plan is
      // HUMAN_ONLY server-side, so an agent rendering this card could never press it)
      await nm.taskAction('task.approve_plan', task.id);
      setSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'approve failed');
    } finally {
      setBusy(false);
    }
  };

  const doc = renderPlanMarkdown({
    number: task.number, title: task.title, kind: task.kind,
    legs: workPlan.legs, subtasks: workPlan.subtasks, approach: workPlan.approach, version,
  });

  return (
    <div className="plancard" role="group" aria-label={`Implementation plan v${version}`}>
      <div className="plancardhead">
        <span className="plangatek">implementation plan · v{version}</span>
        <span className="planlegs">
          {[...workPlan.legs, 'accept'].map((l) => (
            <span key={l} className={`jlegchip jl-${l}`}>{l === 'accept' ? 'accept · you' : l === 'build' ? executionLegLabel(task.kind).toLowerCase() : l}</span>
          ))}
        </span>
        <button className="planopen" onClick={() => onOpenPlan(name)} aria-label={`Open ${name} in a tab`} title={`Open in tab — ${name}`}>↗</button>
      </div>
      <div className="plancanvas" onDoubleClick={() => onOpenPlan(name)}>
        <Md text={doc} />
      </div>
      <div className="plancardpills">
        <button className="btn primary" disabled={busy} onClick={() => void approve()} title="approve the plan — subtasks are minted and the declared legs start">✓ Approve plan</button>
        <button className="btn" disabled={busy} onClick={onArmRevise} title="send the plan back with your feedback — arms the reply box below">Request changes</button>
        {err && <span className="acterr">{err}</span>}
      </div>
    </div>
  );
}
