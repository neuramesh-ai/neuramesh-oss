// A #1046 reference, linkified with its live state.
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { STATE_LABEL } from '../task/labels';
import type { TaskRefInfo } from './parse';

export function TaskRefLink({ info, onOpen }: { info: TaskRefInfo; onOpen: (id: string) => void }) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<{ cx: number; top: number; bottom: number } | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const show = (el: HTMLElement) => { const r = el.getBoundingClientRect(); setAnchor({ cx: r.left + r.width / 2, top: r.top, bottom: r.bottom }); };
  const hide = () => { setAnchor(null); setPlace(null); };
  // Once the card is in the DOM, measure it and clamp/flip it into the viewport — direction-aware:
  // opens above the ref by default, flips below when near the top edge, and its left edge is clamped
  // so a ref near the window edge stays fully visible instead of being cut off. Runs before paint
  // (useLayoutEffect) so the card never renders in the wrong spot.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!anchor || !card) return;
    const cw = card.offsetWidth, ch = card.offsetHeight, PAD = 8;
    const left = Math.max(PAD, Math.min(anchor.cx - cw / 2, window.innerWidth - cw - PAD));
    const above = anchor.top - ch - PAD >= 0;
    setPlace({ left, top: above ? anchor.top - ch - 6 : anchor.bottom + 6 });
  }, [anchor]);
  // Md's markdown renderers are inline closures, so a live-sync re-render remounts this component
  // and wipes the hover state. If the pointer is still over us on (re)mount, restore the card —
  // useLayoutEffect (not useEffect) + no entry animation, so the remount is invisible (no blip).
  useLayoutEffect(() => { const el = spanRef.current; if (el && el.matches(':hover')) show(el); }, []);
  return (
    <span
      ref={spanRef}
      className="taskref"
      role="link"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onOpen(info.id); }}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(info.id); }}
      onMouseEnter={(e) => show(e.currentTarget as HTMLElement)}
      onMouseLeave={hide}
    >
      #{info.number}
      {/* Portaled to <body>: the message pane (.msgs) carries a top-fade mask-image, and a CSS mask
          clips its fixed descendants to the pane's box — so a card anchored near the pane's left edge
          (e.g. a ref at the start of a message in the left-nav layout) or above its top gets cut off.
          Out of the masked subtree the card is clipped by nothing, and the viewport clamp below is exact. */}
      {anchor && createPortal(
        <span ref={cardRef} className="taskrefpop" style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}>
          <span className="trtop">
            <span className={`chip c-${info.state}`}>{STATE_LABEL[info.state as keyof typeof STATE_LABEL] ?? info.state}</span>
            <b>#{info.number}</b>
          </span>
          <span className="trtitle">{info.title}</span>
          {(info.assignee || info.branch || info.pr != null) && (
            <span className="trmeta">{[info.assignee ? `@${info.assignee}` : null, info.branch, info.pr != null ? `PR #${info.pr}` : null].filter(Boolean).join(' · ')}</span>
          )}
        </span>,
        document.body,
      )}
    </span>
  );
}
