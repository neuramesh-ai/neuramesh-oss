// Workspace settings — providers, policy, brains, sandboxing, invites and leaving.
// Extracted from App.tsx (track A2).
import { ArchivedChatsPanel } from './ArchivedChatsPanel';



import { ComputePanel } from '../compute/ComputePanel';

import { Modal } from '../ui/Modal';
import { ConnectionsPanel } from './ConnectionsPanel';



import { nm as nmBridge } from '../bridge/nm';
import { type AgentRow, type MachineRow, type MemberRow } from '../bridge/rows-crew';
import { type CredRow } from '../bridge/rows-infra';
import { type RepoUI } from '../bridge/rows-board';
import { useState } from 'react';
import { PackSelector, ProviderSettings } from './panels-compute';
import { FailoverPolicy, PolicyPanel } from './panels-policy';
import { VoicePanel } from './panels-voice';
import { InviteTeammate, LeaveWorkspace, RevokeShare } from './panels-people';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

export function WorkspaceSettings({ creds, user, repos, isCloud, focusProvider, focusPolicy, focusTab, workspaceId, workspaceName, isOwner, machines, members, agents, selfMachineName, onAddRepo, onUpgrade, onSaved, onClose }: { creds: CredRow[]; user: { id: string; email: string } | null; repos: RepoUI[]; isCloud: boolean; focusProvider?: string | null; focusPolicy?: boolean; /** open on a named tab — Settings › Connections has its own door (lib/toast.ts) */ focusTab?: 'connections' | null; workspaceId: string; workspaceName: string; isOwner: boolean; machines: MachineRow[]; members: MemberRow[]; agents: AgentRow[]; selfMachineName: string | null; onAddRepo: () => void; onUpgrade: () => void; onSaved: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<{ workspaces: Array<{ id: string; name: string; slug: string; role: string; memberCount: number }> } | null>(null);
  const [delErr, setDelErr] = useState('');
  // tabbed settings (P3): Members · Compute · Connections · Providers · General. A provider deep-link opens Providers.
  // Connections replaced Billing (the source-release round): a plan is a fact about a connection's workspace.
  const [tab, setTab] = useState<'members' | 'compute' | 'connections' | 'providers' | 'brains' | 'policy' | 'archived' | 'general'>(focusTab ?? (focusPolicy ? 'policy' : focusProvider ? 'providers' : 'members'));
  // the pending un-lend: the member, the write to run on confirm, and the count of their
  // conversations already living here (null while the replica read is in flight)
  const [revoke, setRevoke] = useState<{ member: MemberRow; apply: () => void; count: number | null } | null>(null);
  // a locked pack's "Connect X" CTA jumps to the Providers tab focused on that provider
  const [provFocus, setProvFocus] = useState<string | null>(focusProvider ?? null);
  const openDelete = async () => {
    if (!nm) return;
    setDelErr('');
    try {
      setDel(await nm.accountBlockers());
    } catch (e) {
      setDelErr(e instanceof Error ? e.message.slice(0, 120) : 'failed to load');
    }
  };

  const delWorkspace = async (id: string) => {
    if (!nm) return;
    setBusy(true);
    setDelErr('');
    try {
      await nm.workspaceDelete(id);
      setDel(await nm.accountBlockers());
    } catch (e) {
      setDelErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 140) : 'delete failed');
    } finally {
      setBusy(false);
    }
  };

  const delAccount = async () => {
    if (!nm) return;
    setBusy(true);
    setDelErr('');
    try {
      await nm.accountDelete();
      await nm.logout(); // relaunches to sign-in
    } catch (e) {
      setDelErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 140) : 'delete failed');
      setBusy(false);
    }
  };

  return (
    <Modal title="Workspace settings" onClose={onClose} full>
      <div className="wstabs">
        {/* Compute sits beside Members on purpose (0114): they are the two halves of one fact —
            who is here, and whose machines are serving the work. */}
        {(['members', 'compute', 'connections', 'providers', 'brains', 'policy', 'archived', 'general'] as const).map((t) => (
          <button key={t} className={`wstab${tab === t ? ' on' : ''}`} title={t.charAt(0).toUpperCase() + t.slice(1)} onClick={() => setTab(t)}>
            {t === 'archived' ? 'Archived chats' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'members' && (
        <InviteTeammate isCloud={isCloud} onUpgrade={onUpgrade}
          canLend={machines.some((m) => m.owner_user_id === (user?.id ?? null))}
          lendAll={() => {
            void nm?.setCompute({ shares: ['*'] }).catch(() => {});
          }}
          leaveZone={<LeaveWorkspace workspaceId={workspaceId} workspaceName={workspaceName} isOwner={isOwner} onLeft={onClose} />} />
      )}

      {revoke && (
        <RevokeShare member={revoke.member} count={revoke.count}
          onConfirm={revoke.apply} onClose={() => setRevoke(null)} />
      )}

      {tab === 'compute' && (
        <ComputePanel machines={machines} members={members} agents={agents}
          selfMachineName={selfMachineName} selfUserId={user?.id ?? null}
          onRevoke={(r) => {
            setRevoke({ ...r, count: null });
            // the count is a replica read, so it lands after the modal opens — null renders
            // "checking…" rather than a confident 0 the query has not answered yet
            void nm?.computeSharedThreads(r.member.user_id)
              .then(({ count }) => setRevoke((cur) => (cur && cur.member.user_id === r.member.user_id ? { ...cur, count } : cur)))
              .catch(() => setRevoke((cur) => (cur ? { ...cur, count: 0 } : cur)));
          }} />
      )}

      {tab === 'connections' && <ConnectionsPanel />}

      {tab === 'providers' && (
        <>
          <ProviderSettings creds={creds} onSaved={onSaved} focus={provFocus} />
          <FailoverPolicy />
          <p style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 8 }}>
            Subscriptions stay in your CLIs on this machine — neuramesh never sees them. API keys are stored server-side only, never synced to clients; UIs only ever see the last 4 characters.
          </p>
        </>
      )}

      {tab === 'brains' && <PackSelector creds={creds} onConnect={(p) => { setProvFocus(p); setTab('providers'); }} />}

      {tab === 'policy' && <PolicyPanel />}

      {tab === 'archived' && <ArchivedChatsPanel />}

      {tab === 'general' && (
        <>
          <VoicePanel />
          <div className="sect" style={{ padding: '14px 0 5px' }}>Repositories</div>
          {repos.length === 0
            ? <div className="kvline"><span>no repositories yet</span><b>—</b></div>
            : repos.map((r) => (
                <div key={r.id} className="kvline"><span>{r.org_name}/{r.name}</span><b>{r.default_branch}</b></div>
              ))}
          <button className="btn" style={{ marginTop: 9 }} onClick={onAddRepo}>+ Add repository</button>
          <p style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 8 }}>
            Repos tasks can branch off and push to for review. No tokens stored — your machine's own git credentials authenticate at push.
          </p>

          {user && (
            <>
              <div className="sect" style={{ padding: '14px 0 5px' }}>Account</div>
              <div className="kvline"><span>signed in as</span><b>{user.email || user.id.slice(0, 8)}</b></div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn" onClick={() => void nm?.logout()}>⎋ Sign out</button>
                <button className="btn danger" onClick={() => void openDelete()}>Delete my account…</button>
              </div>
              {del && (
                <div className="delbox">
                  <b>Before your account can be deleted:</b>
                  {del.workspaces.length === 0 && <div className="delitem done">✓ no workspaces left — you're clear</div>}
                  {del.workspaces.map((w) => (
                    <div key={w.id} className="delitem">
                      {w.memberCount === 1 ? (
                        <>
                          <span>workspace <b>{w.name}</b> (sole member) — deletes its channels, agents, machines, tasks & history</span>
                          <button className="btn danger sm" disabled={busy} onClick={() => void delWorkspace(w.id)}>Delete workspace</button>
                        </>
                      ) : (
                        <span>workspace <b>{w.name}</b> has {w.memberCount} members — they must leave (or take ownership) first</span>
                      )}
                    </div>
                  ))}
                  <button
                    className="btn danger"
                    style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
                    disabled={busy || del.workspaces.length > 0}
                    onClick={() => void delAccount()}
                  >
                    Delete my account permanently
                  </button>
                  <div className="loginerr" style={{ textAlign: 'left' }}>{delErr}</div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
