// The workspace as a group — inviting, revoking a share, and leaving.
// Split out of settings/WorkspaceSettings.tsx.
import { seatLimitReason } from '@neuramesh/shared';
import { IconAlert } from '../ui/icons';
import { Modal } from '../ui/Modal';
import { nm as nmBridge } from '../bridge/nm';
import { type MemberRow } from '../bridge/rows-crew';
import { useCallback, useEffect, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// Invite form + its free-plan gate — one body shared by the Workspace settings Members tab
// and the People-header "+" modal, so the plan gating can never drift between the two.
export function InviteTeammate({ isCloud, onUpgrade, leaveZone, canLend, lendAll }: { isCloud: boolean; onUpgrade: () => void; leaveZone?: React.ReactNode;
  /** this member has a machine to lend — no switch if there is nothing to offer (0119) */
  canLend?: boolean;
  /** flip the lender's grant to "everyone in this workspace", so the invitee is covered the
   *  moment they accept. Blanket rather than per-user because the invitee has no user id yet. */
  lendAll?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState(true); // ON, labelled — George, 2026-08-12
  const [invEmail, setInvEmail] = useState('');
  const [invNote, setInvNote] = useState('');
  const [pending, setPending] = useState<Array<{ id: string; email: string; role: string; expiresAt: string }>>([]);

  const refresh = useCallback(async () => {
    try { setPending((await nm?.invites()) ?? []); } catch { /* offline — the form still works */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // No password field: an invite is a pending row plus an email, and the invitee's identity is
  // resolved when they sign in (docs/27 §1d). The old form asked an admin to invent a password
  // for someone else — for a Supabase auth user that Clerk would never accept.
  const sendInvite = async () => {
    if (!nm || !invEmail.trim()) return;
    setBusy(true);
    setInvNote('');
    try {
      const r = await nm.invite(invEmail.trim().toLowerCase());
      // grant BEFORE they arrive: an invitee has no user id until they accept, so the lend is
      // recorded as workspace-wide and the Sharing list stays the place to narrow it later
      if (share && canLend) lendAll?.();
      setInvNote(r.delivery === 'sent' ? `✓ Invitation emailed to ${invEmail.trim()}`
        : r.delivery === 'skipped' ? `✓ Invite created — email is not configured on this server`
        : `✓ Invite created — the email didn't send, use Resend to retry`);
      setInvEmail('');
      await refresh();
    } catch (e) {
      setInvNote(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').replace(/^\/v1\/commands failed \d+: /, '').slice(0, 160) : 'invite failed');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try { await nm?.revokeInvite(id); await refresh(); } catch { /* keep the row; the list refreshes next open */ }
  };

  // Free is ONE person (George, 2026-09-03): the first invitation is the upgrade door. There is no pre-emptive gate
  // here on purpose: the server owns the cap and returns PLAN_LIMIT at it, so the UI can never
  // disagree with the entitlement. The upgrade link appears on that message, which is the same
  // seatLimitReason() sentence the server throws, so the two never drift.
  return (
    <>
      <div className="sect" style={{ padding: '6px 0 5px' }}>Invite a teammate</div>
      <p className="wshint">{isCloud ? 'They get an email with a link. Signing in with that address joins them to the workspace.'
        : seatLimitReason()}</p>
      <div className="fld"><label>Email</label>
        <input value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="teammate@company.com"
          onKeyDown={(e) => { if (e.key === 'Enter' && invEmail.includes('@')) void sendInvite(); }} autoFocus /></div>
      {/* the grant starts where the relationship does (0119). ON by default and labelled with
          the cost — without it a teammate who has no provider sign-in joins into a workspace
          where nothing can run for them. Hidden when there is no machine to lend. */}
      {canLend && (
        <div className="shinvite">
          <button type="button" className={`shsw${share ? ' on' : ''}`} role="switch" aria-checked={share}
            aria-label="Share my compute with this teammate" onClick={() => setShare((v) => !v)}><i /></button>
          <span className="shinvtxt"><b>Share my compute</b>
            <span className="shsub">Their requests may run on your machines, on your subscription. Without it they need their own.</span></span>
        </div>
      )}
      <button className="btn primary" disabled={busy || !invEmail.includes('@')} onClick={() => void sendInvite()}>
        {busy ? 'sending…' : 'Send invitation'}
      </button>
      <div className="loginerr" style={{ textAlign: 'left', marginTop: 6 }}>
        {invNote}
        {invNote.startsWith(seatLimitReason()) ? <> <button className="lnk" onClick={onUpgrade}>Upgrade →</button></> : null}
      </div>
      {pending.length > 0 ? (
        <>
          <div className="sect" style={{ padding: '14px 0 5px' }}>Pending · {pending.length}</div>
          {pending.map((p) => (
            <div key={p.id} className="wsrow">
              <span className="wsrowname">{p.email}</span>
              <span className="wsrowsub">{p.role} · expires {new Date(p.expiresAt).toLocaleDateString()}</span>
              <button className="btn sm" onClick={() => void revoke(p.id)}>Revoke</button>
            </div>
          ))}
        </>
      ) : null}
      {leaveZone}
    </>
  );
}

/**
 * COMPUTE (0114) — whose machines are serving this workspace.
 *
 * The agents are the workspace's; the machines they run on are the members'. That is the whole
 * reason to have more than one person here, and until this panel there was nowhere to see it:
 * the roster showed agents as if they floated free, while every run was really burning some
 * particular person's subscription on some particular laptop.
 *
 * It also makes the failure mode legible. A member with no machine registered has their requests
 * served by a teammate — fine, and the point of shared compute — but they should be able to SEE
 * that rather than wonder why their laptop is idle while work happens.
 */
/**
 * Stop-sharing confirm (0119). Revoke does LESS than the switch implies: new conversations stop
 * immediately, but threads already living on your machines keep running there, because continuity
 * is deliberately ungated (their files and worktrees are on your disk). Saying so — with the real
 * count — is the difference between a control you can trust and one that quietly lies.
 */
export function RevokeShare({ member, count, onConfirm, onClose }: { member: MemberRow; count: number | null; onConfirm: () => void; onClose: () => void }) {
  const who = member.display_name?.trim() || 'this teammate';
  return (
    <Modal title={`Stop sharing with ${who}?`} onClose={onClose}>
      <p className="wshint">New conversations {who} starts will no longer run on your machines.</p>
      {count === null ? <p className="cmpnote">checking what is running here…</p>
        : count > 0 ? (
          <div className="cmprow">
            <span className="cmpdot on" aria-hidden />
            <div className="cmpbody">
              <div className="cmphead"><b>{count} existing {count === 1 ? 'conversation' : 'conversations'}</b></div>
              <div className="cmpmeta"><span className="cmpnote">keep running here. Their files and worktrees are on this machine.</span></div>
            </div>
          </div>
        ) : <p className="cmpnote">Nothing of theirs is running here.</p>}
      <div className="cmpintroactions">
        <button className="btn primary" onClick={() => { onConfirm(); onClose(); }}>Stop sharing</button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

/**
 * Leave workspace (0113). This exists so the product's own error messages stop lying: workspace
 * deletion says other members "need to leave it first" and account deletion says to "leave or
 * delete your workspaces first" — before this, neither named anything a member could actually do,
 * so one accepted invitation permanently blocked both.
 *
 * The owner is refused server-side; showing them why beats showing them a button that always
 * fails.
 */
export function LeaveWorkspace({ workspaceId, workspaceName, isOwner, onLeft }: { workspaceId: string; workspaceName: string; isOwner: boolean; onLeft: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (isOwner) {
    return (
      <div className="dangerzone">
        <b>Leave {workspaceName}</b>
        <div className="locked">
          <span className="cico warn" aria-hidden><IconAlert s={14} /></span>
          <span>You own this workspace. <b>Make someone else the owner</b> first, or delete it if you&rsquo;re the last one here.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="dangerzone">
      <b>Leave {workspaceName}</b>
      <p>You&rsquo;ll lose access to its projects, rooms and board. Agents you registered keep running for the team.</p>
      {err ? <p style={{ color: 'var(--warn)', fontSize: 12, margin: '0 0 9px' }}>{err}</p> : null}
      {confirming ? (
        <div className="cardacts">
          <button className="btn danger sm" disabled={busy} onClick={async () => {
            setBusy(true); setErr('');
            // main relaunches when you leave the workspace you are standing in, so nothing
            // after this resolves in that case
            try { await nm?.leaveWorkspace(workspaceId); onLeft(); }
            catch (e) { setErr(e instanceof Error ? e.message.replace(/^.*?Error: /, '').slice(0, 160) : 'could not leave'); setBusy(false); }
          }}>{busy ? 'leaving…' : `Yes, leave ${workspaceName}`}</button>
          <button className="btn ghost sm" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn danger sm" onClick={() => setConfirming(true)}>Leave workspace</button>
      )}
    </div>
  );
}

// A synced policy override row as it arrives from the replica (selector is jsonb → text).
