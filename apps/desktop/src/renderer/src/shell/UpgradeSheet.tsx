// THE UPGRADE SHEET — Free is your Mac, Pro is the cloud (the source-release round, artboards C1
// and C2; docs/33 §8). ONE surface with three doors: the server's PLAN_LIMIT, Settings › Connections
// and the rail's foot (lib/toast.ts openUpgrade). Get Pro hands the browser a one-time nonce and
// the sheet WAITS (C2) on main's push (upgradeipc.ts) for up to fifteen minutes; the words stay put
// while the person pays on neuramesh.app, and the shell lands on the cloud workspace only once its
// row reads `cloud`. No trial, no card in the app, no per-reply price anywhere.
import { useEffect, useState } from 'react';
import { IconCloud, IconMachine } from '../ui/icons';
import { nm as nmBridge, type UpgradePush } from '../bridge/nm';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

/** every sentence a person reads on this sheet, in one place (CLAUDE.md #11) — the artboard's words */
export const UPGRADE_COPY = {
  eyebrow: 'Free is your Mac',
  title: 'Pro is the cloud',
  free: { name: 'Free', tag: 'Your plan', price: '$0', unit: 'forever', lines: ['Every room, agent, and task on this Mac', 'Your subscriptions and keys', 'No limits on projects, agents, or tasks', 'Nothing leaves this Mac'] },
  pro: { name: 'Pro', rec: 'Recommended', tag: 'The hosted cloud', price: '$22', unit: 'per seat, per month', lines: ['A cloud machine for every member', 'Invites and seats', 'Sync across devices, browser, and phone', 'Routines while your laptop is closed', 'Connectors that publish'] },
  get: 'Get Pro',
  notNow: 'Not now',
  foot: 'Opens neuramesh.app · your local workspaces stay on this Mac',
  wait: { title: 'Finish in your browser', sub: 'Sign up and pay on neuramesh.app. This window waits up to 15 minutes.', reopen: 'Open the page again', cancel: 'Cancel' },
  landing: { title: 'Pro is ready', sub: 'Your cloud workspace opens. Please wait…' },
  busy: 'Please wait…',
} as const;

function PlanCard({ icon, name, rec, tag, price, unit, lines }: { icon: React.ReactNode; name: string; rec?: string; tag: string; price: string; unit: string; lines: readonly string[] }) {
  return (
    <div className={`upcard${rec ? ' rec' : ''}`}>
      <div className="uphead">
        <span className="upico">{icon}</span>
        <div>
          <div className="upname">{name}{rec && <span className="uprec">{rec}</span>}</div>
          <div className="uptag">{tag}</div>
        </div>
      </div>
      <div className="upprice">{price}<small>{unit}</small></div>
      <ul className="uplist">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  );
}

export function UpgradeSheet({ onClose, reason }: { onClose: () => void; reason?: string }) {
  const [state, setState] = useState<UpgradePush>({ phase: 'idle' });
  const [busy, setBusy] = useState(false);
  // main owns the attempt: a sheet closed and reopened mid-wait picks the wait back up
  useEffect(() => {
    void nm?.upgradeState?.().then((s) => { if (s) setState(s); }).catch(() => {});
    return nm?.onUpgrade?.(setState);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && state.phase !== 'landing') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, state.phase]);
  const start = async () => {
    if (busy) return;
    setBusy(true);
    try { await nm?.upgradeStart?.(); }
    catch (e) { setState({ phase: 'error', message: e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '') : String(e) }); }
    finally { setBusy(false); }
  };
  const cancel = () => { void nm?.upgradeCancel?.(); setState({ phase: 'idle' }); };
  const waiting = state.phase === 'waiting' || state.phase === 'landing';
  const canClose = state.phase !== 'landing';

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && canClose && onClose()}>
      {waiting ? (
        <div className={`upmodal wait${state.phase === 'landing' ? ' landing' : ''}`} role="dialog" aria-labelledby="uptitle">
          {canClose && <button className="navpin upmodalx" title="close" onClick={onClose}>✕</button>}
          <span className="upwaitorb" aria-hidden />
          <h2 className="uptitle" id="uptitle">{state.phase === 'landing' ? UPGRADE_COPY.landing.title : UPGRADE_COPY.wait.title}</h2>
          <p className="upsub">{state.phase === 'landing' ? UPGRADE_COPY.landing.sub : UPGRADE_COPY.wait.sub}</p>
          {state.phase === 'waiting' && (
            <div className="upfoot center">
              <button className="btn" onClick={() => void nm?.upgradeReopen?.()}>{UPGRADE_COPY.wait.reopen}</button>
              <button className="btn quiet" onClick={cancel}>{UPGRADE_COPY.wait.cancel}</button>
            </div>
          )}
        </div>
      ) : (
        <div className="upmodal" role="dialog" aria-labelledby="uptitle">
          <button className="navpin upmodalx" title="close" onClick={onClose}>✕</button>
          <span className="upeyebrow">{UPGRADE_COPY.eyebrow}</span>
          <h2 className="uptitle" id="uptitle">{UPGRADE_COPY.title}</h2>
          {reason && <div className="upreason">{reason}</div>}
          {(state.phase === 'expired' || state.phase === 'error') && state.message && <div className="upnote" role="status">{state.message}</div>}
          <div className="upgrid">
            <PlanCard icon={<IconMachine s={16} />} {...UPGRADE_COPY.free} />
            <PlanCard icon={<IconCloud s={16} />} {...UPGRADE_COPY.pro} />
          </div>
          <div className="upfoot">
            <button className="btn primary" disabled={busy} onClick={() => void start()}>{busy ? UPGRADE_COPY.busy : UPGRADE_COPY.get}</button>
            <button className="btn" onClick={onClose}>{UPGRADE_COPY.notNow}</button>
            <span className="upgrow" />
            <span className="upmono">{UPGRADE_COPY.foot}</span>
          </div>
        </div>
      )}
    </div>
  );
}
