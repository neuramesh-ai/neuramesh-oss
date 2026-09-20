// THE COMPOSER FOOT'S MARKS (the composer-foot round, 2026-09-11; visual contract
// docs/design/composer-foot-2026-09): the four publishing connectors as marks at the foot's right,
// then ⋯ for the rest. A mark is a DOOR: not connected opens the connect step in the composer's own
// popover recipe (the machine chip's), connected shows the account and Disconnect, ⋯ lists every
// connector as icon · name · state — the machine-chip row idiom (George, 2026-09-05: rows are
// icons, not words; the word lives in the tooltip).
//
// State is the ONE derivation the room's Connections list reads (settings/connectors.ts), for the
// room the composer targets: accounts are workspace-wide, keys are this machine's plus the room's
// own flag, so the verdict here is exactly the verdict in that room's list.
import { useEffect, useState } from 'react';
import { IconArrowL, IconEllipsis } from '../ui/icons';
import { CONNECTORS, FOOT_MARKS, type ConnectorId, type ConnectorState } from '../settings/connectors';
import { ConnectorMark } from '../settings/connector-marks';
import { ConnectPanel, disconnectConnector } from '../settings/ConnectPanel';
import { useConnectorStates } from '../settings/useConnectorStates';
import { errMsg } from '../lib/text';
import { flashToast } from '../lib/toast';

type Face = { id: 'list' } | { id: ConnectorId; back: boolean };

const wordOf = (s: ConnectorState) => (s.connected ? 'connected' : s.dead ? 'authorize again' : 'not connected');
const tipOf = (s: ConnectorState) => (s.connected ? `${s.label} · ${s.handle ?? 'connected'}` : s.dead ? `Reconnect ${s.label}` : `Connect ${s.label}`);
const CONNECTED_LINE: Record<ConnectorId, string> = {
  x: 'neuramesh publishes to X through this connection. Your agents also read X through it.',
  linkedin: 'neuramesh publishes to your LinkedIn profile only after you approve a post.',
  instagram: 'neuramesh publishes to Instagram only after you approve a post.',
  tiktok: 'An approved draft lands in your TikTok inbox. You publish it in the TikTok app.',
  github: 'Your agents read this repository through the neuramesh app on GitHub: releases, pull requests and files. It never writes.',
  posthog: 'Your agents read PostHog through this key.',
  meta: 'Your agents reach this Meta Ads account through the connector.',
  tiktokads: 'Your agents reach this TikTok Ads account through the connector.',
  images: 'Your designer draws post images on this key.',
};

export function ConnectorMarks({ channelId, marketing }: { channelId: string | null; marketing?: string | null }) {
  const [face, setFace] = useState<Face | null>(null);
  const { states, refresh } = useConnectorStates(channelId, marketing, !!face);
  useEffect(() => {
    if (!face) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFace(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [face]);
  // the room chip moved under an open step: the step was about the old room's keys
  useEffect(() => { setFace(null); }, [channelId]);
  if (!channelId) return null;
  // the derivation maps the whole registry, so every id resolves
  const byId = (id: ConnectorId) => states.find((s) => s.id === id) ?? { ...CONNECTORS.find((c) => c.id === id)!, connected: false, handle: null, dead: null, conn: null };
  const rest = CONNECTORS.length - FOOT_MARKS.length;
  const listOpen = face?.id === 'list';
  const done = () => { refresh(); setFace(null); };
  return (
    <div className="cfootapps">
      {FOOT_MARKS.map((id) => {
        const s = byId(id);
        const open = face?.id === id;
        const tip = tipOf(s);
        return (
          <button key={id} type="button" className={`cfootapp${s.connected ? ' on' : ''}${open ? ' open' : ''}`} aria-label={tip} data-tip={tip}
            aria-haspopup="dialog" aria-expanded={open} onClick={() => setFace(open ? null : { id, back: false })}>
            <ConnectorMark id={id} s={16} />
            {(s.connected || s.dead) && <span className={`cfootdot${s.dead ? ' warn' : ''}`} aria-hidden />}
          </button>
        );
      })}
      <button type="button" className={`cfootapp${listOpen ? ' open' : ''}`} aria-label={`${rest} more connections`} data-tip={`${rest} more connections`}
        aria-haspopup="dialog" aria-expanded={listOpen} onClick={() => setFace(listOpen ? null : { id: 'list' })}>
        <IconEllipsis s={16} />
      </button>
      {face && (
        <>
          <div className="projmenu-scrim" onClick={() => setFace(null)} />
          <div className="cprojpop cmachpop connpop" role="dialog" aria-label={face.id === 'list' ? 'Connections' : byId(face.id).label}>
            {face.id === 'list'
              ? <ConnList states={states} onPick={(id) => setFace({ id, back: true })} />
              : <ConnFace s={byId(face.id)} channelId={channelId} back={face.back ? () => setFace({ id: 'list' }) : null} onDone={done} onRefresh={refresh} />}
          </div>
        </>
      )}
    </div>
  );
}

/** every connector, one row each: icon · name · account · state icon */
function ConnList({ states, onPick }: { states: ConnectorState[]; onPick: (id: ConnectorId) => void }) {
  return (
    <>
      <div className="connkick">Connections</div>
      {states.map((s) => {
        const word = wordOf(s);
        const who = s.handle ?? s.dead?.handle ?? null;
        return (
          <button key={s.id} type="button" className="cprojitem" onClick={() => onPick(s.id)}>
            <span className="cprojglyph"><ConnectorMark id={s.id} s={13} /></span>
            <span className="connrowtxt"><b>{s.label}</b>{who && <span className="connsub">{who}</span>}</span>
            <span className={`cmachst ${s.connected ? 'on' : s.dead ? 'warn' : 'off'}`} role="img" aria-label={word} data-tip={word}>{s.connected || s.dead ? '●' : '○'}</span>
          </button>
        );
      })}
      <div className="cmachfoot">Accounts belong to the workspace. Keys stay on this machine.</div>
    </>
  );
}

/** one connector: connected shows the account and its one reverse act; otherwise the connect step */
function ConnFace({ s, channelId, back, onDone, onRefresh }: { s: ConnectorState; channelId: string; back: (() => void) | null; onDone: () => void; onRefresh: () => void }) {
  // the two-step off (the Connections list's idiom): Disconnect arms "Sure?" for 2.6s
  const [armed, setArmed] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const off = async () => {
    setArmed(false);
    try { await disconnectConnector(s, channelId); onDone(); }
    catch (e) { flashToast(errMsg(e)); onRefresh(); }
  };
  return (
    <>
      <div className="connhead">
        {back && <button type="button" className="connback" aria-label="Back to all connections" onClick={back}><IconArrowL s={12} /></button>}
        <span className="connmark" aria-hidden><ConnectorMark id={s.id} s={16} /></span>
        <b>{s.label}</b>
        <span className={`cprojtag${s.connected ? ' on' : ''}`}>{wordOf(s)}</span>
        {s.connected && s.handle && <span className="connsub">{s.handle}</span>}
      </div>
      <div className="connpopbody">
        {s.connected && !replacing
          ? (
            <>
              <p>{CONNECTED_LINE[s.id]}</p>
              <div className="connacts">
                {s.kind === 'image'
                  ? <button type="button" className="btn ghost sm" onClick={() => setReplacing(true)}>Replace the key</button>
                  : armed
                    ? <button type="button" className="btn ghost sm danger" onClick={() => void off()}>Sure?</button>
                    : <button type="button" className="btn ghost sm" onClick={() => { setArmed(true); setTimeout(() => setArmed(false), 2600); }}>Disconnect</button>}
              </div>
            </>
          )
          : <ConnectPanel id={s.id} channelId={channelId} dead={s.dead} onDone={onDone} />}
      </div>
    </>
  );
}
