// THE SETUP TRACKER — what is left to do after the wizard ends (cloud-first round, item 15).
// Visual contract: mockups/starter-brain-and-credits.html:310-328, "A · floating, bottom-right".
//
// PLACEMENT A, by George's call (2026-08-28), overriding the round's own §8 recommendation of the
// in-room card. The recommendation's reasoning still stands and is worth keeping visible, because
// it is the cost being accepted: the shell has no universal bottom-right slot (the bottom dock
// retired with the shell round; only top-dock nav mode keeps `.dockbarproc`), so this MINTS a
// floating idiom — and docs/33 is deliberately careful about floating layers. It is recorded
// there in this round, as §11 requires, rather than inherited by a checklist.
//
// What placement A buys is the thing B could not: it FOLLOWS YOU. The in-room card sat on the
// Home stage and scrolled away, so a user who ignored it once might never see it again — which
// is precisely the failure a tracker exists to prevent. This one is a frame tenant: mounted once
// beside the workbench, portalled to <body>, and present on every surface until it is finished
// or waved off.
//
// It disappears four ways, and only two are clicks: every item done (the checklist retired
// itself), nothing knowable, dismissed, or collapsed to its pill. A setup tracker that outlives
// setup is clutter, so completion is the intended exit.
//
// The row form is the mockup's, and it drops the cards' detail sentences: 290px of corner has
// room for a label and a verb, not for "Sign into Claude on your machine — the terminal opens
// right here." The details survive as tooltips rather than being deleted.
import { onboardingComplete, onboardingKnowable, type OnboardingItem, type OnboardingSignals } from '@neuramesh/shared';
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { nm as nmBridge, type ConnectionKind } from '../bridge/nm';
import { downloadsUrl } from '../weburl';
import { setupItemsFor } from './setup-items';
import { openLink } from '../lib/links';
import { openProviderSettings, openWorkspaceMembers } from '../lib/toast';
import type { MachineRow, MemberRow } from '../bridge/rows-crew';
import type { CredRow } from '../bridge/rows-infra';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// Machine-local, like the attention bar's watermarks (AlertsBar.tsx): this is a personal surface,
// and there is no row to dismiss — the items are derived, so "I have seen this" has nowhere on
// the server to live. Two keys: waving it off is forever, folding it to the pill is not.
const DISMISS_KEY = 'nm:setupdismissed';
const FOLD_KEY = 'nm:setupfolded';
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

/**
 * `dock` puts the tracker IN the nav column, directly above the workspace bar; `float` is the
 * fixed card at the bottom-right corner.
 *
 * Float was the only mode, and it sat on top of whatever was in that corner — the marketing
 * rail's CONNECTIONS list, most visibly (George, 2026-08-29). A checklist you have not finished
 * yet is not worth covering the thing you came to read. Docked, it occupies the one column that
 * is already the app's own chrome, so it can never overlap content.
 *
 * Float survives for the two shapes that have no column to dock into: the TOP nav dock, and a
 * FOLDED nav — `.navpanel[data-folded="1"]` collapses to zero width and hides its children, so a
 * docked card would vanish with the sidebar rather than degrade. Both flags persist in
 * localStorage, so switching between the two variants keeps the tracker's folded/dismissed state.
 */
export function SetupCards({ variant = 'float', connection }: {
  variant?: 'dock' | 'float';
  /** the connection this workspace lives on (main/connections.ts): a local one has no cloud-machine row and no phone row (setup-items.ts) */
  connection?: ConnectionKind;
} = {}) {
  const [dismissed, setDismissed] = useState(() => readFlag(DISMISS_KEY));
  const [folded, setFolded] = useState(() => readFlag(FOLD_KEY));
  const [qr, setQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const items = setupItemsFor(useOnboardingSignals(), connection);
  if (dismissed || !onboardingKnowable(items) || onboardingComplete(items)) return null;

  const done = items.filter((i) => i.done === true).length;
  const fold = (v: boolean) => { writeFlag(FOLD_KEY, v); setFolded(v); };
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

  const body = folded ? (
    <button className="setuppill" onClick={() => fold(false)} aria-label={`Finish setting up — ${done} of ${items.length} done`}>
      {ring}<span>Finish setting up</span><span className="ct">{done}/{items.length}</span>
    </button>
  ) : (
    <div className="setupcard" role="group" aria-label="Finish setting up">
      <div className="setuphd">
        {ring}
        <b>Finish setting up</b>
        <span className="ct">{done}/{items.length}</span>
        <button className="setupfold" onClick={() => fold(true)} data-tip="Collapse" aria-label="Collapse">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M1 1h8" strokeLinecap="round" /></svg>
        </button>
        <button className="setupfold" onClick={dismiss} data-tip="Hide this — everything here stays in Settings" aria-label="Hide setup">
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
  );

  // DOCKED: an ordinary block in the nav's flow, so it tracks the column's width and its fold
  // without measuring anything. No portal — the reason to portal is to escape a clipping
  // ancestor for a FIXED card, and a docked one wants exactly the opposite.
  if (variant === 'dock') return <div className="setupdocked">{body}</div>;

  // FLOATING: portalled to <body> so no masked or transformed ancestor can clip a fixed-position
  // card — the same rule the nav's popovers follow (docs/33 §9.6)
  return createPortal(<div className="setupdock">{body}</div>, document.body);
}
