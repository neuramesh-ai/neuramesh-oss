// THE POPOVER SURFACE (2026-08-17, George) — the shape the app's "bigger menu" overlays should
// have had: it grows out of the control you pressed, over nothing, and folds back into it.
//
// See `ui/anchor.ts` for why. The short version: search-every-thread, add-an-agent and new-task
// are lists, not decisions, and dimming the room to show a list charges a context switch for a
// glance. The veil stays where it belongs — a confirm you must answer, the wizard.
//
// Three families collapse into this one: `.histovl-wrap`/`.histovl-scrim`, `.rosterscrim`, and
// `Modal`'s `.overlay` (which keeps the veil, and gains `anchored` for the menus among its users).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function Popover({ label, anchor, width, align = 'start', onClose, children, className }: {
  /** the dialog's accessible name */
  label: string;
  /** viewport point to grow from — `anchorPoint()`. Null falls back to the window's centre. */
  anchor: { x: number; y: number } | null;
  /** the surface's width; it is clamped to the viewport, never trimmed below `MIN` */
  width: number;
  /** `start` opens rightward/downward of the anchor (a left-rail trigger); `end` opens leftward */
  align?: 'start' | 'end';
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  // THE ORIGIN IS A BIRTH PROPERTY, frozen at mount (George, 2026-08-17 — seen live).
  // `anchorPoint()` reads the LAST PRESS, and callers evaluate it during render, so once the
  // surface was up every click INSIDE it — a filter chip, a room tab — became the new anchor and
  // re-ran the layout effect, walking the panel down and left one click at a time. Freezing it
  // here fixes it for every caller at once, and is the honest semantics: a popover grows from
  // where it was OPENED, not from wherever the cursor has been since.
  const [origin] = useState(() => anchor);
  // a dismissal ANIMATES back into the anchor; a programmatic close (a row you picked, a submit)
  // unmounts at once — the surface has already done its job and the eye is following the result
  const dismiss = () => (origin ? setClosing(true) : onClose());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); dismiss(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !origin) return;
    const M = 12; // the frame's own margin — a popover never touches an edge
    const w = Math.min(width, window.innerWidth - M * 2);
    // WIDTH FIRST, then measure — and measure with `offsetHeight`, NOT `getBoundingClientRect()`.
    // Two ways to get this wrong, both of which shipped for one capture each:
    //  ① reading the height before the width is applied measures a box still at its intrinsic
    //     size, and a narrower box is taller — the one direction that matters here;
    //  ② `getBoundingClientRect()` returns the TRANSFORMED box, and this effect runs on the
    //     entry animation's first frame, where `nm-grow-in` has `scale(.94)`. The height came
    //     back 6% short, so the bottom clamp was 6% too generous and ⌘Y hung 32px below the
    //     fold — visible only in the Electron capture, whose window is shorter than the pane.
    //     `offsetHeight` is layout height and ignores transforms.
    el.style.width = `${Math.round(w)}px`;
    const h = el.offsetHeight;
    // clamp INSIDE the viewport rather than flipping: at these widths a flip moves the surface
    // further from its anchor than the clamp does, and the pivot already says where it came from
    const left = Math.max(M, Math.min(align === 'end' ? origin.x - w : origin.x + 14, window.innerWidth - w - M));
    const top = Math.max(M, Math.min(origin.y + 12, window.innerHeight - h - M));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    // viewport-space anchor → box-space transform-origin, so the growth starts AT the control
    el.style.transformOrigin = `${Math.round(origin.x - left)}px ${Math.round(origin.y - top)}px`;
  }, [origin, width, align]);
  return (
    <div className={`popwrap${closing ? ' closing' : ''}`} role="dialog" aria-label={label}>
      {/* click-catching, and NOTHING else: no tint, no blur. What you were looking at stays
          exactly as legible as it was — which is the whole point of the change. */}
      <div className="popscrim" onClick={dismiss} />
      <div
        ref={box}
        className={`popsurf${origin ? ' anchored' : ' centred'}${closing ? ' closing' : ''}${className ? ` ${className}` : ''}`}
        onAnimationEnd={closing ? (e) => { if (e.target === box.current) onClose(); } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
