import { CodingModePicker } from '../composer/CodingModePicker';
import { PermissionPicker } from '../composer/PermissionPicker';
import { EngineeringPlanProgress } from '../engineering/EngineeringPlanProgress';
// Coding is the shared session composer with repository permissions and Plan/Act controls.
import { filesFromPaste } from './parts';
import { useState } from 'react';
import { AttachButton, AttachTray } from '../composer/attach';
import { SessionComposer } from '../composer/SessionComposer';
import { type EngineeringSession, type PermissionCategory } from '../engineering/domain';
import { useEngineeringAttachments, type EngineeringAttachmentUpload } from '../engineering/attachments';
import { CodingBrains } from '../models/CodingBrains';
import type { EngineeringSelection } from '@neuramesh/shared';
import type { MachineChipSlot } from '../views/EngineeringOS';
import { IconSend } from '../ui/icons';

export function CodingComposer({ session, plan, onUpgrade, machineChip, onSend, onMode, onConfigure, onOpenPlan, roomId = null, roomSlug = '', disabled = false, contextChips }: {
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
  const atts = useEngineeringAttachments(plan, onUpgrade);
  const locked = disabled || session.state === 'streaming' || session.state === 'awaiting_approval';
  const brainControl = { selection:{agentId:session.agentId ?? null,modelId:session.modelOverride,reasoningEffort:session.reasoningEffort ?? null}, machineId:session.machineId ?? null, roomId,roomSlug,disabled:locked,onChange:onConfigure };
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
        <CodingBrains {...brainControl} part="model" />
        {machineChip?.(session.machineId ?? null, () => {}, true)}
        {contextChips}
        {/* the knobs and Send travel as one group: on a narrow box the group wraps to its own row */}
        <span className="codingknobs">
        <CodingModePicker key={session.id} mode={session.mode} disabled={locked} onChange={onMode} />
        <PermissionPicker key={session.id} threadId={session.id} />
        <CodingBrains {...brainControl} part="agent" />
        <button className="btn primary tsend" disabled={!draft.trim() || locked || atts.busy} onClick={send} aria-label="Send" data-tip="Send · ↵"><IconSend s={14} /></button>
        </span>
      </>} />
    </div>
    </>
  );
}
