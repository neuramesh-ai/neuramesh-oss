// Connections — the provider/connector credential list in workspace settings.
// Extracted from App.tsx (track A2). The composer-foot round (2026-09-11) moved the per-provider
// connect step to ConnectPanel.tsx and the "connected" verdict to connectors.ts, so this list and
// the composer foot read ONE derivation and render ONE flow; the rows and their open state stay here.
import { IconClose } from '../ui/icons';
import { ConnectorMark } from './connector-marks';
import { ConnectPanel, disconnectConnector } from './ConnectPanel';
import { type ConnectorId, type ConnectorState } from './connectors';
import { useConnectorStates } from './useConnectorStates';
import { useEffect, useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import type { StarterVideo } from '../bridge/nm';
import { IconPlay, IconSettings } from '../ui/icons';

// their old homes, kept as re-exports so the shell, the post cards and the thread hooks import nothing new
export { IMAGE_CRED_ORDER, imageCredOf } from './connectors';
export { ImageKeyForm, openCredits, openImageConnect, setCreditsOpener, setImageConnectOpener } from './ConnectPanel';

// The full Connections surface (round 19): every provider row + its own connect flow —
// lives in the dock's Connections overlay. Same state machine as the old rail section.
export function ConnectionsList({ channelId, marketing }: { channelId: string; marketing?: string | null }) {
  // the list's own poll idiom: 5s, because a row here may be mid-OAuth
  const { states, refresh } = useConnectorStates(channelId, marketing, true);
  const [openConn, setOpenConn] = useState<ConnectorId | null>(null);
  const [killConn, setKillConn] = useState<ConnectorId | null>(null);
  const off = async (s: ConnectorState) => {
    setKillConn(null);
    try { await disconnectConnector(s, channelId); } catch { /* the 5s poll re-truths the row either way */ }
    refresh();
  };
  return (
    <div className="mkconnlist">
      {states.map((s) => {
        // an image key can be REPLACED while connected; every other row opens only to connect
        const open = openConn === s.id && (!s.connected || s.kind === 'image');
        return (
          <div key={s.id} className={`mkrailconnwrap${open ? ' open' : ''}`}>
            <div className="mkrailrow mkrailconn">
              <span aria-hidden className="mkconnmark"><ConnectorMark id={s.id} s={13} /></span><b>{s.label}</b>
              {s.connected
                ? <span className="mkconndone">
                    <span className="mkintok">✓ {s.handle ?? 'connected'}</span>
                    {s.kind === 'image'
                      ? <button className="mkico" title="Replace the key" aria-label="Replace the image generation key" onClick={() => setOpenConn(open ? null : 'images')}>change</button>
                      : killConn === s.id
                        ? <button className="mkico mkicodanger" title="Click again to disconnect" onClick={() => void off(s)}>sure?</button>
                        : <button className="mkico" title={`Disconnect ${s.label}`} aria-label={`Disconnect ${s.label}`} onClick={() => { setKillConn(s.id); setTimeout(() => setKillConn((k) => (k === s.id ? null : k)), 2600); }}><IconClose s={11} /></button>}
                  </span>
                : open
                  ? <button className="mkico" title="Close" aria-label={`Close ${s.label} setup`} onClick={() => setOpenConn(null)}><IconClose s={12} /></button>
                  : <button className="btn sm" onClick={() => setOpenConn(s.id)}>{s.dead ? 'Reconnect' : 'Connect'}</button>}
            </div>
            {open && (
              <div className={s.kind === 'image' ? 'mkconnbody' : 'mkconnpanel'}>
                <ConnectPanel id={s.id} channelId={channelId} dead={s.dead} onDone={() => { refresh(); setOpenConn(null); }} />
              </div>
            )}
          </div>
        );
      })}
      <VideoRow />
    </div>
  );
}

/** THE VIDEO ROW (the video rung, 2026-09-19): a statement of what films a video post and what it
 *  costs, read from the server (the model behind a tier is its env variable, never a key here). A
 *  Pro workspace picks among the tiers the server serves; Free films on the default tier only, or
 *  on its own Google key. The pick is a workspace setting (workspace.update videoTier). The row is
 *  FOLDED like every other row here (George, 2026-09-19: "it should be collapsed, until user clicks
 *  on the video item or a cog"): the row names the tier, the cog or the row opens the tiers. */
function VideoRow() {
  const [cat, setCat] = useState<StarterVideo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { let live = true; void (nmBridge?.starterVideo?.() ?? Promise.resolve(null)).then((c) => { if (live) setCat(c ?? null); }).catch(() => { if (live) setCat(null); }); return () => { live = false; }; }, []);
  if (cat === undefined || !cat?.served) return null;
  const active = cat.tiers.find((t) => t.tier === cat.tier) ?? cat.tiers[0];
  const pick = async (tier: string) => {
    setBusy(true);
    try { await nmBridge?.workspaceUpdate({ videoTier: tier as 'starter' | 'xpress' | 'premium' }); setCat({ ...cat, tier, pick: tier }); } catch { /* the row keeps what the server holds */ }
    setBusy(false);
  };
  return (
    <div className={`mkrailconnwrap${open ? ' open' : ''}`}>
      <div className="mkrailrow mkrailconn mkvideorow" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen((v) => !v)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}>
        <span aria-hidden className="mkconnmark"><IconPlay s={13} /></span><b>Video</b>
        <span className="mkconndone">
          <span className="mkintok">{active ? `${active.label.replace(/^NeuraMesh Video /, '')} · on credits` : 'on credits'}</span>
          <button className={`mkico${open ? ' on' : ''}`} title={open ? 'Close' : 'Configure video'} aria-label={open ? 'Close video settings' : 'Configure video'} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}><IconSettings s={12} /></button>
        </span>
      </div>
      {open && <div className="mkvideonote">
        {cat.canPick
          ? <>
              <span>NeuraMesh films video posts on the tier you pick. Your Google key is the fallback when the credits are out.</span>
              <div className="mkvideotiers" role="radiogroup" aria-label="Video tier">
                {cat.tiers.map((t) => (
                  <button key={t.tier} type="button" role="radio" aria-checked={t.tier === cat.tier} className={`mkvideotier${t.tier === cat.tier ? ' on' : ''}`} disabled={busy} onClick={() => void pick(t.tier)}>
                    <b>{t.label}</b><span>{t.model} · {t.lengths?.length ? `${Math.min(...t.lengths)} to ${Math.max(...t.lengths)} s` : `${t.seconds} s`} · {t.credits} credits for {t.seconds} s</span>
                  </button>
                ))}
              </div>
            </>
          : active && <span>NeuraMesh films video posts on <b>{active.label}</b> ({active.model}), about {active.credits} credits for {active.seconds} s{active.lengths?.length ? `, up to ${Math.max(...active.lengths)} s a film` : ''}. Your Google key is the fallback. Pro workspaces pick among {cat.tiers.length} tiers.</span>}
      </div>}
    </div>
  );
}
