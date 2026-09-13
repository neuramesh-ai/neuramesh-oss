// Connections — the provider/connector credential list in workspace settings.
// Extracted from App.tsx (track A2). The composer-foot round (2026-09-11) moved the per-provider
// connect step to ConnectPanel.tsx and the "connected" verdict to connectors.ts, so this list and
// the composer foot read ONE derivation and render ONE flow; the rows and their open state stay here.
import { IconClose } from '../ui/icons';
import { ConnectorMark } from './connector-marks';
import { ConnectPanel, disconnectConnector } from './ConnectPanel';
import { type ConnectorId, type ConnectorState } from './connectors';
import { useConnectorStates } from './useConnectorStates';
import { useState } from 'react';

// their old homes, kept as re-exports so the shell, the post cards and the thread hooks import nothing new
export { IMAGE_CRED_ORDER, imageCredOf } from './connectors';
export { ImageKeyForm, openImageConnect, setImageConnectOpener } from './ConnectPanel';

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
    </div>
  );
}
