// Provider setup UI — the card a provider is connected through, its auth mode, and the
// copyable command that does it from a terminal. Shared by onboarding and settings.
// Extracted from App.tsx (track A2).
import { BRAIN_PROVIDERS, ProviderLogo } from '../brain/providers';
import { IS_WEB } from '../lib/platform';
import { type ProviderStatus } from '../bridge/rows-infra';
import { useEffect, useRef, useState } from 'react';

// A copyable shell command (used in the provider setup how-to).
export function CopyCmd({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="obcmd">
      <code>{cmd}</code>
      <button onClick={() => { void navigator.clipboard?.writeText(cmd); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }}>{copied ? 'copied ✓' : 'copy'}</button>
    </div>
  );
}

export type ProviderMode = 'none' | 'subscription' | 'apikey';

// One "Bring your own brain" provider card — logo + identity + live detection status, a
// Subscription/API-key toggle, an inline setup how-to, and a re-check (↻). Fully controlled,
// so it's shared by onboarding (collects choices) and workspace settings (persists each
// change). When onKeyCommit is given the key field gets a Save button (settings); otherwise
// the key is just collected (onboarding).
export function ProviderCard({ bp, status, probing, mode, keyValue, keyPlaceholder, ready, setupOpen, busy, highlight, onMode, onKey, onKeyCommit, onToggleSetup, onRefresh }: {
  bp: (typeof BRAIN_PROVIDERS)[number];
  status: ProviderStatus | undefined;
  probing: boolean;
  mode: ProviderMode;
  keyValue: string;
  keyPlaceholder?: string;
  ready: boolean;
  setupOpen: boolean;
  busy?: boolean;
  highlight?: boolean;
  onMode: (m: ProviderMode) => void;
  onKey: (v: string) => void;
  onKeyCommit?: () => void;
  onToggleSetup: () => void;
  onRefresh: () => void;
}) {
  const st = status;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (highlight) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [highlight]);
  return (
    <div ref={ref} className={`obbrain${ready ? ' on' : ''}${highlight ? ' focus' : ''}`}>
      <div className="obbrainmain">
        <span className="obbrainico"><ProviderLogo id={bp.id} /></span>
        <div className="obbraintext">
          <b>{bp.name}</b>
          <span className="obbrainsub">{bp.sub}</span>
          <div className="obbrainstatus">
            {/* a browser cannot look for a CLI on anyone's disk, so it never claims to have:
                the sign-in happens ON THE MACHINE after launch, through its terminal. */}
            {IS_WEB ? <><span className="obmachinedot" /> sign in on your machine after launch</>
              : probing ? <><span className="obmachinedot live" /> checking…</>
              : st?.authed ? <><span className="obmachinedot on" /> subscription detected</>
              : st?.installed ? <><span className="obmachinedot" /> installed · not signed in</>
              : <><span className="obmachinedot" /> CLI not installed</>}
            {!IS_WEB && !probing && !st?.authed && (
              <span className="obbrainacts">
                <button className="obsetuplink" onClick={onToggleSetup}>{setupOpen ? 'hide' : st?.installed ? 'how to sign in' : 'how to set up'}</button>
                <button className="obrefresh" title="re-check this provider" aria-label="re-check" onClick={onRefresh}>↻</button>
              </span>
            )}
          </div>
        </div>
        <div className="obbrainmodes">
          <button className={`obbrainmode${mode === 'subscription' ? ' on' : ''}`} disabled={!IS_WEB && !st?.authed} title={IS_WEB ? 'you will sign in on your cloud machine after launch' : st?.authed ? '' : 'sign in first to use your subscription'} onClick={() => onMode('subscription')}>Subscription</button>
          <button className={`obbrainmode${mode === 'apikey' ? ' on' : ''}`} onClick={() => onMode('apikey')}>API key</button>
        </div>
      </div>
      {mode === 'apikey' && (
        onKeyCommit ? (
          <div className="obbrainkeyrow">
            <input className="obbrainkey" type="password" placeholder={keyPlaceholder ?? bp.place} value={keyValue} onChange={(e) => onKey(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onKeyCommit(); }} autoFocus />
            <button className="btn sm" disabled={busy || !keyValue.trim()} onClick={onKeyCommit}>Save</button>
          </div>
        ) : (
          <input className="obbrainkey" type="password" placeholder={keyPlaceholder ?? bp.place} value={keyValue} onChange={(e) => onKey(e.target.value)} autoFocus />
        )
      )}
      {setupOpen && (
        <div className="obsetup">
          {!st?.installed && (
            <div className="obsetuprow">
              <span className="obsetupn">1</span>
              <div className="obsetupc"><span>Install the {bp.name} CLI</span><CopyCmd cmd={`npm i -g ${bp.pkg}`} /></div>
            </div>
          )}
          <div className="obsetuprow">
            <span className="obsetupn">{st?.installed ? '1' : '2'}</span>
            <div className="obsetupc"><span>Sign in with your {bp.name} subscription</span><CopyCmd cmd={bp.login} /></div>
          </div>
          <div className="obsetupnote">Run in your terminal, finish the browser login, then hit ↻ to re-check.</div>
        </div>
      )}
    </div>
  );
}
