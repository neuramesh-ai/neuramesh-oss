import { useEffect, useState } from 'react';
import { canContinueEngineering, type EngineeringSelection } from '@neuramesh/shared';
import type { WorkspaceProjectRow } from '../bridge/rows-board';
import { ProjectChip } from '../projects/ProjectChip';
import { CodingComposer } from '../thread/CodingComposer';
import { continueEngineeringInAct, dismissEngineeringModeHandoff, setEngineeringMode, setEngineeringPermission, type EngineeringSession, type PermissionCategory } from './domain';
import type { EngineeringAttachmentUpload } from './attachments';
import { IconCode } from '../ui/icons';

function ModeHandoffCard({ session, disabled, onContinue, onDismiss }: {
  session: EngineeringSession; disabled: boolean; onContinue: () => void; onDismiss: () => void;
}) {
  const handoff = session.pendingModeHandoff;
  const current = canContinueEngineering(session) ? handoff : null;
  const [shown, setShown] = useState(current);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (current) { setShown(current); setClosing(false); return undefined; }
    if (!shown) return undefined;
    setClosing(true);
    const timer = window.setTimeout(() => { setShown(null); setClosing(false); }, 140);
    return () => window.clearTimeout(timer);
  }, [current, shown]);
  if (!shown || !current) return null;
  const command = shown.category === 'command';
  return (
    <section className="engmodegate" data-state={closing ? 'closing' : 'open'} aria-label="Continue in Act mode">
      <div className="engmodegatetop">
        <span className="engmodegateico"><IconCode s={14} /></span>
        <span><b>{command ? 'Ready to continue' : 'Ready to implement'}</b><small>{command ? 'The proposed command needs Act mode.' : 'Review the proposed work, then continue in Act.'}</small></span>
      </div>
      <div className="engmodegateactions">
        <button className="btn sm" disabled={disabled} onClick={onDismiss}>Keep planning</button>
        <button className="btn primary sm" disabled={disabled} onClick={onContinue}>Continue in Act</button>
      </div>
    </section>
  );
}

export function EngineeringComposer({ session, onSession, onSend, onMode, onPermission, onConfigure, onContinueInAct, onDismissModeHandoff, machineChip = null, projects = [], project = null, onProject, onNewProject, plan = 'free', onUpgrade = () => {}, disabled = false }: {
  session: EngineeringSession;
  onSession: (session: EngineeringSession) => void;
  onSend: (prompt: string, uploads: EngineeringAttachmentUpload[]) => void;
  onMode?: (mode: 'plan' | 'act') => void;
  onPermission?: (category: PermissionCategory, value: boolean) => void;
  onConfigure?: (selection: EngineeringSelection) => void;
  onContinueInAct?: () => void;
  onDismissModeHandoff?: () => void;
  /** the machine chip (rule D9) — WHERE this session runs, the composer's third knob; the caller builds it because it needs the fleet */
  machineChip?: React.ReactNode;
  projects?: WorkspaceProjectRow[];
  project?: WorkspaceProjectRow | null;
  onProject?: (id: string) => void;
  onNewProject?: (origin: { x: number; y: number } | null) => void;
  plan?: string;
  onUpgrade?: (reason: string) => void;
  disabled?: boolean;
}) {
  const locked = disabled || session.state === 'streaming' || session.state === 'awaiting_approval';
  return <div className="engcomposewrap">
    <ModeHandoffCard session={session} disabled={locked}
      onContinue={() => onContinueInAct ? onContinueInAct() : onSession(continueEngineeringInAct(session))}
      onDismiss={() => onDismissModeHandoff ? onDismissModeHandoff() : onSession(dismissEngineeringModeHandoff(session))} />
    <CodingComposer session={session} plan={plan} onUpgrade={onUpgrade} onSend={onSend} disabled={disabled}
      machineChip={() => machineChip}
      onMode={(mode) => onMode ? onMode(mode) : onSession(setEngineeringMode(session, mode))}
      onPermission={(category, value) => onPermission ? onPermission(category, value) : onSession(setEngineeringPermission(session, category, value))}
      onConfigure={(selection) => onConfigure ? onConfigure(selection) : onSession({ ...session, agentId: selection.agentId, modelOverride: selection.modelId, reasoningEffort: selection.reasoningEffort })}
      contextChips={project ? <ProjectChip projects={projects} active={project} disabled={locked || !onProject} onSwitch={(id) => onProject?.(id)} onNew={onNewProject ?? (() => {})} /> : null} />
  </div>;
}
