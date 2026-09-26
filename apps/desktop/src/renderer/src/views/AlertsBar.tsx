// THE ATTENTION BAR (docs/design/failure-alerts-2026-08, mockups/failure-alerts.html).
//
// Failures the human armed — a connector's grant dying, a routine erroring, posts not going
// out — get ONE derived surface: this bar at the top of the Home stage, and the same rows
// pinned in the bell. It renders from three synced row conditions via the pure deriveAlerts
// and disappears the moment each condition clears (reconnect lands, the next run is clean,
// the posts re-approve) — no ack table, no unread state, nothing for rex to write.
import { alertsSummary, computeAlert, deriveAlerts, planLabel, providerLabel, type Alert } from '@neuramesh/shared';
import { useCompute } from '../compute/useCompute';
import { openCredits } from '../settings/ConnectPanel';
import { nm as nmBridge } from '../bridge/nm';
import { useEffect, useState, type ReactNode } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

/** One poll behind both surfaces (the bar and the bell's Attention section), owned by App —
 *  the ConnectionsList 5s-poll idiom, slower because nothing here is mid-OAuth by default. */
// Post-group dismissal watermarks (machine-local by design — a personal attention surface).
// One key, not per-workspace: group keys carry project uuids, so cross-workspace collisions
// cannot happen in practice.
const DISMISS_KEY = 'nm:alertdismiss';
const readDismissals = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}') as Record<string, string>; } catch { return {}; }
};

export function useAlerts(authed: boolean): { alerts: Alert[]; refresh: () => void; dismiss: (key: string) => void } {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  // the cap joins HERE rather than in App, so every surface that already renders `alerts` (the
  // bar, the bell, Marketing OS) picks it up without one of them being taught about compute
  const capAlert = computeAlert(useCompute(authed));
  const refresh = () => {
    void nm?.alerts().then(
      (r) => setAlerts(deriveAlerts(r.connectors, r.schedules, r.posts, readDismissals())),
      () => { /* a failed read keeps the last derivation — never blank a real alert on a blip */ },
    );
  };
  // "these failures, I've seen": stamp NOW — anything that fails on a LATER slot re-raises
  const dismiss = (key: string) => {
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify({ ...readDismissals(), [key]: new Date().toISOString() })); } catch { /* private mode */ }
    refresh();
  };
  useEffect(() => {
    if (!authed) return undefined;
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [authed]);
  return { alerts: capAlert ? [capAlert, ...alerts] : alerts, refresh, dismiss };
}

const GLYPH: Record<Alert['kind'], ReactNode> = {
  // a machine, matching the glyph the Compute surfaces already use for one
  compute: <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><rect x="1.6" y="3" width="13.8" height="9" rx="1.8" /><path d="M5.5 14.4h6" strokeLinecap="round" /></svg>,
  connector: <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M2 2l13 13M15 2 2 15" strokeLinecap="round" /></svg>,
  routine: <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M13.6 8.5a5.1 5.1 0 1 1-1.5-3.6" strokeLinecap="round" /><path d="M13.9 1.9v3.2h-3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  posts: <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><rect x="2" y="3" width="13" height="11" rx="2" /><path d="M2 6.5h13" strokeLinecap="round" /></svg>,
};

const WarnGlyph = () => (
  <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
    <path d="M7.5 1.8 14 13H1z" strokeLinejoin="round" /><path d="M7.5 6v3.4" strokeLinecap="round" /><circle cx="7.5" cy="11.1" r=".7" fill="currentColor" stroke="none" />
  </svg>
);

export function AlertsBar({ alerts, refresh, dismiss, onOpenCalendar, onOpenRoutines, onUpgrade }: {
  alerts: Alert[];
  refresh: () => void;
  /** posts groups only: wave off the CURRENT failures; a later one re-raises */
  dismiss: (key: string) => void;
  onOpenCalendar: () => void;
  onOpenRoutines: () => void;
  /** the compute row's action: open the shared upgrade surface with the cap as its reason */
  onUpgrade?: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // the row whose action is in flight
  if (!alerts.length) return null;

  // Reconnect IS the fix: the same external-browser OAuth round-trip Connect runs, resolved
  // through a room of the connector's project — on callback the status flips and the poll
  // clears this bar. (The Connections rail stays where it lives, in the room; no detour.)
  const reconnect = async (a: Alert) => {
    if (!a.channelId || !a.provider) return;
    setBusy(a.key);
    try { await nm?.connectorStart(a.channelId, a.provider as never); } finally { setTimeout(() => setBusy(null), 2500); }
  };
  const pause = async (a: Alert) => {
    if (!a.scheduleId) return;
    setBusy(a.key);
    try { await nm?.scheduleStatus(a.scheduleId, 'paused'); refresh(); } finally { setBusy(null); }
  };

  const head = (
    <button className="attbar" data-open={open || undefined} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
      <span className="attglyph"><WarnGlyph /></span>
      <span className="attcount">{alerts.length} need{alerts.length === 1 ? 's' : ''} attention</span>
      {!open && <span className="attsum">{alertsSummary(alerts)}</span>}
      <span className="attchev" aria-hidden>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="m1 1 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    </button>
  );
  if (!open) return <div className="attwrap">{head}</div>;
  return (
    <div className="attwrap">
      <div className="attpanel" role="region" aria-label="Needs attention">
        {head}
        {alerts.map((a) => (
          <div className="attrow" key={a.key}>
            <span className="attrglyph">{GLYPH[a.kind]}</span>
            <div className="attrbody">
              <div className="attrtitle">{a.title}</div>
              <div className="attrwhy">{a.why}</div>
              {a.meta && <div className="attrmeta">{a.meta}</div>}
            </div>
            <span className="attracts">
              {a.kind === 'connector' && (
                <button className="btn primary sm" disabled={busy === a.key || !a.channelId} onClick={() => void reconnect(a)}>
                  {busy === a.key ? 'Opening browser…' : `Reconnect ${providerLabel(a.provider ?? '')}`}
                </button>
              )}
              {a.kind === 'routine' && (<>
                <button className="btn primary sm" onClick={onOpenRoutines}>Open routine</button>
                <button className="btn ghost sm" disabled={busy === a.key} onClick={() => void pause(a)}>Pause it</button>
              </>)}
              {/* the cap's only real move: nothing here can be fixed by retrying. An empty balance's
                  move is more credits (the Credits view), on any plan, so it never offers Pro */}
              {a.kind === 'compute' && (a.addCredits
                ? <button className="btn primary sm" onClick={() => openCredits()}>Add credits</button>
                : <button className="btn primary sm" onClick={() => onUpgrade?.(a.why)}>Get {planLabel('cloud')}</button>)}
              {a.kind === 'posts' && <button className="btn primary sm" onClick={onOpenCalendar}>Review on calendar</button>}
              {a.kind === 'posts' && <button className="btn ghost sm" title="Stop showing these failures — a new one re-raises the bar" onClick={() => dismiss(a.key)}>Dismiss</button>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The bell's condensed twin — same alerts, pinned above the queue; the click lands the human
 *  on the Home stage where the full bar (and its actions) lives. */
export function BellAlerts({ alerts, onOpen }: { alerts: Alert[]; onOpen: () => void }) {
  if (!alerts.length) return null;
  return (
    <>
      <div className="bellattsec">Attention</div>
      {alerts.map((a) => (
        <button className="bellattrow" key={a.key} onClick={onOpen}>
          <span className="attrglyph">{GLYPH[a.kind]}</span>
          <span className="t"><b>{a.title}</b><span>{a.why}</span></span>
        </button>
      ))}
    </>
  );
}
