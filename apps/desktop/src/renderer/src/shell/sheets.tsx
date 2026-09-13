// The shell's sheets — switching workspace, the profile and the machine-limit wall. Extracted from
// App.tsx (track A4). The Upgrade to Pro sheet lives in UpgradeSheet.tsx (the source-release round).
import { IconAgents, IconAlert, IconCheck, IconMachine } from '../ui/icons';
import { Modal } from '../ui/Modal';
// the Upgrade to Pro sheet lives in its own file (the source-release round); App reaches it through here
export { UpgradeSheet } from './UpgradeSheet';
export { MoveToCloudSheet } from './MoveToCloudSheet';

import { nm as nmBridge } from '../bridge/nm';
import { selfInitial, selfLabel } from '../lib/self';
import { type ChannelRow } from '../bridge/rows-rooms';
import { type MemberRow, type WorkspaceMembership } from '../bridge/rows-crew';
import { type WorkspaceProjectRow } from '../bridge/rows-board';
import { useEffect, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// "Your profile": the signed-in user's identity + their editable display name (the name
// shown on their messages and in the channel people lists — persisted to
// workspace_members.display_name, resolved at render so it flows everywhere) + the
// channels they belong to (all the workspace's rooms, grouped by project).
export function ProfileModal({ user, member, channels, projects, onClose, onSave }: {
  user: { id: string; email: string } | null;
  member: MemberRow | undefined;
  channels: ChannelRow[];
  projects: WorkspaceProjectRow[];
  onClose: () => void;
  onSave: (displayName: string) => Promise<void>;
}) {
  const current = selfLabel(member?.display_name, user?.email);
  const [name, setName] = useState(current);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const trimmed = name.trim();
  const dirty = trimmed.length > 0 && trimmed !== current;
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true); setErr(null);
    try { await onSave(trimmed); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'could not save your name'); setSaving(false); }
  };
  // group the workspace's channels by project (the user belongs to all of them)
  const groups = projects
    .map((p) => ({ project: p.name, rooms: channels.filter((c) => c.project_id === p.id) }))
    .filter((g) => g.rooms.length > 0);
  const orphans = channels.filter((c) => !projects.some((p) => p.id === c.project_id));
  if (orphans.length) groups.push({ project: 'Other', rooms: orphans });
  return (
    <Modal title="Your profile" onClose={onClose}>
      <div className="accthead" style={{ padding: '2px 0 12px' }}>
        <span className="acctav" style={{ width: 44, height: 44, fontSize: 17 }}>{selfInitial(user?.email)}</span>
        <div className="acctid"><b style={{ fontSize: 15 }}>{current}</b><span title={user?.email ?? ''}>{user?.email}</span></div>
      </div>
      <div className="kvline"><span>role</span><b>{member?.role ?? 'member'}</b></div>

      <div className="sect" style={{ padding: '14px 0 5px' }}>Display name</div>
      <p style={{ fontSize: 10.5, color: 'var(--dim)', margin: '0 0 8px' }}>The name shown on your messages and in the channel people lists.</p>
      <div className="fld"><label>Your name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Your name"
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} autoFocus /></div>
      <button className="btn primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'saving…' : 'Save'}</button>
      {err && <div className="loginerr" style={{ textAlign: 'left', marginTop: 6 }}>{err}</div>}

      <div className="sect" style={{ padding: '14px 0 5px' }}>Channels you belong to</div>
      {groups.length === 0
        ? <div className="kvline"><span>no channels yet</span><b>—</b></div>
        : groups.map((g) => (
            <div key={g.project} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10.5, color: 'var(--dim)', margin: '4px 0 3px' }}>{g.project}</div>
              {g.rooms.map((c) => (
                <div key={c.id} className="kvline"><span>#{c.slug}</span><b style={{ color: 'var(--dim)', fontWeight: 400 }}>{c.topic || ''}</b></div>
              ))}
            </div>
          ))}
    </Modal>
  );
}

/**
 * The switch sheet. The swap is IN PLACE since the connections registry (main/connections.ts
 * setForeground): no relaunch, so the sheet says so in one line instead of warning about one. The
 * live-agent row is DERIVED from the runs rows, never written into the copy — with nothing running
 * the row is absent, not zeroed, so the sheet can't claim work that isn't happening.
 */
export function SwitchWorkspaceSheet({ target, onCancel, onConfirm }: {
  target: WorkspaceMembership;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [runs, setRuns] = useState<Array<{ title: string; agent_name: string | null; number: number | null }> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void nm?.liveRuns().then((r) => setRuns(r.runs)).catch(() => setRuns([])); }, []);
  const go = () => { setBusy(true); onConfirm(); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  const live = runs ?? [];
  return (
    <Modal onClose={onCancel} title={`Switch to ${target.name}`} subtitle="The workspace changes in place. The app does not restart.">
      <div className="conseq">
        {live.length > 0 ? (
          <div className="conseqrow">
            <span className="cico warn" aria-hidden><IconAlert s={15} /></span>
            <span>
              <b>{live.length} agent{live.length === 1 ? ' works' : 's work'} right now.</b>{' '}
              {live.slice(0, 2).map((r) => `${r.agent_name ?? 'an agent'} on ${r.number ? `#${r.number}` : r.title}`).join(', ')}
              {live.length > 2 ? `, and ${live.length - 2} more` : ''}. The work stays claimed.
            </span>
          </div>
        ) : (
          <div className="conseqrow">
            <span className="cico ok" aria-hidden><IconCheck s={14} /></span>
            <span>Your work is already synced. Nothing is downloaded again.</span>
          </div>
        )}
        <div className="conseqrow">
          <span className="cico" aria-hidden><IconAgents s={15} /></span>
          <span>The agents on this machine move to <b>{target.name}</b>. The workspace you leave shows them offline until you come back.</span>
        </div>
      </div>
      <div className="cardacts">
        <button className="btn primary" disabled={busy} onClick={go}>{busy ? 'Please wait…' : live.length ? 'Switch anyway' : 'Switch'}</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <span className="cardnote">⌘⏎</span>
      </div>
    </Modal>
  );
}

// Free is one machine. A sign-in on a second machine gets this card instead of a failure: transfer
// the workspace here (the other machine stops syncing) or Get Pro for more machines.
export function MachineLimitModal({ message, onTransfer, onUpgrade, onClose }: { message: string; onTransfer: () => void; onUpgrade: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mlcard">
        <span className="mlico"><IconMachine s={30} /></span>
        <h2 className="mltitle">This workspace is on another machine</h2>
        <p className="mlbody">{message}</p>
        <div className="mlactions">
          <button className="btn primary" disabled={busy} onClick={() => { setBusy(true); onTransfer(); }}>{busy ? 'Please wait…' : 'Transfer to this machine'}</button>
          <button className="btn" onClick={onUpgrade}>Get Pro</button>
        </div>
        <button className="mldismiss" onClick={onClose}>Not now</button>
      </div>
    </div>
  );
}
