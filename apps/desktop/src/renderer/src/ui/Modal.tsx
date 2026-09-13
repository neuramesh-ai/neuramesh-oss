// The modal frame every overlay rides — extracted from App.tsx (track A3).
import { useLayoutEffect, useRef, useState } from 'react';

// Shared modal frame: fixed header (title + optional subtitle) · scrollable body ·
// optional fixed footer (action buttons). The body is the only scrolling region, so
// long modals keep their title and Save/Cancel pinned in view. `origin` (a viewport point —
// the pill/menu row that launched the modal) pivots the motion from that point: the modal
// grows out of it on open and, on user dismissal (✕ / overlay click), collapses back into it
// before unmounting. Programmatic closes (e.g. submit success) still unmount instantly.
export function Modal({ title, onClose, children, wide, huge, full, footer, subtitle, stack, origin, anchored }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; huge?: boolean; full?: boolean; footer?: React.ReactNode; subtitle?: React.ReactNode; stack?: boolean; origin?: { x: number; y: number } | null; /** drop the veil and grow from `origin` — for the modals that are menus, not decisions */ anchored?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  // frozen at mount, for the reason ui/Popover.tsx spells out: callers read the last press during
  // render, so an un-frozen origin re-pivots on every click made INSIDE the surface
  const [pivot] = useState(() => origin);
  const dismiss = () => { if (pivot && boxRef.current) setClosing(true); else onClose(); };
  // anchor the transform to the launcher: origin is viewport-space, transform-origin is box-space
  useLayoutEffect(() => {
    if (!pivot || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    boxRef.current.style.transformOrigin = `${pivot.x - r.left}px ${pivot.y - r.top}px`;
  }, [pivot]);
  // ANCHORED (2026-08-17, George): a modal that is really a bigger MENU drops the veil entirely
  // and grows out of its launcher — the bell popover's shape, shared (ui/Popover.tsx, ui/anchor.ts).
  // The veil stays the default, because it is still right for a surface you must ANSWER: a
  // destructive confirm, the wizard. What changed is which surfaces count as that.
  return (
    <div className={`overlay${stack ? ' stacked' : ''}${pivot ? ' pivotveil' : ''}${anchored ? ' bare' : ''}${closing ? ' closing' : ''}`} onClick={(e) => e.target === e.currentTarget && dismiss()}>
      <div ref={boxRef} className={`modal${wide ? ' wide' : ''}${huge ? ' huge' : ''}${full ? ' full' : ''}${pivot ? ' pivot' : ''}${closing ? ' closing' : ''}`}
        onAnimationEnd={closing ? (e) => { if (e.target === boxRef.current) onClose(); } : undefined}>
        <div className="modalhead">
          <h2>
            {title}
            <button className="navpin" style={{ marginLeft: 'auto' }} onClick={dismiss}>✕</button>
          </h2>
          {subtitle != null && <div className="modalsub">{subtitle}</div>}
        </div>
        <div className="modalbody">{children}</div>
        {footer != null && <div className="modalfoot">{footer}</div>}
      </div>
    </div>
  );
}
