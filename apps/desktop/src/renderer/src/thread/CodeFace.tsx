// THE CODE FACE (coding threads, George's ruling of 2026-09-26; the side panel's own tabs since the
// side-panel round, 2026-10-03). A coding thread owns five tabs in the side panel: Changes · Files ·
// Work Plan · Checkpoints · Terminal (shell/panel-state.ts derives them, and the panel's strip draws
// them with the counts below). This is the body under that strip: the Engineering editor on the tab
// you picked, and the branch and the state in the foot. The coding thread portals it into the
// panel, the way a conversation portals its details into Overview. It was a strip of its own inside
// the Workbench card; the card retired, and the strip is the panel's.
import type { ReactElement } from 'react';
import { EngineeringEditor, type EngineeringWorkspaceTab } from '../engineering/EngineeringEditor';
import type { EngineeringSession } from '../engineering/domain';
import { IconBranch } from '../ui/icons';

const STATE_LINE: Record<string, string> = { idle: 'at rest', streaming: 'working', awaiting_approval: 'waits for you', resumable: 'paused', completed: 'complete', error: 'blocked' };

/** what the coding thread's own tabs wear in the strip */
export type CodeCounts = { changes: number; checkpoints: number; plan: boolean };

export function codeCountsOf(session: EngineeringSession): CodeCounts {
  return { changes: (session.pendingApproval?.changes ?? session.changes).length, checkpoints: session.checkpoints.length, plan: !!session.workPlan };
}

export function CodePanel({ session, tab, onTab, onSession, onRestore }: {
  session: EngineeringSession;
  tab: EngineeringWorkspaceTab;
  onTab: (tab: EngineeringWorkspaceTab) => void;
  onSession: (session: EngineeringSession) => void;
  onRestore?: ((checkpointId: string) => void) | undefined;
}): ReactElement {
  const proposed = session.pendingApproval?.changes?.length ?? 0;
  return (
    <div className="codeface">
      <EngineeringEditor session={session} onSession={onSession} tab={tab} onTab={onTab} {...(onRestore ? { onRestore } : {})} />
      <div className="dockfoot"><IconBranch s={11} /><span>{session.repo.branch}</span><span className="dockfootstate">{proposed ? `${proposed} proposed · not written yet` : session.blockedOn === 'github' ? 'waits for GitHub' : STATE_LINE[session.state] ?? session.state}</span></div>
    </div>
  );
}
