import { onboardingComplete, onboardingKnowable, type OnboardingItem, type OnboardingSignals } from '@neuramesh/shared';
import { useEffect, useState } from 'react';
import { nm as nmBridge, type ConnectionKind } from '../bridge/nm';
import { downloadsUrl } from '../weburl';
import { setupItemsFor } from './setup-items';
import { SetupPreview } from './SetupPreview';
import { openLink } from '../lib/links';
import { openProviderSettings, openWorkspaceMembers } from '../lib/toast';
import type { MachineRow, MemberRow } from '../bridge/rows-crew';
import type { CredRow } from '../bridge/rows-infra';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// Dismissal is personal and persistent. Expanded state is deliberately transient.
const DISMISS_KEY = 'nm:setupdismissed';
const readFlag = (k: string): boolean => {
  try { return localStorage.getItem(k) === '1'; } catch { return false; }
};
const writeFlag = (k: string, v: boolean): void => {
  try { if (v) localStorage.setItem(k, '1'); else localStorage.removeItem(k); } catch { /* private mode */ }
};

/** the iOS listing (George, 2026-08-28). NO storefront segment on purpose: the link he sent was
 *  the /il/ one, and hardcoding a country sends every user to that country's store page. Apple
 *  redirects a bare /app/id… to the visitor's own storefront. */
const APPSTORE_URL = 'https://apps.apple.com/app/id6787487455';

/** the row's verb. the card form carried a sentence; a corner carries a word. */
const VERB: Record<OnboardingItem['id'], string> = { machine: '', subscription: 'Connect', team: 'Invite', desktop: 'Get', mobile: 'Show QR' };

/** the link choice (lib/links.ts): the desktop asks here-or-the-OS-browser, the web client is
 *  already a browser and opens a new tab */
const openUrl = (url: string): void => openLink(url);

/**
 * The signals, read live. `null` is the load-bearing value: it means THIS CLIENT CANNOT SEE THIS
 * LANE — not "nothing is connected". Reading a missing lane as an empty one would tell a
 * cloud-first user "no cloud machine" about the machine the wizard provisioned one screen ago.
 *
 * Both lanes are served on BOTH clients: the desktop over IPC, the browser from webnm-rows.ts.
 * That is deliberate — the browser is the client this surface was designed for, so a tracker that
 * could only appear on the optional desktop would not be the feature. `null` survives as the
 * honest answer for a read that FAILS, which either client can still do.
 */
function useOnboardingSignals(): OnboardingSignals {
  const [roster, setRoster] = useState<{ machines: MachineRow[]; members: MemberRow[] } | null>(null);
  const [credentials, setCredentials] = useState<CredRow[] | null>(null);
  const [devices, setDevices] = useState<Array<{ platform: string }> | null>(null);
  useEffect(() => {
    const off = nm?.watchRoster((p) => setRoster({ machines: p.machines, members: p.members }));
    // a failed read keeps `null` — unknown, not "none connected"
    void nm?.credentials().then((r) => setCredentials(r?.credentials ?? null), () => {});
    void nm?.devices().then((r) => setDevices(r?.devices ?? null), () => {});
    return () => off?.();
  }, []);
  return { machines: roster?.machines ?? null, members: roster?.members ?? null, credentials, devices };
}

/**
 * The App Store code. Rendered client-side and drawn on a WHITE plate in both themes: a scanner
 * needs dark modules on a light ground, and a code that inverts with the theme is a code half our
 * users cannot scan. `qrcode` is loaded on demand — nobody pays for it until they ask to see it.
 *
 * The phone is the one item on this list you cannot finish on the device you are reading it on,
 * which is the whole reason it is a code and not a link. The link is still there for someone
 * already holding the phone.
 */
function QrPanel({ onCopy, copied }: { onCopy: () => void; copied: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import('qrcode')
      .then((m) => m.toDataURL(APPSTORE_URL, { margin: 1, width: 132, color: { dark: '#101010ff', light: '#ffffffff' } }))
      .then((d) => { if (live) setSrc(d); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return (
    <div className="setupqr">
      {src
        ? <img src={src} width={132} height={132} alt={`QR code linking to ${APPSTORE_URL}`} />
        : <div className="setupqrph" aria-hidden />}
      <div className="setupqrsd">
        <span>Scan with your phone camera</span>
        <button className="go" onClick={onCopy}>{copied ? 'Copied' : 'Copy link'}</button>
        <button className="go" onClick={() => openUrl(APPSTORE_URL)}>Open App Store →</button>
      </div>
    </div>
  );
}

export function SetupCards({ variant = 'float', connection }: {
  variant?: 'dock' | 'float';
  /** the connection this workspace lives on (main/connections.ts): a local one has no cloud-machine row and no phone row (setup-items.ts) */
  connection?: ConnectionKind;
} = {}) {
  const [dismissed, setDismissed] = useState(() => readFlag(DISMISS_KEY));
  const [qr, setQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const items = setupItemsFor(useOnboardingSignals(), connection);
  if (dismissed || !onboardingKnowable(items) || onboardingComplete(items)) return null;

  const done = items.filter((i) => i.done === true).length;
  const dismiss = () => { writeFlag(DISMISS_KEY, true); setDismissed(true); };
  const act = (item: OnboardingItem) => {
    if (item.action === 'connect-brain') openProviderSettings('anthropic');
    else if (item.action === 'invite') openWorkspaceMembers();
    else if (item.action === 'get-desktop') openUrl(downloadsUrl());
    // the phone is the one item you CANNOT finish on the device you are reading this on, so the
    // action is a code to scan rather than a link to follow. tapping it on a phone still works.
    else if (item.action === 'get-mobile') setQr((v) => !v);
  };

  // the progress ring, drawn from the count rather than animated — a checklist moves in whole
  // items, so there is nothing between two states to tween
  const ring = <span className="setupring" style={{ ['--p' as string]: `${Math.round((done / items.length) * 100)}%` }} aria-hidden />;

  return <SetupPreview done={done} total={items.length} variant={variant}>{close => (
    <div className="setupcard" role="group" aria-label="Finish setting up">
      <div className="setuphd">
        {ring}
        <b>Finish setting up</b>
        <span className="ct">{done}/{items.length}</span>
        <button className="setupfold" onClick={close} data-tip="Collapse" aria-label="Collapse">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M1 1h8" strokeLinecap="round" /></svg>
        </button>
        <button className="setupfold" onClick={dismiss} data-tip="Hide setup" aria-label="Hide setup">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M1 1l8 8M9 1 1 9" strokeLinecap="round" /></svg>
        </button>
      </div>
      {items.map((i) => (
        // `done: null` is UNKNOWN and renders exactly like an open item — never a tick. The tick
        // is a claim, and a claim made from a lane we cannot read is the one mistake a checklist
        // does not recover from: the human never sees the ask again.
        <div key={i.id}>
          <div className="setupti" data-done={i.done === true || undefined} title={i.detail}>
            <span className="box" aria-hidden />
            <span className="lb">{i.label}</span>
            {i.done !== true && i.action !== 'none' && (
              <button className="go" onClick={() => act(i)} aria-expanded={i.action === 'get-mobile' ? qr : undefined}>
                {VERB[i.id]}{i.action === 'get-mobile' ? '' : ' →'}
              </button>
            )}
          </div>
          {i.action === 'get-mobile' && qr && i.done !== true && (
            <QrPanel copied={copied} onCopy={() => { void navigator.clipboard?.writeText(APPSTORE_URL).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }, () => {}); }} />
          )}
        </div>
      ))}
    </div>
  )}</SetupPreview>;
}
