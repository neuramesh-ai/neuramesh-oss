import type { EngineeringChangeReview } from '@neuramesh/shared';
import { changeReviewLabel } from './EngineeringChangeCard';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IconBranch, IconCode, IconFile, IconHistory, IconTerm, IconThreads } from '../ui/icons';
import { TerminalView, type TermHandle } from '../wtabs/guests';
import type { EngineeringSession } from './domain';
import { restoreEngineeringCheckpoint } from './checkpoints';
import { scrollEngineeringPane } from './layout';
import { EngineeringWorkPlan } from './EngineeringWorkPlan';
import { EngineeringArtifacts } from './EngineeringArtifacts';
import { EngineeringReview } from './EngineeringReview';
import { reviewFiles } from './change-review';

export type EngineeringWorkspaceTab = 'changes' | 'artifacts' | 'files' | 'plan' | 'checkpoints' | 'terminal';

const stateLabel = (state: EngineeringSession['state']) => ({
  idle: 'Ready', streaming: 'Working', awaiting_approval: 'Needs approval', resumable: 'Paused', completed: 'Complete', error: 'Blocked',
})[state];

export function EngineeringWorkspaceTabs({ tab, onTab, changeCount = 0, disabled = false }: {
  tab: EngineeringWorkspaceTab;
  onTab: (tab: EngineeringWorkspaceTab) => void;
  changeCount?: number;
  disabled?: boolean;
}) {
  const select = (next: EngineeringWorkspaceTab) => {
    onTab(next);
    requestAnimationFrame(() => scrollEngineeringPane('.engeditor'));
  };
  return (
    <div className="engworktabs" role="group" aria-label="Code workspace">
      <button className={tab === 'changes' ? 'on' : ''} disabled={disabled} aria-pressed={tab === 'changes'} onClick={() => select('changes')}><IconCode s={12} /> Changes {changeCount ? <span>{changeCount}</span> : null}</button>
      <button className={tab === 'files' ? 'on' : ''} disabled={disabled} aria-pressed={tab === 'files'} onClick={() => select('files')}><IconFile s={12} /> Files</button>
      <button className={tab === 'artifacts' ? 'on' : ''} disabled={disabled} aria-pressed={tab === 'artifacts'} onClick={() => select('artifacts')}><IconFile s={12} /> Artifacts</button>
      <button className={tab === 'plan' ? 'on' : ''} disabled={disabled} aria-pressed={tab === 'plan'} onClick={() => select('plan')}><IconThreads s={12} /> Work Plan</button>
      <button className={tab === 'checkpoints' ? 'on' : ''} disabled={disabled} aria-pressed={tab === 'checkpoints'} onClick={() => select('checkpoints')}><IconHistory s={12} /> Checkpoints</button>
      <button className={tab === 'terminal' ? 'on' : ''} disabled={disabled} aria-label="Open a Code terminal" aria-pressed={tab === 'terminal'} onClick={() => select('terminal')}><IconTerm s={12} /> Terminal</button>
    </div>
  );
}

/**
 * Code owns one aligned workspace row: conversation identity on the left, evidence tools on the
 * right. Keeping both in the shell strip prevents the title and the editor tabs from looking like
 * unrelated headers while the resizable split remains the single alignment coordinate.
 */
export function EngineeringWorkspaceHeader({ session, sessionCount, tab, onTab, onHome, onNew }: {
  session: EngineeringSession | null;
  sessionCount: number;
  tab: EngineeringWorkspaceTab;
  onTab: (tab: EngineeringWorkspaceTab) => void;
  onHome: () => void;
  onNew: () => void;
}) {
  return (
    <div className="engworkspaceheader">
      <div className="engworkspaceidentity">
        <div>
          <b>{session?.title ?? 'Code'}</b>
          <span>{session ? <><IconBranch s={11} /> {session.repo.name} · {session.repo.branch}</> : <><IconThreads s={11} /> {sessionCount} recent thread{sessionCount === 1 ? '' : 's'}</>}</span>
        </div>
        <span className="engconvactions">
          <button className={!session ? 'on' : ''} onClick={onHome} aria-label="Recent Code threads" aria-pressed={!session} data-tip="Recent Code threads"><IconHistory s={13} /></button>
          <button onClick={onNew} aria-label="New Code thread" data-tip="New Code thread">＋</button>
        </span>
        {session ? <span className={`engstate ${session.state}`}>{session.state === 'streaming' ? null : <i />}{stateLabel(session.state)}</span> : null}
      </div>
      <EngineeringWorkspaceTabs tab={tab} onTab={onTab}
        disabled={!session} changeCount={reviewFiles(session?.pendingApproval?.changes ?? session?.changes ?? []).length} />
    </div>
  );
}

export function EngineeringEditor({ session, onSession, onRestore, restoreUnavailable, tab, selectedPath, onSelectPath, selectedPlan, selectedReview, artifacts, artifactRef, onOpenArtifact }: {
  session: EngineeringSession;
  onSession: (session: EngineeringSession) => void;
  onRestore?: (checkpointId: string) => void;
  /** no machine runs this thread: a restore must move files, so it waits for one */
  restoreUnavailable?: boolean | undefined;
  tab: EngineeringWorkspaceTab;
  onTab: (tab: EngineeringWorkspaceTab) => void;
  selectedPath?: string | null;
  selectedPlan?: string | null;
  selectedReview?: EngineeringChangeReview | null;
  artifacts?: ReactNode;
  artifactRef?: (path: string) => boolean;
  onOpenArtifact?: (path: string) => void;
  onSelectPath?: (path: string) => void;
}) {
  const files = useMemo(() => reviewFiles(selectedReview?.changes ?? session.pendingApproval?.changes ?? session.changes), [selectedReview, session.pendingApproval?.changes, session.changes]);
  const [filePath, setFilePath] = useState<string | null>(null);
  const terminal = useRef<TermHandle>(null);
  const [terminalStarted, setTerminalStarted] = useState(tab === 'terminal');
  useEffect(() => {
    if (tab !== 'terminal') return undefined;
    setTerminalStarted(true);
    const frame = requestAnimationFrame(() => terminal.current?.fit());
    return () => cancelAnimationFrame(frame);
  }, [tab]);
  useEffect(() => {
    if (filePath && !files.some((file) => file.change.path === filePath)) setFilePath(null);
  }, [files, filePath]);
  const selectFile = (path: string) => { setFilePath(path); onSelectPath?.(path); };
  const selectedFile = selectedPath ?? filePath;
  return (
    <section className="engeditor">
      <div className="engeditorbody">
        {selectedReview && (tab === 'changes' || tab === 'files') ? <div className="engreviewversion" role="status">{changeReviewLabel(selectedReview.status)} · Selected change set</div> : null}
        <button className="engeditorback" onClick={() => scrollEngineeringPane('.engconversation')} aria-label="Return to Code conversation"><IconThreads s={12} /></button>
        {tab === 'changes' && (files.length
          ? <EngineeringReview files={files} selectedPath={selectedFile} onSelectPath={selectFile} artifactRef={artifactRef} onOpenArtifact={onOpenArtifact} />
          : <div className="engeditorempty"><IconCode s={30} /><b>No changes yet</b><span>Plan first, then switch to Act. Proposed patches appear here in full before approval.</span></div>)}
        {tab === 'files' && <EngineeringReview files={files} selectedPath={selectedFile} onSelectPath={selectFile} source artifactRef={artifactRef} onOpenArtifact={onOpenArtifact} />}
        {tab === 'artifacts' && (artifacts ?? <EngineeringArtifacts threadId={session.id} revision={session.messages.length} />)}
        {tab === 'plan' && ((selectedPlan ?? session.workPlan)
          ? <EngineeringWorkPlan progress={!selectedPlan || selectedPlan === session.workPlan ? session.planProgress : null} earlier={!!selectedPlan && selectedPlan !== session.workPlan} text={(selectedPlan ?? session.workPlan)!} />
          : <div className="engeditorempty"><IconThreads s={30} /><b>No Work Plan yet</b><span>Send a request in Plan mode. The durable plan stays here when you switch to Act.</span></div>)}
        {tab === 'checkpoints' && (
          <div className="engcheckpoints">
            <div className="engcheckpointintro"><b>Workspace checkpoints</b><span>Restore files and conversation state to a known point.</span></div>
            {session.checkpoints.slice().reverse().map((checkpoint) => (
              <div className="engcheckpoint" key={checkpoint.id}>
                <span className="engcheckpointico"><IconHistory s={13} /></span>
                <span><b>{checkpoint.label}</b><small>{new Date(checkpoint.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {checkpoint.changes.length} changed files</small></span>
                <button disabled={!!restoreUnavailable || session.state === 'streaming' || session.state === 'awaiting_approval'} title={restoreUnavailable ? 'Connect a machine to restore the files.' : undefined} onClick={() => onRestore ? onRestore(checkpoint.id) : onSession(restoreEngineeringCheckpoint(session, checkpoint.id))}>Restore</button>
              </div>
            ))}
          </div>
        )}
        <div className={`engeditorterm${tab === 'terminal' ? ' on' : ''}`} aria-hidden={tab !== 'terminal'}>
          {terminalStarted ? <TerminalView ref={terminal} cwd={session.repo.root} cwdRoot={session.repo.root ?? undefined} /> : null}
        </div>
      </div>
    </section>
  );
}
