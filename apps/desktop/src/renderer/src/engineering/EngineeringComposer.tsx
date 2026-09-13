import { useEffect, useState } from 'react';
import type { WorkspaceProjectRow } from '../bridge/rows-board';
import { AttachButton, AttachTray } from '../composer/attach';
import { ProjectChip } from '../projects/ProjectChip';
import {
  PERMISSION_LABELS,
  continueEngineeringInAct,
  dismissEngineeringModeHandoff,
  effectivePermission,
  setEngineeringMode,
  setEngineeringModel,
  setEngineeringPermission,
  type EngineeringSession,
  type PermissionCategory,
} from './domain';
import { EngineeringModelSelector } from './EngineeringModelSelector';
import { useEngineeringAttachments, type EngineeringAttachmentUpload } from './attachments';
import { AutoTextarea } from '../ui/AutoTextarea';
import { IconCheck, IconChevron, IconCode, IconLock, IconSend, IconSettings } from '../ui/icons';

const PERMISSIONS = Object.keys(PERMISSION_LABELS) as PermissionCategory[];

const permissionSummary = (session: EngineeringSession) => {
  const names = PERMISSIONS.filter((category) => session.permissions[category]).map((category) => PERMISSION_LABELS[category].label.replace(/ files| content| servers/, ''));
  return names.length ? `Prefer auto: ${names.join(', ')}` : 'Ask before every action';
};

function PermissionsMenu({ session, onChange, onClose }: {
  session: EngineeringSession; onChange: (category: PermissionCategory, value: boolean) => void; onClose: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [onClose]);
  return (
    <>
      <button className="engpermveil" aria-label="Close permissions" onClick={onClose} />
      <div className="engpermpop" role="dialog" aria-label="Session permissions">
        <div className="engpermhead"><span><IconLock s={14} /> Session permissions</span><small>Changes apply to this thread only</small></div>
        {PERMISSIONS.map((category) => {
          const allowed = session.policy[category];
          const effective = effectivePermission(session.mode, category, session.permissions, session.policy);
          return (
            <button key={category} className="engpermrow" role="checkbox" aria-checked={session.permissions[category]} disabled={!allowed}
              onClick={() => onChange(category, !session.permissions[category])}>
              <span className={`engcheckbox${session.permissions[category] ? ' on' : ''}`}>{session.permissions[category] ? <IconCheck s={11} /> : null}</span>
              <span><b>{PERMISSION_LABELS[category].label}</b><small>{PERMISSION_LABELS[category].detail}</small></span>
              <em>{effective === 'blocked' ? 'Blocked by mode' : effective === 'auto' ? 'Prefer auto' : 'Ask'}</em>
            </button>
          );
        })}
        <div className="engpermfoot">These are thread preferences. Machine workspace policy and its sandbox can still ask or block.</div>
      </div>
    </>
  );
}

function ModeHandoffCard({ session, disabled, onContinue, onDismiss }: {
  session: EngineeringSession; disabled: boolean; onContinue: () => void; onDismiss: () => void;
}) {
  const handoff = session.pendingModeHandoff;
  const current = handoff && session.mode === 'plan' && session.state !== 'streaming' && session.state !== 'awaiting_approval' ? handoff : null;
  const [shown, setShown] = useState(current);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (current) { setShown(current); setClosing(false); return undefined; }
    if (!shown) return undefined;
    setClosing(true);
    const timer = window.setTimeout(() => { setShown(null); setClosing(false); }, 140);
    return () => window.clearTimeout(timer);
  }, [current, shown]);
  if (!shown) return null;
  const command = shown.category === 'command';
  return (
    <section className="engmodegate" data-state={closing ? 'closing' : 'open'} aria-label="Continue in Act mode">
      <div className="engmodegatetop">
        <span className="engmodegateico"><IconCode s={14} /></span>
        <span><b>{command ? 'Ready to continue' : 'Ready to implement'}</b><small>{command ? 'Continue in Act to apply the plan and run its checks.' : 'The plan is complete. Continue in Act to apply it.'}</small></span>
      </div>
      <div className="engmodegateactions">
        <button className="btn sm" disabled={disabled} onClick={onDismiss}>Keep planning</button>
        <button className="btn primary sm" disabled={disabled} onClick={onContinue}>Continue in Act</button>
      </div>
    </section>
  );
}

export function EngineeringComposer({ session, onSession, onSend, onMode, onPermission, onModel, onContinueInAct, onDismissModeHandoff, machineChip = null, projects = [], project = null, onProject, onNewProject, plan = 'free', onUpgrade = () => {}, disabled = false }: {
  session: EngineeringSession;
  onSession: (session: EngineeringSession) => void;
  onSend: (prompt: string, uploads: EngineeringAttachmentUpload[]) => void;
  onMode?: (mode: 'plan' | 'act') => void;
  onPermission?: (category: PermissionCategory, value: boolean) => void;
  onModel?: (modelId: string | null) => void;
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
  const [draft, setDraft] = useState('');
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const attachments = useEngineeringAttachments(plan, onUpgrade);
  const controlsLocked = disabled || session.state === 'streaming' || session.state === 'awaiting_approval';
  useEffect(() => { if (controlsLocked) setPermissionsOpen(false); }, [controlsLocked]);
  const send = () => {
    if (!draft.trim() || controlsLocked || attachments.busy) return;
    onSend(draft, attachments.uploads());
    setDraft('');
    attachments.reset();
  };
  return (
    <div className="engcomposewrap">
      <ModeHandoffCard session={session} disabled={controlsLocked}
        onContinue={() => onContinueInAct ? onContinueInAct() : onSession(continueEngineeringInAct(session))}
        onDismiss={() => onDismissModeHandoff ? onDismissModeHandoff() : onSession(dismissEngineeringModeHandoff(session))} />
      <div className="engcompose cbox">
        <AttachTray items={attachments.items} onRemove={attachments.remove} />
        <AutoTextarea value={draft} onChange={setDraft} maxRows={7}
          placeholder={disabled ? 'Engineering is unavailable on this workspace' : session.mode === 'plan' ? 'Describe what to investigate or plan…' : 'Describe what to build, fix, or test…'}
          disabled={disabled}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} />
        <div className="engcomposebar row">
          <AttachButton onFiles={attachments.addFiles} count={attachments.count} max={attachments.limits.maxPerMessage} includeWhiteboard={false} />
          <button className={`engpermtrigger cchip${permissionsOpen ? ' open' : ''}`} onClick={() => setPermissionsOpen((open) => !open)}
            disabled={controlsLocked} aria-haspopup="dialog" aria-expanded={permissionsOpen}>
            <IconSettings s={13} /><span className="lbl">{permissionSummary(session)}</span><span className="car" aria-hidden><IconChevron s={10} /></span>
          </button>
          <button className="engsend btn primary send" onClick={send} disabled={!draft.trim() || controlsLocked || attachments.busy} aria-label="Send Code message" data-tip="Send · ↵"><IconSend s={18} /></button>
        </div>
        <div className="engmodebar row">
          <span className="engmodes threadseg" role="group" aria-label="Engineering mode">
            <button className={session.mode === 'plan' ? 'on' : ''} disabled={controlsLocked} aria-pressed={session.mode === 'plan'} onClick={() => onMode ? onMode('plan') : onSession(setEngineeringMode(session, 'plan'))}>Plan</button>
            <button className={session.mode === 'act' ? 'on' : ''} disabled={controlsLocked} aria-pressed={session.mode === 'act'} onClick={() => onMode ? onMode('act') : onSession(setEngineeringMode(session, 'act'))}>Act</button>
          </span>
          <span className="engcontextchips">
            {project ? <ProjectChip projects={projects} active={project}
              disabled={controlsLocked || !onProject} onSwitch={(id) => onProject?.(id)} onNew={onNewProject ?? (() => {})} /> : null}
            <EngineeringModelSelector session={session} project={project} disabled={controlsLocked}
              onChange={(modelId) => onModel ? onModel(modelId) : onSession(setEngineeringModel(session, modelId))} />
            {machineChip}
          </span>
        </div>
        {permissionsOpen && <PermissionsMenu session={session} onClose={() => setPermissionsOpen(false)}
          onChange={(category, value) => onPermission ? onPermission(category, value) : onSession(setEngineeringPermission(session, category, value))} />}
      </div>
    </div>
  );
}
