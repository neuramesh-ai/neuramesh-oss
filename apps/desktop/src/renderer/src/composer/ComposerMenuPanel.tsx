import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import './permissions.css';

/** Keep composer menus outside scrolling cards and return keyboard focus to the trigger. */
export function ComposerMenuPanel({ trigger, id, label, ariaLabel = label, className = '', dismiss, children }: {
  trigger: RefObject<HTMLButtonElement | null>;
  id: string;
  label: string;
  ariaLabel?: string;
  className?: string;
  dismiss: (open: false) => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const button = trigger.current, menu = panel.current;
    if (!button || !menu) return;
    const composer = button.closest('.cbox,.hcomposer,.home-composer');
    const place = () => {
      const rect = button.getBoundingClientRect();
      const bounds = composer?.getBoundingClientRect();
      const gap = 6, margin = 8;
      const above = rect.top - gap - margin, below = window.innerHeight - rect.bottom - gap - margin;
      const up = above >= menu.scrollHeight || above >= below;
      menu.style.maxHeight = Math.max(0, up ? above : below) + 'px';
      const right = bounds && bounds.width >= menu.offsetWidth ? Math.min(bounds.right, window.innerWidth - margin) : window.innerWidth - margin;
      menu.style.left = Math.max(margin, Math.min(rect.left, right - menu.offsetWidth)) + 'px';
      menu.style.top = (up ? rect.top - gap - menu.offsetHeight : rect.bottom + gap) + 'px';
    };
    const outside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node) && !button.contains(event.target as Node)) dismiss(false);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(button);
    if (composer) observer.observe(composer);
    observer.observe(menu);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    (menu.querySelector<HTMLButtonElement>('button[aria-checked="true"]:not(:disabled)') ?? menu.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({preventScroll:true});
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
    };
  }, [trigger, dismiss]);
  return createPortal(<div ref={panel} id={id} role="menu" aria-label={ariaLabel} className={'perm-menu ' + className}
    onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
        trigger.current?.focus();
        dismiss(false);
        return;
      }
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      if (!buttons.length) return;
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
    <div className="perm-heading">{label}</div>
    {children}
  </div>, document.body);
}
