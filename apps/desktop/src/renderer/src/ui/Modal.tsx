// The modal frame every overlay rides — extracted from App.tsx (track A3).
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {createPortal} from 'react-dom';
import { escapeCloses } from '../shell/dismiss';

// Shared modal frame: fixed header (title + optional subtitle) · scrollable body ·
// optional fixed footer (action buttons). The body is the only scrolling region, so
// long modals keep their title and Save/Cancel pinned in view. `origin` (a viewport point —
// the pill/menu row that launched the modal) pivots the motion from that point: the modal
// grows out of it on open and, on user dismissal (✕ / overlay click), collapses back into it
// before unmounting. Programmatic closes (e.g. submit success) still unmount instantly.
// Escape closes the top modal the way ✕ does (shell/dismiss.ts escapeCloses), except inside an IME
// composition or when a control inside took the key. `escape={false}` keeps a confirm standing
// while its action runs (a delete in flight): its own buttons are disabled then, and so is Escape.
// `dismissible={false}` (upstream) holds the whole modal open: ✕, the veil and Escape all wait.
export function Modal({ title, onClose, children, wide, huge, full, footer, subtitle, stack, origin, anchored, escape = true, dismissible = true }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; huge?: boolean; full?: boolean; footer?: React.ReactNode; subtitle?: React.ReactNode; stack?: boolean; origin?: { x: number; y: number } | null; /** drop the veil and grow from `origin` — for the modals that are menus, not decisions */ anchored?: boolean; /** false: Escape does not close it (a confirm whose action is running) */ escape?: boolean; /** false: nothing closes it (✕ disabled, veil and Escape ignored) */ dismissible?: boolean }) {
  const titleId=useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  // frozen at mount, for the reason ui/Popover.tsx spells out: callers read the last press during
  // render, so an un-frozen origin re-pivots on every click made INSIDE the surface
  const [pivot] = useState(() => origin);
  const dismiss = () => { if (!dismissible) return; if (pivot && boxRef.current) setClosing(true); else onClose(); };
  // the listener lives as long as the modal; the latest close, `escape` and `dismissible` ride a ref
  const keys = useRef({ dismiss, escape, dismissible });
  keys.current = { dismiss, escape, dismissible };
  useEffect(() => escapeCloses(document, () => keys.current.dismiss(), { enabled: () => keys.current.escape && keys.current.dismissible }), []);
  useEffect(()=>{if(!closing)return;const id=setTimeout(onClose,240);return()=>clearTimeout(id);},[closing,onClose]);
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
  const surface=(
    <div className={`overlay${stack ? ' stacked' : ''}${pivot ? ' pivotveil' : ''}${anchored ? ' bare' : ''}${closing ? ' closing' : ''}`} onClick={(e) => e.target === e.currentTarget && dismiss()}>
      <div ref={boxRef} role="dialog" aria-modal={!anchored} aria-labelledby={titleId} className={`modal${wide ? ' wide' : ''}${huge ? ' huge' : ''}${full ? ' full' : ''}${pivot ? ' pivot' : ''}${closing ? ' closing' : ''}`}
        onAnimationEnd={closing ? (e) => { if (e.target === boxRef.current) onClose(); } : undefined}>
        <div className="modalhead">
          <h2>
            <span id={titleId}>{title}</span>
            <button className="navpin" aria-label="Close" style={{ marginLeft: 'auto' }} disabled={!dismissible} onClick={dismiss}>✕</button>
          </h2>
          {subtitle != null && <div className="modalsub">{subtitle}</div>}
        </div>
        <div className="modalbody">{children}</div>
        {footer != null && <div className="modalfoot">{footer}</div>}
      </div>
    </div>
  );
  return typeof document==='undefined'?surface:createPortal(surface,document.body);
}
