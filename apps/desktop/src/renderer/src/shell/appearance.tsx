// Appearance and updates — the theme panel and the docked update card.
// Extracted from App.tsx (track A4).
import { Modal } from '../ui/Modal';
import { PorchMark } from '../brand';
import { Switch } from '../ui/Switch';
import { THEMES, type ThemeDef, type ThemeId, type ThemePref } from '../theme/theme';
import { nm as nmBridge } from '../bridge/nm';
import { type UpdateState } from '../bridge/rows-infra';
import { useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// Claude-desktop-style update card: docked in the nav above the account row (the top dock
// has no side panel, so it falls back to floating bottom-left). It never gates launch —
// the whole card is the action for its phase (download → relaunch → retry), and the user
// picks the restart moment, since the app hosts running agents.
// `signin` docks it under the sign-in card: a signed-out user may be signed out BECAUSE the
// build is stale (2026-09-05 — prod stopped accepting the old credential, the app read the 401
// as a dead session), so the update must be reachable before sign-in, not only after.
export function UpdateCard({ state, floating, signin, onClose }: { state: UpdateState; floating?: boolean; signin?: boolean; onClose: () => void }) {
  if (state.phase === 'idle') return null;
  const act =
    state.phase === 'available' ? () => void nm?.updateDownload?.().catch(() => {})
    : state.phase === 'ready' ? () => void nm?.updateInstall?.().catch(() => {})
    : state.phase === 'error' ? () => void nm?.updateCheck?.().catch(() => {})
    : undefined;
  const title =
    state.phase === 'available' ? 'Update available'
    : state.phase === 'downloading' ? 'Downloading update'
    : state.phase === 'ready' ? 'Relaunch to update'
    : 'Update failed';
  const sub =
    state.phase === 'downloading' ? `v${state.version} · ${state.percent}%`
    : state.phase === 'error' ? state.message
    : `v${state.version}`;
  const hint =
    state.phase === 'available' ? 'Download the update'
    : state.phase === 'ready' ? 'Restart into the new version'
    : state.phase === 'error' ? 'Check again'
    : undefined;
  return (
    <div className={`updatecard${floating ? ' floating' : ''}${signin ? ' signin' : ''}`} data-phase={state.phase} role="status" aria-live="polite">
      <button className="updatecard-main" onClick={act} disabled={!act} title={hint} aria-busy={state.phase === 'downloading'}>
        <span className={`updatecard-ico${state.phase === 'error' ? ' err' : ''}`} aria-hidden>
          {state.phase === 'error'
            ? <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16.5h.01" /></svg>
            : <PorchMark size={20} />}
        </span>
        <span className="updatecard-body">
          <b className="updatecard-title">{title}</b>
          <span className="updatecard-sub">{sub}</span>
          {state.phase === 'downloading' && <span className="updatecard-bar"><i style={{ width: `${Math.max(4, state.percent)}%` }} /></span>}
          <FloorLine floor={state.floor} />
        </span>
        {act && (
          <span className="updatecard-go" aria-hidden>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
          </span>
        )}
      </button>
      {state.phase !== 'downloading' && <button className="updatecard-x" title="Dismiss" aria-label="Dismiss" onClick={onClose}>✕</button>}
    </div>
  );
}

// docs/46 rule 3: the Cloud connection names a floor above this app. one line, on any visible phase.
function FloorLine({ floor }: { floor?: string }) {
  return floor ? <span className="updatecard-floor">This version is too old for the cloud. Update the app to continue.</span> : null;
}

function ThemePreview({ theme }: { theme: ThemeDef }) {
  const { sw, look } = theme;
  return <div aria-hidden="true" className={`themeprev ${look}`} style={{ background: sw.bg, borderColor: sw.border }}>
    {look === 'paper' ? <>
      <span className="tprail" style={{ borderColor: sw.border }} />
      <span className="tptitle" style={{ background: sw.text }} />
      <span className="tpcomposer" style={{ borderColor: sw.border }} />
    </> : <>
      <div className="tprow"><span className="tpbar" style={{ background: sw.accent }} /><span className="tpbar sm" style={{ background: sw.border }} /></div>
      <div className="tppanel" style={{ background: sw.panel, borderColor: sw.border }}>
        <span className="tpline" style={{ background: sw.text }} /><span className="tpline sm" style={{ background: sw.text }} />
      </div>
    </>}
  </div>;
}

export function AppearancePanel({ pref, active, onPick, onClose }: { pref: ThemePref; active: ThemeId; onPick: (p: ThemePref) => void; onClose: () => void }) {
  const [notif, setNotif] = useState(() => localStorage.getItem('nm:notifications') !== 'off');
  const toggleNotif = () => setNotif((v) => { const next = !v; localStorage.setItem('nm:notifications', next ? 'on' : 'off'); void nm?.setNotificationsEnabled(next); return next; });
  return (
    <Modal title="Appearance" onClose={onClose}>
      <div role="radiogroup" aria-label="Theme">
        {(['paper', 'elevated'] as const).map((look) => {
          const system = look === 'paper' ? 'paper-system' : 'system';
          const label = look === 'paper' ? 'Paper' : 'Elevated';
          const choices: { id: ThemePref; label: string; desc: string; theme?: ThemeDef }[] = [
            { id: system, label: 'Sync with system', desc: look === 'paper' ? 'Paper light by day, paper dark by night.' : 'Light by day, dark by night.' },
            ...THEMES.filter((t) => t.look === look).map((theme) => ({ ...theme, theme })),
          ];
          return <section key={look} aria-label={label}>
            <div className="sect themegroup">{label}</div>
            <div className="themegrid">
              {choices.map((choice) => <label key={choice.id} className={`themecard${pref === choice.id ? ' sel' : ''}`}>
                <input className="themeinput" type="radio" name="appearance-theme" value={choice.id} checked={pref === choice.id} onChange={() => onPick(choice.id)}
                  aria-label={choice.id === system ? `${label}: Sync with system` : choice.label} aria-describedby={`theme-desc-${choice.id}`} />
                {choice.theme ? <ThemePreview theme={choice.theme} /> : <div aria-hidden="true" className={`themeprev ${look}`} style={{ background: look === 'paper' ? 'linear-gradient(135deg, #212121 0 50%, #f7f6f3 50% 100%)' : 'linear-gradient(135deg, #1d1d1d 0 50%, #fbf3e8 50% 100%)', borderColor: 'var(--border2)' }}><span className="tpsys" /></div>}
                <div className="themeinfo">
                  <div className="themename">{choice.label}{choice.id === system && pref === system && <span className="themeon"> · {THEMES.find((t) => t.id === active)?.label}</span>}</div>
                  <div className="themedesc" id={`theme-desc-${choice.id}`}>{choice.desc}</div>
                </div>
                <span className="themeradio" aria-hidden="true" />
              </label>)}
            </div>
          </section>;
        })}
      </div>
      <div className="sect" style={{ padding: '16px 0 5px' }}>Notifications</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '2px 0 4px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>Desktop notifications</div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>Get an alert when an agent needs you or a task is ready to accept.</div>
        </div>
        <Switch on={notif} onToggle={toggleNotif} title={notif ? 'on' : 'off'} />
      </div>
      <div className="sect" style={{ padding: '16px 0 5px' }}>The intro</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '2px 0 4px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>Porch says hello</div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>Play the launch animation again.</div>
        </div>
        <button className="btn sm" onClick={() => window.dispatchEvent(new Event('nm:replay-peek'))}>↻ Replay</button>
      </div>
    </Modal>
  );
}
