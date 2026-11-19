import { useEffect, useId, useRef, useState } from 'react';
import { ComposerMenuPanel } from './ComposerMenuPanel';
import { isPermissionMode, PERMISSION_MODES, PERMISSION_MODE_COPY, type PermissionMode, type PermissionSelection } from '@neuramesh/shared';
import { nm } from '../bridge/nm';
import { IconCheck, IconChevron, Svg } from '../ui/icons';
import './permissions.css';

/** The same picker serves a persisted thread, the workspace default, and the
 * unsent New Session draft. Draft choices travel on the first message. */
export function PermissionPicker({ threadId, taskId, workspace, draftMode, onDraft, disabled }: {
  threadId?: string; taskId?:string; workspace?: boolean; draftMode?: PermissionMode | null;
  onDraft?: (mode: PermissionMode | null) => void; disabled?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState<PermissionSelection | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const id = useId();
  useEffect(() => {
    let active = true;
    const load = () => {
      if (!nm?.getPermissions) return;
      void nm.getPermissions(threadId,taskId).then(result => {
        if (active && isPermissionMode(result?.workspaceMode)) { setSelection(result); setError(''); }
      }).catch(() => { if (active) setError('Could not load permissions. Reopen to retry.'); });
    };
    load();
    window.addEventListener('nm-permissions-saved', load);
    return () => { active = false; window.removeEventListener('nm-permissions-saved', load); };
  }, [threadId, taskId, open]);
  const override = onDraft ? draftMode : selection?.threadMode;
  const checked = selection?.scheduled ? 'turbo' : override ?? selection?.workspaceMode;
  const legacy = selection?.legacyControls && !override;
  const waitingForHost = selection?.runtimeReady === false;
  const label = waitingForHost ? 'Waiting for machine' : selection?.scheduled ? 'Turbo · scheduled' : legacy ? 'Previous controls' : checked ? PERMISSION_MODE_COPY[checked].label : 'Permissions';
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const save = async (mode: PermissionMode | null) => {
    if (saving || !nm) return;
    if (onDraft) { onDraft(mode); close(); return; }
    setSaving(true);
    try {
      const result = await nm.setPermissions(mode, threadId,taskId);
      setSelection(result);
      window.dispatchEvent(new Event('nm-permissions-saved'));
      close();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the permission mode.'); }
    finally { setSaving(false); }
  };
  return <><button ref={trigger} type="button" className="cchip perm-trigger" aria-label={`Permissions: ${label}`}
    aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
    onClick={() => setOpen(!open)}><Svg s={14}><path d="m12 3 8 3v6c0 4-3 7-8 9-5-2-8-5-8-9V6z" /></Svg><span>{label}</span><IconChevron s={10} /></button>
    {open && <ComposerMenuPanel id={id} trigger={trigger} ariaLabel={workspace ? 'Workspace default permissions' : 'Thread permissions'} label={workspace ? 'Workspace default' : 'Thread permissions'} dismiss={setOpen}>
      {PERMISSION_MODES.map(mode => <button type="button" role="menuitemradio" aria-checked={!legacy && mode === checked} disabled={saving || !selection || waitingForHost || selection.scheduled}
        key={mode} onClick={() => void save(mode)}><span><b>{PERMISSION_MODE_COPY[mode].label}</b><small>{PERMISSION_MODE_COPY[mode].description}</small></span>{!legacy && mode === checked && <IconCheck s={14} />}</button>)}
      {!workspace && selection && <div className="perm-foot">{selection.scheduled ? 'This automation runs in Turbo.' : override || legacy ? <button type="button" role="menuitem" disabled={saving || waitingForHost} onClick={() => void save(null)}>Use workspace default · {PERMISSION_MODE_COPY[selection.workspaceMode].label}</button> : 'Using workspace default'}</div>}
      {waitingForHost && <small role="status">Connect an updated workspace machine to use thread permissions.</small>}
      {error && <small role="alert">{error}</small>}
    </ComposerMenuPanel>}</>;
}
