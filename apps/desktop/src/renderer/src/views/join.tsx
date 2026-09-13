// Joining a workspace — the invite card, the first run after accepting, and the joined
// confirmation. Extracted from App.tsx (track A4).

import { Wordmark } from '../brand';
import { WsTile } from './ProjectsFace';
import { nm as nmBridge } from '../bridge/nm';
import { timeAgo } from '../lib/time';
import { type PendingInvite } from '../bridge/rows-crew';
import { useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

/**
 * An invitation you answer. Two cards, never one flow: JOINING is free and instant, SWITCHING
 * costs a restart. Fusing them would make every invitation a forced context swap.
 */
/**
 * "You joined X — switch?" — deliberately NOT a state inside InviteCard.
 *
 * It is an acknowledgement of something the human just did, and the pending-invite list it would
 * have lived in is a mirror of the server (refreshed by the 1.5s bootstrap poll and on window
 * focus). The moment the accept lands, the server rightly stops listing that invitation, so a
 * joined state held inside the card was torn off screen about a second later — taking the Switch
 * button with it. Client-side acts need client-side lifetimes.
 */
export function JoinedCard({ workspaceName, currentWorkspace, onSwitch, onDismiss }: {
  workspaceName: string; currentWorkspace: string; onSwitch: () => void; onDismiss: () => void;
}) {
  return (
    <div className="invcard">
      <div className="cardhd">
        <WsTile name={workspaceName} size={38} />
        <div className="cardttl">
          <b>You joined {workspaceName}</b>
          <span>you&rsquo;re a member — it&rsquo;s in your account menu</span>
        </div>
      </div>
      <p className="cardbody">
        Switching restarts NeuraMesh and moves this machine&rsquo;s agents over. <b>{currentWorkspace} keeps running</b> — you can come back any time.
      </p>
      <div className="cardacts">
        <button className="btn" onClick={onSwitch}>Switch to {workspaceName}</button>
        <button className="btn ghost" onClick={onDismiss}>Stay here</button>
      </div>
    </div>
  );
}

export function InviteCard({ invite, currentWorkspace, onJoined, onDismiss }: {
  invite: PendingInvite;
  currentWorkspace: string;
  /** the membership now exists — the parent refreshes the switcher and raises the joined card */
  onJoined: (invite: PendingInvite) => void;
  /** declined: the question is answered and the card retires */
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState<null | 'join' | 'decline'>(null);
  const [err, setErr] = useState('');
  const days = Math.max(0, Math.round((new Date(invite.expiresAt).getTime() - Date.now()) / 864e5));
  const who = invite.inviterName ?? invite.inviterEmail ?? 'Someone';

  const answer = async (join: boolean) => {
    setBusy(join ? 'join' : 'decline');
    setErr('');
    try {
      if (join) { await nm?.acceptInvite(invite.inviteId); onJoined(invite); }
      else { await nm?.declineInvite(invite.inviteId); onDismiss(); }
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^.*?Error: /, '').replace(/^\/v1\/commands failed \d+: /, '').slice(0, 160) : 'that did not work');
      setBusy(null);
    }
  };

  return (
    <div className="invcard">
      <div className="cardhd">
        <WsTile name={invite.workspaceName} size={38} />
        <div className="cardttl">
          <b>{who} invited you to {invite.workspaceName}</b>
          <span>{invite.inviterEmail ?? ''}{invite.inviterEmail ? ' · ' : ''}{timeAgo(invite.createdAt)}</span>
        </div>
      </div>
      <div className="cardfacts">
        <span className="tok">joining as <b>{invite.role}</b></span>
        <span className="tok">expires in <b>{days} day{days === 1 ? '' : 's'}</b></span>
      </div>
      <p className="cardbody">
        You&rsquo;ll keep <b>{currentWorkspace}</b> — joining adds a workspace, it doesn&rsquo;t replace one. Switch between them from your account menu.
      </p>
      {err ? <p className="cardbody" style={{ color: 'var(--warn)' }}>{err}</p> : null}
      <div className="cardacts">
        <button className="btn primary" disabled={!!busy} onClick={() => void answer(true)}>
          {busy === 'join' ? 'joining…' : `Join ${invite.workspaceName}`}
        </button>
        <button className="btn ghost" disabled={!!busy} onClick={() => void answer(false)}>
          {busy === 'decline' ? 'declining…' : 'Decline'}
        </button>
      </div>
    </div>
  );
}

/**
 * First run WITH an invitation — the state that breaks if we get it wrong. An invited newcomer
 * has zero memberships, which is exactly the onboarding signal, so without this screen the
 * wizard walks someone who was invited to a team into creating their own empty workspace.
 */
export function InvitedFirstRun({ invite, onJoined, onOwnWorkspace }: {
  invite: PendingInvite;
  onJoined: () => void;
  onOwnWorkspace: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const who = invite.inviterName ?? invite.inviterEmail ?? 'Someone';
  const join = async () => {
    setBusy(true); setErr('');
    try { await nm?.acceptInvite(invite.inviteId); onJoined(); }
    catch (e) { setErr(e instanceof Error ? e.message.replace(/^.*?Error: /, '').slice(0, 160) : 'that did not work'); setBusy(false); }
  };
  return (
    <div className="firstrun">
      <div className="firstrunmark"><Wordmark size={17} /></div>
      <h3>{who} is expecting you</h3>
      <p>You were invited to a workspace that already has a team and a board running.</p>
      <div className="invtile">
        <WsTile name={invite.workspaceName} size={36} />
        <span className="wsbody">
          <b>{invite.workspaceName}</b>
          <span>{invite.inviterEmail ?? ''}{invite.inviterEmail ? ' · ' : ''}joining as {invite.role}</span>
        </span>
      </div>
      {err ? <p className="firstrunerr">{err}</p> : null}
      <button className="btn primary firstrunbtn" disabled={busy} onClick={() => void join()}>
        {busy ? 'joining…' : `Join ${invite.workspaceName}`}
      </button>
      <div className="orsep">or</div>
      <button className="btn firstrunbtn" disabled={busy} onClick={onOwnWorkspace}>Set up my own workspace</button>
      <p className="firstrunfoot">You can do both — joining now doesn&rsquo;t stop you starting your own later.</p>
    </div>
  );
}
