// The bell's own state (2026-08-16) — open/closed, the settle sets, and the hover-open.
// The QUEUE is pure and lives in shell/bell.ts; this is the part that has a lifetime.
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

export function useBell() {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * A card whose action the server CONFIRMED: out of the COUNT immediately, out of the LIST once
   * its collapse finishes. Not optimistic removal — this runs only after an `await` returned
   * without throwing — and both sets self-heal after 6s, so a command that succeeded WITHOUT
   * moving the row brings the card back rather than leaving it hidden inside a badge that
   * silently disagrees.
   */
  const settle = (id: string) => {
    setLeaving((x) => new Set(x).add(id));
    setGone((x) => new Set(x).add(id));
    setTimeout(() => setLeaving((x) => { const n = new Set(x); n.delete(id); return n; }), 300);
    setTimeout(() => setGone((x) => { const n = new Set(x); n.delete(id); return n; }), 6000);
  };
  return { open, setOpen, leaving, gone, busy, setBusy, settle };
}

/**
 * HOVER OPENS, CLICK PINS (2026-08-19, George, on the live app): the tray must NEVER open
 * itself. The boot peek that used to fire once per launch — open for 4.2s so the composer
 * landing could not hide eight waiting decisions — is GONE by ruling: an overlay the user did
 * not summon is the app interrupting them, whatever it is hiding. The badge carries the count;
 * intent opens the tray. Enter opens after a beat (no flyby flicker), leave closes after a
 * grace unless a CLICK pinned it — a pinned tray dismisses the ways it always did (outside
 * mousedown, esc, an action). Both handlers ride the `.bellwrap` span, so crossing from the
 * button into the popover never counts as leaving.
 */
export function useBellHover(open: boolean, setOpen: Dispatch<SetStateAction<boolean>>): {
  wrap: { onMouseEnter: () => void; onMouseLeave: () => void };
  toggle: () => void;
} {
  const pinned = useRef(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (t.current) { clearTimeout(t.current); t.current = null; } };
  // any close — outside click, esc, a card action — unpins, so the next hover behaves fresh
  useEffect(() => { if (!open) pinned.current = false; }, [open]);
  useEffect(() => clear, []);
  return {
    wrap: {
      onMouseEnter: () => { clear(); t.current = setTimeout(() => setOpen(true), 150); },
      onMouseLeave: () => { clear(); if (!pinned.current) t.current = setTimeout(() => setOpen(false), 260); },
    },
    toggle: () => { clear(); setOpen((v) => { pinned.current = !v; return !v; }); },
  };
}
