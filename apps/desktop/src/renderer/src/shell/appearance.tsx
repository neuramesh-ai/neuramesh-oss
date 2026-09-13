// Appearance and updates — the theme panel and the docked update card.
// Extracted from App.tsx (track A4).
import { Modal } from '../ui/Modal';
import { PorchMark } from '../brand';
import { Switch } from '../ui/Switch';
import { THEMES, type ThemeId, type ThemePref } from '../theme/theme';
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

// GitHub-style appearance picker — a "sync with system" card + the 4 themes, each
// with a live mini-preview built from its own token colors. Selecting applies +
// persists immediately (the app re-themes behind the modal).
export function AppearancePanel({ pref, active, onPick, onClose }: { pref: ThemePref; active: ThemeId; onPick: (p: ThemePref) => void; onClose: () => void }) {
  const [notif, setNotif] = useState(() => localStorage.getItem('nm:notifications') !== 'off');
  const toggleNotif = () => setNotif((v) => { const next = !v; localStorage.setItem('nm:notifications', next ? 'on' : 'off'); void nm?.setNotificationsEnabled?.(next); return next; });
  return (
    <Modal title="Appearance" onClose={onClose}>
      <p className="modalhint">Choose how neuramesh looks. Pick a single theme, or sync with your system to switch automatically between light and dark.</p>
      <div className="themegrid">
        <button className={`themecard${pref === 'system' ? ' sel' : ''}`} onClick={() => onPick('system')}>
          <div className="themeprev" style={{ background: 'linear-gradient(135deg, #1d1d1d 0 50%, #fbf3e8 50% 100%)', borderColor: 'var(--border2)' }}>
            <span className="tpsys" />
          </div>
          <div className="themeinfo">
            <div className="themename">Sync with system{pref === 'system' && <span className="themeon"> · {THEMES.find((t) => t.id === active)?.label.toLowerCase()}</span>}</div>
            <div className="themedesc">Follow your OS — light by day, dark by night.</div>
          </div>
          <span className="themeradio" aria-checked={pref === 'system'} role="radio" />
        </button>
        {THEMES.map((t) => (
          <button key={t.id} className={`themecard${pref === t.id ? ' sel' : ''}`} onClick={() => onPick(t.id)}>
            <div className="themeprev" style={{ background: t.sw.bg, borderColor: t.sw.border }}>
              <div className="tprow"><span className="tpbar" style={{ background: t.sw.accent }} /><span className="tpbar sm" style={{ background: t.sw.border }} /></div>
              <div className="tppanel" style={{ background: t.sw.panel, borderColor: t.sw.border }}>
                <span className="tpline" style={{ background: t.sw.text }} />
                <span className="tpline sm" style={{ background: t.sw.text }} />
              </div>
            </div>
            <div className="themeinfo">
              <div className="themename">{t.label}</div>
              <div className="themedesc">{t.desc}</div>
            </div>
            <span className="themeradio" aria-checked={pref === t.id} role="radio" />
          </button>
        ))}
      </div>
      <div className="sect" style={{ padding: '16px 0 5px' }}>Notifications</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '2px 0 4px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>Desktop notifications</div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>Get a desktop alert when an agent needs you, or a task is ready to accept — even when neuramesh is in the background. Click it to jump straight to the thread.</div>
        </div>
        <Switch on={notif} onToggle={toggleNotif} title={notif ? 'on' : 'off'} />
      </div>
      <div className="sect" style={{ padding: '16px 0 5px' }}>The intro</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '2px 0 4px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>Porch says hello</div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>Replay the launch animation — the full first-open peek, over the current theme.</div>
        </div>
        <button className="btn sm" onClick={() => window.dispatchEvent(new Event('nm:replay-peek'))}>↻ Replay</button>
      </div>
    </Modal>
  );
}
