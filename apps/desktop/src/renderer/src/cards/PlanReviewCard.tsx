// The plan-review card (2026-08-19, founder direction; ONE ROW since the side-panel round,
// 2026-10-03). The ‹plan:vN› marker in the message body is what summons it (ThreadMessage), the way
// ‹wb:id› summons a whiteboard snapshot and ‹task:id› a unit card. While the plan waits for your
// verdict it is one row that names it: the plan opens in the side panel by itself, with the verdict
// at its foot, and a click on the row shows it again. The verdict lives where the plan is read, so
// the card's own Approve and Request changes moved to the review tab.
//
// States mirror VerdictCard's honesty rules: the LIVE task wins over the message's snapshot — an
// approved plan renders as the compact ✓ line, a superseded version says so instead of offering a
// stale document, and a routine-born unit (approved at birth) never shows a gate.
import { planArtifactName } from '@neuramesh/shared';
import { IconReview } from '../ui/icons';
import { RefCard, usePanelShown } from '../thread/RefCard';
import type { TaskRow } from '../bridge/rows-board';

export function PlanReviewCard({ version, task, onOpenPlan, handsOff = false }: {
  version: number;
  task: TaskRow;
  /** a routine-born unit: the plan was approved by the routine, and the record says so */
  handsOff?: boolean;
  onOpenPlan: (name?: string) => void;
  /** the thread's revise door, kept for its other callers: the request now rides the review tab */
  onArmRevise?: () => void;
}) {
  const shown = usePanelShown();
  const workPlan = ((): { legs: string[]; subtasks: string[]; approach: string; version: number } | null => {
    if (!task.work_plan) return null;
    try { return JSON.parse(task.work_plan) as { legs: string[]; subtasks: string[]; approach: string; version: number }; } catch { return null; }
  })();
  if (!workPlan) return null;
  const name = planArtifactName(version);

  // a newer plan exists — this card's round is history, and a stale document must not invite a verdict
  if (workPlan.version > version) {
    return <div className="fomini" role="note">Plan v{version} was revised. See v{workPlan.version} below.</div>;
  }
  // approved (in the review tab, or born approved on a routine) — the compact record
  if (task.plan_approved_at || task.state !== 'plan_review') {
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
  return (
    <div className="refrows" role="group" aria-label={`Implementation plan v${version}`}>
      <RefCard glyph={<IconReview s={14} />} tone="plan" name={name} meta={`plan · v${version}`} waits="waits for your verdict"
        shown={shown.name === name} onOpen={() => onOpenPlan(name)} />
    </div>
  );
}
