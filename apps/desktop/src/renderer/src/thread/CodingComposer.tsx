// THE ONE COMPOSER, WEARING THE CODING KNOBS (coding threads §5, docs/33 §8): the thread's own
// cbox — the input, the chips row (attach · model · machine; the room and the repository are not
// switchable here, so they are not chips: the branch shows in the code pane's foot, George,
// 2026-09-26) — plus the two knobs a coding thread ADDS: the Plan | Act segment and
// the permissions chip. The row WRAPS (George, 2026-09-26): with more chips than a row holds, the
// knobs and Send stack cleanly on a second row and the composer grows, so nothing is ever cut off
// (docs/34 §13: the third chip pushed Send off the screen once). The model chip is the main
// composer's (models/CodeModelChip, George 2026-10-04), and both menus open in the house popover.
import { useEffect, useState } from 'react';
import { AttachButton, AttachTray } from '../composer/attach';
import { ComposerInput } from '../composer/ComposerInput';
import { PERMISSION_LABELS, effectivePermission, type EngineeringSession, type PermissionCategory } from '../engineering/domain';
import { useEngineeringAttachments, type EngineeringAttachmentUpload } from '../engineering/attachments';
import { CodeModelChip } from '../models/CodeModelChip';
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

export function CodingComposer({ session, plan, onUpgrade, machineChip, onSend, onMode, onPermission, onModel }: {
  session: EngineeringSession;
  plan: string;
  onUpgrade: (reason: string) => void;
  machineChip?: MachineChipSlot | undefined;
  onSend: (text: string, uploads: EngineeringAttachmentUpload[]) => void;
  onMode: (mode: 'plan' | 'act') => void;
  onPermission: (category: PermissionCategory, value: boolean) => void;
  onModel: (modelId: string | null) => void;
}) {
  const [draft, setDraft] = useState('');
  const [permOpen, setPermOpen] = useState(false);
  const atts = useEngineeringAttachments(plan, onUpgrade);
  const locked = session.state === 'streaming' || session.state === 'awaiting_approval';
  useEffect(() => { if (locked) setPermOpen(false); }, [locked]);
  const send = () => {
    const text = draft.trim();
    if (!text || locked || atts.busy) return;
    onSend(text, atts.uploads());
    setDraft(''); atts.reset();
  };
  return (
    <div className="cbox codingbox">
      <AttachTray items={atts.items} onRemove={atts.remove} />
      <ComposerInput value={draft} onChange={setDraft} onSend={send} people={[]} skills={[]} packs={[]} attachedSkill={null} onPickSkill={() => {}} onClearSkill={() => {}}
        placeholder={session.mode === 'plan' ? 'Describe what to investigate or plan · ↵ send' : 'Describe what to build, fix, or test · ↵ send'} />
      <div className="trow">
        <AttachButton onFiles={atts.addFiles} count={atts.count} max={atts.limits.maxPerMessage} includeWhiteboard={false} />
        <CodeModelChip pick={session.modelOverride} machineId={session.machineId ?? null} place="session" disabled={locked} onPick={onModel} />
        {machineChip?.(session.machineId ?? null, () => {}, true)}
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
      </div>
    </div>
  );
}
