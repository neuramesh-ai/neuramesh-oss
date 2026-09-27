// THE CODE FACE OF THE WORKBENCH (coding threads, George's ruling of 2026-09-26: "the workbench
// might be the right place for the tabs for changes, files, checkpoints, workplan… and the
// workbench should be open automatically for code tasks"). A coding thread portals this into the
// Workbench card's slot, the way a conversation portals its details: a tab strip — Changes · Work
// Plan · Checkpoints · Terminal — over the Engineering editor's pane, and the branch in the foot.
// Files is the editor's own pane, and the Workbench hides its Files drawer under a coding thread
// (George: "remove the old files section on the workbench, and use our files tab from code"), so
// there is still one file tree (docs/36 §3.3).
import type { ReactElement } from 'react';
import { EngineeringEditor, type EngineeringWorkspaceTab } from '../engineering/EngineeringEditor';
import type { EngineeringSession } from '../engineering/domain';
import { IconBranch, IconCode, IconFile, IconHistory, IconTerm, IconThreads } from '../ui/icons';

const STATE_LINE: Record<string, string> = { idle: 'at rest', streaming: 'working', awaiting_approval: 'waits for you', resumable: 'paused', completed: 'complete', error: 'blocked' };

export function CodeFace({ session, tab, onTab, onSession, onRestore }: {
  session: EngineeringSession;
  tab: EngineeringWorkspaceTab;
  onTab: (tab: EngineeringWorkspaceTab) => void;
  onSession: (session: EngineeringSession) => void;
  onRestore?: ((checkpointId: string) => void) | undefined;
}) {
  const changes = (session.pendingApproval?.changes ?? session.changes).length;
  const proposed = session.pendingApproval?.changes?.length ?? 0;
  const btn = (id: EngineeringWorkspaceTab, label: string, icon: ReactElement, n?: string | number | null) => (
    <button className={tab === id ? 'on' : ''} aria-pressed={tab === id} onClick={() => onTab(id)}>{icon} {label}{n != null && n !== '' ? <span>{n}</span> : null}</button>
  );
  return (
    <div className="codeface">
      {/* the tabs scroll in their own lane; the gutter on the right is where the card's expand and close controls live, behind a hairline, so a tab never passes under them */}
      <div className="codefacetabs">
        <div className="engworktabs codefacescroll" role="tablist" aria-label="The coding thread's work">
          {btn('changes', 'Changes', <IconCode s={12} />, changes || null)}
          {btn('files', 'Files', <IconFile s={12} />)}
          {btn('plan', 'Work Plan', <IconThreads s={12} />, session.workPlan ? '✓' : null)}
          {btn('checkpoints', 'Checkpoints', <IconHistory s={12} />, session.checkpoints.length || null)}
          {btn('terminal', 'Terminal', <IconTerm s={12} />)}
        </div>
        <span className="codefacegutter" aria-hidden />
      </div>
      <EngineeringEditor session={session} onSession={onSession} tab={tab} onTab={onTab} {...(onRestore ? { onRestore } : {})} />
      <div className="dockfoot"><IconBranch s={11} /><span>{session.repo.branch}</span><span className="dockfootstate">{proposed ? `${proposed} proposed · not written yet` : STATE_LINE[session.state] ?? session.state}</span></div>
    </div>
  );
}
