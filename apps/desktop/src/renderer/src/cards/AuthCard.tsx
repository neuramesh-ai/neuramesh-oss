// The credential card an agent posts when its seat cannot run: the reason, and the ways out. A
// SWITCHED card (2026-09-17) records a move a routine already made: it asks nothing and offers the
// reconnect only, with the way back said in words.
import { STARTER_MODEL, STARTER_PACK_ID } from '@neuramesh/shared';
import { useEffect, useState } from 'react';
import { nm } from '../bridge/nm';
import { openProviderSettings } from '../lib/toast';
import { AUTH_CMD, AUTH_LABEL, type NmAuth } from './parse';

export function AuthCard({ auth }: { auth: NmAuth }) {
  const label = AUTH_LABEL[auth.provider] ?? auth.provider;
  const cmd = AUTH_CMD[auth.provider];
  const [copied, setCopied] = useState(false);
  const [state, setState] = useState<'idle' | 'connecting' | 'connected' | 'failed'>('idle');
  // THE OPTION THE BLOCK WAS WITHHOLDING (George, 2026-09-08). The refusal exists so nothing spends
  // your money unasked, which makes an explicit tap the right way out of it rather than a reason to
  // hide the exit. Since 2026-09-17 (Starter is the FALLBACK brain, docs/10 §15.7) the tap moves
  // THIS conversation's failing seat when the card knows it (`scope`): visible in the brain chip,
  // undone by Reset, and it moves a pinned seat too (thread > pin). A card with no conversation
  // keeps switching the workspace-wide Starter pack, as it always did. The daemon says when the
  // workspace is out of credits (`starter: false`), and then the button is not drawn at all.
  // the button carries NO balance (George, 2026-09-17: "the credits in the button isn't clear if
  // that's the credit they have left or what the thread will cost"): the balance lives in the
  // nav's credit ring, the button says only how this seat is paid
  const [onCredits, setOnCredits] = useState(false);
  // a switch that already happened (this tab, another machine, a reload) reads as done, never as a
  // second invitation: the card asks the conversation's row rather than trusting its own memory
  useEffect(() => {
    if (!auth.scope || !nm?.threadBrain) return;
    void nm.threadBrain(auth.scope.threadId).then((o) => { if (o?.[auth.scope!.role] === STARTER_MODEL) setOnCredits(true); }).catch(() => {});
  }, [auth.scope]);
  const switched = auth.switched === true;
  const starterOffered = auth.starter !== false && !switched;
  // the per-conversation switch needs BOTH the scope the daemon gave and a bridge that can merge it
  // (the web bridge has no replica to merge from) — the label says what the tap will really do
  const threadSwitch = !!(auth.scope && nm?.threadBrainRole);
  const runOnCredits = async () => {
    try {
      if (threadSwitch) await nm!.threadBrainRole!(auth.scope!.threadId, auth.scope!.role, STARTER_MODEL);
      else await nm?.workspaceUpdate({ activeModelPack: STARTER_PACK_ID });
      setOnCredits(true);
    } catch { /* the card stays put; the other two routes still work */ }
  };
  const reconnect = async () => {
    if (!nm?.providerReauth) { openProviderSettings(auth.provider); return; } // until the IPC exists
    setState('connecting');
    try {
      const r = await nm.providerReauth(auth.provider);
      setState(r?.authed ? 'connected' : 'failed');
    } catch {
      setState('failed');
    }
  };
  const who = auth.agent ? <b>@{auth.agent}</b> : 'the agent';
  return (
    <div className={`authcard${switched ? ' switched' : ''}`}>
      <div className="authcardhead">
        <span className="authdot" />
        <b>{switched ? 'Switched to the NeuraMesh brain here' : `${label} ${auth.reason === 'unavailable' ? 'login unavailable' : 'login expired'}`}</b>
      </div>
      <div className="authcardsub">
        {switched
          ? <>{auth.why ? `${auth.why} ` : ''}This conversation runs {who} on the NeuraMesh brain, on credits. Sign in to {label} again on this machine, then reset the brain in this conversation to go back.</>
          : auth.why
            ? <>{auth.why} I do not fall back to an API key on my own, because that bills you.</>
            : <>I will not fall back to an API key on my own, because that bills you. Reconnect your {label} login on this machine, run on NeuraMesh credits, or switch {label} to API-key mode.</>}
      </div>
      {cmd && state !== 'connected' && (
        <div className="authcmd">
          <code>{cmd}</code>
          <button
            className="authcopy"
            title="Copy command"
            onClick={() => { void navigator.clipboard?.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
          >
            {copied ? '✓' : '⧉'}
          </button>
          <span className="authcmdhint">or run it yourself in any terminal</span>
        </div>
      )}
      {onCredits && !switched ? (
        <div className="authcardok">
          {threadSwitch
            ? <>✓ This conversation runs {who} on the NeuraMesh brain. Re-mention {who} to retry.</>
            : <>✓ On NeuraMesh credits. Re-mention {who} to retry.</>}
        </div>
      ) : state === 'connected' ? (
        <div className="authcardok">✓ Reconnected. {switched ? 'Reset the brain in this conversation to go back.' : <>Re-mention {who} to retry.</>}</div>
      ) : (
        <div className="authcardfoot">
          {starterOffered && (
            <button className="btn primary sm" onClick={() => void runOnCredits()}
              title={threadSwitch ? 'This conversation runs the seat on the NeuraMesh brain, on credits. Reset the brain in this conversation to go back.' : 'The workspace runs on the NeuraMesh brain, on credits.'}>
              {threadSwitch ? 'Use NeuraMesh brain here (credits)' : 'Use NeuraMesh brain (credits)'}
            </button>
          )}
          <button className={`btn sm${switched ? ' primary' : ''}`} disabled={state === 'connecting'} onClick={() => void reconnect()}>
            {state === 'connecting' ? 'Reconnecting…' : `Reconnect ${label}`}
          </button>
          {!switched && <button className="btn sm" onClick={() => openProviderSettings(auth.provider)}>Use an API key instead</button>}
          {state === 'failed' && <span className="authcardfail">Sign-in didn’t complete — finish it in the window, or use a key.</span>}
        </div>
      )}
    </div>
  );
}
