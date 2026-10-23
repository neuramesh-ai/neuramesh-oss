import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

function positionPreview(box: HTMLDivElement, trigger: HTMLButtonElement | null, variant: 'dock' | 'float') {
  const anchor = trigger?.getBoundingClientRect();
  if (!anchor) return;
  const margin = 12;
  box.style.width = `${Math.min(304, window.innerWidth - margin * 2)}px`;
  const right = variant === 'dock' && anchor.right + 8 + box.offsetWidth <= window.innerWidth - margin;
  const x = right ? anchor.right + 8 : anchor.left;
  const y = right ? anchor.bottom - box.offsetHeight : anchor.top - 8 - box.offsetHeight;
  box.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - box.offsetWidth - margin))}px`;
  box.style.top = `${Math.max(margin, Math.min(y, window.innerHeight - box.offsetHeight - margin))}px`;
}

/** A quiet progress control. Details are transient, never restored open at startup. */
export function SetupPreview({ done, total, variant, children }: {
  done: number; total: number; variant: 'dock' | 'float'; children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);
  const returningFocus = useRef(false);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const close = () => { clear(); pinned.current = false; setOpen(false); };
  const closeAndFocus = () => {
    close(); returningFocus.current = true;
    trigger.current?.focus({ preventScroll: true });
    returningFocus.current = false;
  };
  const enter = () => { clear(); timer.current = setTimeout(() => setOpen(true), 140); };
  const leave = () => {
    clear();
    if (!pinned.current) timer.current = setTimeout(() => {
      if (!panel.current?.contains(document.activeElement)) setOpen(false);
    }, 180);
  };
  const focusPanel = () => requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('button')?.focus());
  useEffect(() => clear, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeAndFocus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  });
  useLayoutEffect(() => {
    if (!open || !panel.current || !trigger.current) return;
    const box = panel.current;
    const place = () => positionPreview(box, trigger.current, variant);
    place();
    const observer = new ResizeObserver(place);
    observer.observe(box);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, variant]);
  const control = <div className={variant === 'dock' ? 'setupdocked' : 'setupdock'}>
    <button ref={trigger} className="setupstatus" aria-label={`Setup progress: ${done} of ${total} complete`}
      aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
      onPointerEnter={event => { if (event.pointerType !== 'touch') enter(); }} onPointerLeave={leave}
      onFocus={event => { if (!returningFocus.current && event.currentTarget.matches(':focus-visible')) { clear(); setOpen(true); } }}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); clear(); pinned.current = true; setOpen(true); focusPanel(); } }}
      onClick={event => {
        clear();
        if (pinned.current) close();
        else { pinned.current = true; setOpen(true); if (event.detail === 0) focusPanel(); }
      }}>
      <svg viewBox="0 0 30 30" aria-hidden="true">
        <circle className="setuptrack" cx="15" cy="15" r="12.5" />
        <circle className="setuparc" cx="15" cy="15" r="12.5" pathLength="100" transform="rotate(-90 15 15)"
          strokeDasharray="100" strokeDashoffset={100 - Math.max(0, Math.min(1, total > 0 ? done / total : 0)) * 100} />
        <text x="15" y="15" textAnchor="middle" dominantBaseline="central">{done}/{total}</text>
      </svg>
    </button>
    {open && createPortal(<div ref={panel} id={id} className="setupflyout" role="dialog" aria-label="Setup checklist"
      onPointerEnter={clear} onPointerLeave={leave} onFocus={clear}>
      {children(closeAndFocus)}
    </div>, document.body)}
  </div>;
  return variant === 'float' ? createPortal(control, document.body) : control;
}
