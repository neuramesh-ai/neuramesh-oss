import { useEffect, useMemo, useRef, useState } from 'react';
import { highlightCode } from '../lib/highlight';
import { Md } from '../md/Md';
import { IconBranch, IconCheck, IconCode, IconFile, IconHistory, IconSearch, IconTerm, IconThreads } from '../ui/icons';
import { DiffView } from '../views/docpreview';
import { TerminalView, type TermHandle } from '../wtabs/guests';
import type { EngineeringSession } from './domain';
import { combinedDiff, restoreEngineeringCheckpoint } from './checkpoints';
import { scrollEngineeringPane } from './layout';
import { engineeringPlanItems } from './activity';

export type EngineeringWorkspaceTab = 'changes' | 'files' | 'plan' | 'checkpoints' | 'terminal';

const stateLabel = (state: EngineeringSession['state']) => ({
  idle: 'Ready', streaming: 'Working', awaiting_approval: 'Needs approval', resumable: 'Paused', completed: 'Complete', error: 'Blocked',
})[state];

function EngineeringWorkPlan({ text }: { text: string }) {
  const items = engineeringPlanItems(text);
  const complete = items.filter((item) => item.status === 'complete').length;
  if (!items.length) return <div className="engplan plBody"><Md text={text} /></div>;
  return (
    <div className="engplan">
      <section className="engplantasks" aria-label="Work plan steps">
        <header><span><IconThreads s={13} /><b>Work plan</b></span><em>{complete ? `${complete} of ${items.length} complete` : `${items.length} steps`}</em></header>
        <ol>
          {items.map((item, index) => (
            <li className={item.status} key={`${index}-${item.text}`}>
              <span className="engplanmarker">{item.status === 'complete' ? <IconCheck s={12} /> : <i />}</span>
              <span><small>Step {index + 1}</small><b>{item.text}</b></span>
            </li>
          ))}
        </ol>
      </section>
      <details className="engplansource"><summary>Full plan and guardrails</summary><div className="plBody"><Md text={text} /></div></details>
    </div>
  );
}

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
        disabled={!session} changeCount={(session?.pendingApproval?.changes ?? session?.changes ?? []).length} />
    </div>
  );
}

export function EngineeringEditor({ session, onSession, onRestore, tab, onTab }: {
  session: EngineeringSession;
  onSession: (session: EngineeringSession) => void;
  onRestore?: (checkpointId: string) => void;
  tab: EngineeringWorkspaceTab;
  onTab: (tab: EngineeringWorkspaceTab) => void;
}) {
  const visibleChanges = useMemo(() => session.pendingApproval?.changes ?? session.changes, [session.pendingApproval?.changes, session.changes]);
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
    if (session.pendingApproval?.changes?.length) onTab('changes');
    if (filePath && !visibleChanges.some((change) => change.path === filePath)) setFilePath(null);
  }, [session.pendingApproval?.changes?.length, session.pendingApproval?.id, visibleChanges, filePath, onTab]);
  const file = visibleChanges.find((change) => change.path === filePath) ?? visibleChanges[0] ?? null;
  const source = file?.after || file?.before || '';
  const highlighted = useMemo(() => file ? highlightCode(source, file.path) : '', [file, source]);
  return (
    <section className="engeditor">
      <div className="engeditorbody">
        <button className="engeditorback" onClick={() => scrollEngineeringPane('.engconversation')} aria-label="Return to Code conversation"><IconThreads s={12} /></button>
        {tab === 'changes' && (visibleChanges.length
          ? <DiffView text={combinedDiff(visibleChanges)} />
          : <div className="engeditorempty"><IconCode s={30} /><b>No changes yet</b><span>Plan first, then switch to Act. Proposed patches appear here in full before approval.</span></div>)}
        {tab === 'files' && (
          <div className="engfiles">
            <aside>
              <div className="engfileshead"><IconSearch s={12} /> Session files</div>
              {visibleChanges.map((change) => <button key={change.path} className={(file?.path === change.path ? 'on ' : '') + change.kind} onClick={() => setFilePath(change.path)}><i>{change.kind === 'added' ? 'A' : change.kind === 'deleted' ? 'D' : 'M'}</i><span>{change.path}</span></button>)}
              {!visibleChanges.length && <small>No files opened by this session.</small>}
            </aside>
            <div className="engsource">
              {file ? <><div className="engsourcehead"><b>{file.path}</b><span>{session.pendingApproval?.changes ? 'Proposed · read-only' : 'Applied by Engineering'}</span></div><pre><code dangerouslySetInnerHTML={{ __html: highlighted + '\n' }} /></pre></>
                : <div className="engeditorempty"><IconFile s={28} /><b>No session file selected</b><span>Files created or changed by this session will be available here.</span></div>}
            </div>
          </div>
        )}
        {tab === 'plan' && (session.workPlan
          ? <EngineeringWorkPlan text={session.workPlan} />
          : <div className="engeditorempty"><IconThreads s={30} /><b>No Work Plan yet</b><span>Send a request in Plan mode. The durable plan stays here when you switch to Act.</span></div>)}
        {tab === 'checkpoints' && (
          <div className="engcheckpoints">
            <div className="engcheckpointintro"><b>Workspace checkpoints</b><span>Restore files and conversation state to a known point.</span></div>
            {session.checkpoints.slice().reverse().map((checkpoint) => (
              <div className="engcheckpoint" key={checkpoint.id}>
                <span className="engcheckpointico"><IconHistory s={13} /></span>
                <span><b>{checkpoint.label}</b><small>{new Date(checkpoint.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {checkpoint.changes.length} changed files</small></span>
                <button disabled={session.state === 'streaming' || session.state === 'awaiting_approval'} onClick={() => onRestore ? onRestore(checkpoint.id) : onSession(restoreEngineeringCheckpoint(session, checkpoint.id))}>Restore</button>
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
