import { EngineeringPlanProgress } from '../engineering/EngineeringPlanProgress';
// Coding is the shared session composer with repository permissions and Plan/Act controls.
import { filesFromPaste } from './parts';
import { useEffect, useState } from 'react';
import { AttachButton, AttachTray } from '../composer/attach';
import { SessionComposer } from '../composer/SessionComposer';
import { PERMISSION_LABELS, effectivePermission, type EngineeringSession, type PermissionCategory } from '../engineering/domain';
import { useEngineeringAttachments, type EngineeringAttachmentUpload } from '../engineering/attachments';
import { CodingBrains } from '../models/CodingBrains';
import type { EngineeringSelection } from '@neuramesh/shared';
import type { MachineChipSlot } from '../views/EngineeringOS';
import { IconCheck, IconChevron, IconSend, IconSettings } from '../ui/icons';

const PERMISSIONS = Object.keys(PERMISSION_LABELS) as PermissionCategory[];
const WORD: Record<PermissionCategory, string> = { read: 'reads', edit: 'edits', command: 'commands', web: 'web', mcp: 'mcp' };
/** the chip's word: `Reads run · edits ask` — what runs on its own, and the first thing that asks */
function permissionLine(session: EngineeringSession): string {
  const state = (c: PermissionCategory) => effectivePermission(session.mode, c, session.permissions, session.policy);
  const run = PERMISSIONS.filter((c) => state(c) === 'auto').map((c) => WORD[c]);
  const ask = PERMISSIONS.filter((c) => state(c) === 'ask').map((c) => WORD[c]);
  if (!run.length) return 'Everything asks';
  const first = run.join(', ');
  const head = first.charAt(0).toUpperCase() + first.slice(1);
  // Plan mode blocks every write by construction: say that, not the first thing that would ask
  if (session.mode === 'plan') return `${head} run · no writes`;
  return ask.length ? `${head} run · ${ask.includes('edits') ? 'edits' : ask[0]} ask` : `${head} run`;
}

/** the permissions menu, in the house popover: each row runs on its own or asks first, and Plan holds the writes */
function PermissionsPop({ session, onChange, onClose }: { session: EngineeringSession; onChange: (category: PermissionCategory, value: boolean) => void; onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [onClose]);
  return (
    <>
      <div className="projmenu-scrim" onClick={onClose} />
      <div className="cprojpop cpermpop" role="dialog" aria-label="Permissions for this session">
        <div className="cprojhint cmodhead"><b>Permissions</b><span>for this session</span></div>
        <div className="cpermlist">
          {PERMISSIONS.map((category) => {
            const on = session.permissions[category];
            const state = effectivePermission(session.mode, category, session.permissions, session.policy);
            return (
              <button key={category} type="button" className="cpermrow" role="checkbox" aria-checked={on} disabled={!session.policy[category]} onClick={() => onChange(category, !on)}>
                <span className={`engcheckbox${on ? ' on' : ''}`} aria-hidden>{on ? <IconCheck s={11} /> : null}</span>
                <span className="cpermtxt"><b>{PERMISSION_LABELS[category].label}</b><small>{PERMISSION_LABELS[category].detail}</small></span>
                <span className={`cpermst ${state}`}>{state === 'blocked' ? 'Not in Plan' : state === 'auto' ? 'Runs' : 'Asks'}</span>
              </button>
            );
          })}
        </div>
        <div className="cmachfoot">The machine's policy can still ask or block.</div>
      </div>
    </>
  );
}

function ModeSeg({ session, locked, onMode }: { session: EngineeringSession; locked: boolean; onMode: (mode: 'plan' | 'act') => void }) {
  return (
    <span className="threadseg codingseg" role="group" aria-label="Coding mode">
      <button className={session.mode === 'plan' ? 'on' : ''} aria-pressed={session.mode === 'plan'} disabled={locked} onClick={() => onMode('plan')}>Plan</button>
      <button className={session.mode === 'act' ? 'on' : ''} aria-pressed={session.mode === 'act'} disabled={locked} onClick={() => onMode('act')}>Act</button>
    </span>
  );
}

export function CodingComposer({ session, plan, onUpgrade, machineChip, onSend, onMode, onPermission, onConfigure, onOpenPlan, roomId = null, roomSlug = '', disabled = false, contextChips }: {
  session: EngineeringSession;
  onOpenPlan?: () => void;
  plan: string;
  onUpgrade: (reason: string) => void;
  machineChip?: MachineChipSlot | undefined;
  onSend: (text: string, uploads: EngineeringAttachmentUpload[]) => void;
  onMode: (mode: 'plan' | 'act') => void;
  onPermission: (category: PermissionCategory, value: boolean) => void;
  roomId?: string | null; roomSlug?: string; disabled?: boolean; contextChips?: React.ReactNode;
  onConfigure: (selection: EngineeringSelection) => void;
}) {
  const [draft, setDraft] = useState('');
  const [permOpen, setPermOpen] = useState(false);
  const atts = useEngineeringAttachments(plan, onUpgrade);
  const locked = disabled || session.state === 'streaming' || session.state === 'awaiting_approval';
  useEffect(() => { if (locked) setPermOpen(false); }, [locked]);
  const send = () => {
    const text = draft.trim();
    if (!text || locked || atts.busy) return;
    onSend(text, atts.uploads());
    setDraft(''); atts.reset();
  };
  return (
    <>
    <EngineeringPlanProgress session={session} onOpenPlan={onOpenPlan} />
    <div className="cbox codingbox">
      <AttachTray items={atts.items} onRemove={atts.remove} />
      <SessionComposer rowClass="trow" input={<SessionComposer.Input value={draft} onChange={setDraft} onSend={send} people={[]} skills={[]} packs={[]} attachedSkill={null} onPickSkill={() => {}} onClearSkill={() => {}}
        onPaste={(event) => { const files = filesFromPaste(event); if (files.length) { event.preventDefault(); atts.addFiles(files); } }}
        placeholder={session.mode === 'plan' ? 'Describe what to investigate or plan · ↵ send' : 'Describe what to build, fix, or test · ↵ send'} />} controls={<>
        <AttachButton onFiles={atts.addFiles} count={atts.count} max={atts.limits.maxPerMessage} includeWhiteboard={false} />
        <CodingBrains selection={{ agentId: session.agentId ?? null, modelId: session.modelOverride, reasoningEffort: session.reasoningEffort ?? null }} machineId={session.machineId ?? null} roomId={roomId} roomSlug={roomSlug} disabled={locked} onChange={onConfigure} />
        {machineChip?.(session.machineId ?? null, () => {}, true)}
        {contextChips}
        {/* the knobs and Send travel as one group: on a narrow box the group wraps to its own row */}
        <span className="codingknobs">
        <ModeSeg session={session} locked={locked} onMode={onMode} />
        <span className="cchips codingperm">
          <button className={`cchip engpermtrigger${permOpen ? ' open' : ''}`} disabled={locked} aria-haspopup="dialog" aria-expanded={permOpen} onClick={() => setPermOpen((o) => !o)}
            data-tip="What runs on its own, and what asks you first">
            <span className="g" aria-hidden><IconSettings s={13} /></span><span className="lbl">{permissionLine(session)}</span><span className="car" aria-hidden><IconChevron s={10} /></span>
          </button>
          {permOpen && <PermissionsPop session={session} onChange={onPermission} onClose={() => setPermOpen(false)} />}
        </span>
        <button className="btn primary tsend" disabled={!draft.trim() || locked || atts.busy} onClick={send} aria-label="Send" data-tip="Send · ↵"><IconSend s={14} /></button>
        </span>
      </>} />
    </div>
    </>
  );
}
