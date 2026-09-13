// Agent + project faces — extracted from App.tsx (track A3).
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AgentDirectory } from '../context/AgentDirectory';
import { thumbAvatar } from '../lib/persona';
import { runtimeLabel } from '../lib/runtimes';
import type { AgentRow } from '../bridge/rows-crew';

export function AgentAvatar({ name, size = 26, radius, interactive }: { name: string; emoji?: string | null; size?: number; radius?: number; role?: string | null; interactive?: boolean }) {
  const dir = useContext(AgentDirectory);
  const tile = (
    <span
      className="pav"
      style={{ width: size, height: size, minWidth: size, borderRadius: radius ?? Math.max(6, Math.round(size * 0.29)) }}
      aria-hidden
    >
      <img className="pavg" src={thumbAvatar(name)} alt="" draggable={false} />
    </span>
  );
  // The face becomes a door only where it is asked to (message rows). Default-off on purpose:
  // the roster tiles and crew clusters already sit INSIDE buttons, and a control nested in a
  // control is both invalid markup and two handlers firing on one click.
  const agent = interactive ? dir?.byName.get((name || '').trim().toLowerCase()) : undefined;
  if (!agent || !dir) return tile;
  return <AgentFace agent={agent} onOpen={dir.open}>{tile}</AgentFace>;
}

/**
 * Hover an agent's face → who it is; click → the full record.
 *
 * The popover mechanics are TaskRef's, for the two reasons that component learned them: it
 * portals to <body> (the message pane carries a mask-image, and a CSS mask clips its fixed
 * descendants, so a card near the pane's edge gets cut off), and it measures itself to flip
 * above/below with a clamped left edge (§9.6 — flipped tooltips entering from off-screen).
 *
 * The peek deliberately does NOT show instructions (founder call): a glance wants identity —
 * who, what they do in one line, where they work, whether they are busy. The one line is the
 * routing `description`, which is capped at 280 server-side, so this card cannot grow into a
 * wall of prose no matter what anyone types.
 */
export function AgentFace({ agent, onOpen, children }: { agent: AgentRow; onOpen: (a: AgentRow) => void; children: React.ReactNode }) {
  const [anchor, setAnchor] = useState<{ cx: number; top: number; bottom: number } | null>(null);
  // `above` drives which direction the card grows FROM — a card that opens below the face
  // should rise from its top edge, not fall from it (§9.6: mirrored anchors need mirrored offsets)
  const [place, setPlace] = useState<{ left: number; top: number; above: boolean } | null>(null);
  // 'leaving' keeps the card mounted through its exit animation — unmounting on mouseleave made
  // it vanish on a hard cut, which is what read as cheap next to the rest of the app's motion
  const [leaving, setLeaving] = useState(false);
  const spanRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLSpanElement>(null);
  const openT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (openT.current) clearTimeout(openT.current); if (closeT.current) clearTimeout(closeT.current); openT.current = closeT.current = null; };
  useEffect(() => clear, []);

  // HOVER INTENT: a message list is a column of faces, and opening on contact meant sweeping the
  // pointer down it strobed a card per avatar. 120ms of dwell is below notice when you mean it and
  // silent when you don't.
  const show = (el: HTMLElement) => {
    clear();
    setLeaving(false);
    openT.current = setTimeout(() => {
      const r = el.getBoundingClientRect();
      setAnchor({ cx: r.left + r.width / 2, top: r.top, bottom: r.bottom });
    }, 120);
  };
  const hide = () => {
    clear();
    setAnchor((a) => { if (a) setLeaving(true); return a; });
    // outlives the .12s exit; §7's guarded-exit rule — a timeout, never an animationend alone,
    // so reduced-motion (which skips the animation entirely) can't strand the card on screen
    closeT.current = setTimeout(() => { setAnchor(null); setPlace(null); setLeaving(false); }, 150);
  };
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!anchor || !card) return;
    const cw = card.offsetWidth, ch = card.offsetHeight, PAD = 8;
    const left = Math.max(PAD, Math.min(anchor.cx - cw / 2, window.innerWidth - cw - PAD));
    const above = anchor.top - ch - PAD >= 0;
    setPlace({ left, top: above ? anchor.top - ch - 6 : anchor.bottom + 6, above });
  }, [anchor]);
  const live = agent.status === 'working' || agent.status === 'thinking' || agent.status === 'review';
  const presence = agent.retired_at ? 'retired' : live ? agent.status : agent.status === 'online' ? 'online' : 'offline';
  return (
    <span
      ref={spanRef}
      className="pavbtn"
      role="button"
      tabIndex={0}
      aria-label={`${agent.name} — ${agent.role}`}
      onClick={(e) => { e.stopPropagation(); clear(); setAnchor(null); setLeaving(false); onOpen(agent); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(agent); } }}
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={hide}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={hide}
    >
      {children}
      {anchor && createPortal(
        // The peek is IDENTITY ONLY (founder call, 2026-08-05). The room chips came off because an
        // orchestrator auto-joins every channel in the workspace — rex rendered fifteen of them and
        // the card became a wall of pills that said nothing about who it was hovering. The
        // "click for details" caption came off with them: the lift and the cursor already say it.
        <span
          ref={cardRef}
          className={`agentpop${leaving ? ' leaving' : ''}${place?.above ? ' above' : ' below'}`}
          style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}
        >
          <span className="aptop">
            <AgentAvatar name={agent.name} size={44} radius={12} />
            <span className="apname">
              <b>{agent.name}<span className="rolechip" data-role={agent.role}>{agent.role}</span></b>
              <span className="apseat">{agent.kind === 'remote' ? 'External A2A agent' : `${runtimeLabel(agent.runtime)} · ${agent.model}`}</span>
            </span>
            <span className={`appresence ${live ? 'busy' : presence === 'online' ? 'on' : 'off'}`}><i className="apd" />{presence}</span>
          </span>
          {agent.description && <span className="apdesc">{agent.description}</span>}
        </span>,
        document.body,
      )}
    </span>
  );
}

// A project's face: its detected logo (data: URL in the synced projects.logo_url) in a
// rounded tile, falling back to the name's initial. onError flips a broken stored image
// back to the letter so a bad byte can never leave a blank hole in the switcher.
export function ProjLogo({ logo, name, size = 20, radius, className }: { logo?: string | null; name: string; size?: number; radius?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [logo]);
  const showImg = !!logo && !broken;
  return (
    <span
      className={`projlogo${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, minWidth: size, borderRadius: radius ?? Math.max(5, Math.round(size * 0.24)), fontSize: Math.round(size * 0.46) }}
      aria-hidden
    >
      {showImg ? <img src={logo} alt="" draggable={false} onError={() => setBroken(true)} /> : (name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}
