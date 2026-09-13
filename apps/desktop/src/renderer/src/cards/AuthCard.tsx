// The credential card an agent posts when its provider needs re-auth.
import { STARTER_PACK_ID } from '@neuramesh/shared';
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
  // hide the exit. Switching the active pack leaves a VISIBLE trace (the brain pill, the picker),
  // where a hidden failover flag would leave nobody able to explain the model months later.
  const [credits, setCredits] = useState<number | null>(null);
  const [onCredits, setOnCredits] = useState(false);
  useEffect(() => { void nm?.usage?.().then((u) => setCredits(u ? Math.max(0, u.credits.remaining) : null)).catch(() => {}); }, []);
  const runOnCredits = async () => {
    try {
      await nm?.workspaceUpdate({ activeModelPack: STARTER_PACK_ID });
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
  return (
    <div className="authcard">
      <div className="authcardhead">
        <span className="authdot" />
        <b>{label} subscription {auth.reason === 'unavailable' ? 'login unavailable' : 'login expired'}</b>
      </div>
      <div className="authcardsub">
        I will not fall back to an API key on my own, because that bills you. Reconnect your {label} login on this machine, run on NeuraMesh credits, or switch {label} to API-key mode.
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
      {onCredits ? (
        <div className="authcardok">✓ On NeuraMesh credits. Re-mention {auth.agent ? <b>@{auth.agent}</b> : 'the agent'} to retry.</div>
      ) : state === 'connected' ? (
        <div className="authcardok">✓ Reconnected — re-mention {auth.agent ? <b>@{auth.agent}</b> : 'the agent'} to retry.</div>
      ) : (
        <div className="authcardfoot">
          <button className="btn primary sm" onClick={() => void runOnCredits()}>
            {credits === null ? 'Use NeuraMesh credits' : `Use NeuraMesh credits · ${credits.toLocaleString()}`}
          </button>
          <button className="btn sm" disabled={state === 'connecting'} onClick={() => void reconnect()}>
            {state === 'connecting' ? 'Reconnecting…' : `Reconnect ${label}`}
          </button>
          <button className="btn sm" onClick={() => openProviderSettings(auth.provider)}>Use an API key instead</button>
          {state === 'failed' && <span className="authcardfail">Sign-in didn’t complete — finish it in the window, or use a key.</span>}
        </div>
      )}
    </div>
  );
}
