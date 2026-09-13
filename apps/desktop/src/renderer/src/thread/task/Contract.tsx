// The task's editable contract — the title and description a human may still change before work
// starts. The Definition of Done's editor lived here too until the rail-ink round 3 (2026-09-04):
// the section that held it left the Workbench card, and the plan is where the DoD is authored and
// revised now (docs/41); the server still gates on `definition_of_done` as before.
//
// Editability is a STATE question, not a permission one: details stop at the first claim. The
// list is stated here rather than inferred. Split out of thread/TaskThread.tsx.
import { nm as nmBridge } from '../../bridge/nm';
import type { ArtifactUI, TaskRow } from '../../bridge/rows-board';

const nm = nmBridge;

export function useTaskContract(d: {
  task: TaskRow;
  arts: ArtifactUI[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  setActErr: (v: string) => void;
  titleDraft: string;
  descDraft: string;
  setEditDetails: (v: boolean) => void;
}) {
  const { task, arts, busy, setBusy, setActErr, titleDraft, descDraft, setEditDetails } = d;
const detailsEditable = ['backlog', 'todo'].includes(task.state);
const saveDetails = async () => {
  if (!nm || busy || !titleDraft.trim()) return;
  setBusy(true); setActErr('');
  try { await nm.taskUpdateDetails(task.id, { title: titleDraft.trim(), description: descDraft }); setEditDetails(false); }
  catch (e) { setActErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 110) : 'could not save the details'); }
  finally { setBusy(false); }
};

// Subtasks (docs/24): hoisted — the review/ship action bars gate on open ones.

// The review action bar (Accept/Approve · Request changes · Review Artifacts) used to dock here
// for every in_review/done task. It is GONE (2026-08-05, founder call), for three reasons that
// only became true once the surrounding surfaces landed:
//
//  · **Review Artifacts was redundant.** A thread holds many artifacts; one task-level button
//    could only open the whole validation panel. Since docs/30 every deliverable renders inline
//    and its own header opens THAT artifact full-screen — `onPreview(name)` — which is what a
//    reader actually wants. The panel is still one click away behind the `PR` tok.
//  · **The verdict is now asked for, not always offered.** The orchestrator raises a
//    `verdict` card (VerdictCard above) when a verdict is genuinely wanted, and the human's
//    click fires task.approve/task.accept from their own client — so the HUMAN_ONLY gate stays
//    structural while the card can name WHICH artifacts it means.
//  · **Nothing is stranded.** A `done` task is in the needs-you queue and in ⌘K, both derived
//    from state rather than from an agent remembering to ask.
//
// `canReview` survives: the PR drawer's own "Review Artifacts ↗" still gates on it.
const canReview = arts.length > 0 || ['in_review', 'done', 'accepted'].includes(task.state);
  return { canReview, detailsEditable, saveDetails };
}
