// Where a surface was opened FROM (2026-08-17, George) — the point every popover grows out of.
//
// The app's overlays used to arrive the same way regardless of what opened them: centred on the
// window, over a 14px-blurred veil, "so a modal reads as the room dimming" (docs/33 §2). That is
// right for a surface you must answer — a destructive confirm, the onboarding wizard. It is wrong
// for the ones that are really just *bigger menus*: search-every-thread, add-an-agent, new task.
// Dimming the room to show a list is a context switch charged for a glance, and it hides the thing
// you were looking at when you decided you wanted the list.
//
// The bell popover is the shape those should have had all along: it grows out of its own button,
// over nothing, and folds back. `Modal` already had the motion half of this (`origin` → pivot in,
// collapse back out); what it lacked was a way for a call site to KNOW the point without threading
// a ref through every trigger — and a veil that steps aside.
//
// So the point is recorded globally, at the source: the last pointer press. That is the honest
// anchor for a click-opened surface, and it is one listener rather than an origin prop on every
// button in the product. A keyboard-opened surface (⌘Y, ⌘N) has no press to read, so callers pass
// a `fallback` selector — the control that surface belongs to, wherever it is on screen.

let last: { x: number; y: number } | null = null;

/** Install once, at the root. Capture phase: a handler that stops propagation must not blind us. */
export function watchAnchors(): () => void {
  const onDown = (e: PointerEvent) => { last = { x: e.clientX, y: e.clientY }; };
  window.addEventListener('pointerdown', onDown, true);
  return () => window.removeEventListener('pointerdown', onDown, true);
}

/**
 * The point a surface opening *now* should grow from.
 *
 * `fallback` is a CSS selector for the control the surface belongs to, used when the open came
 * from the keyboard — its centre is a truer origin than a stale click somewhere else. A press is
 * only trusted while it is FRESH (`maxAgeMs`) for the same reason: growing out of wherever the
 * cursor happened to be two minutes ago is worse than growing out of nothing.
 */
export function anchorPoint(fallback?: string): { x: number; y: number } | null {
  if (fallback) {
    const el = document.querySelector(fallback);
    if (el) {
      const r = el.getBoundingClientRect();
      // a control that is folded away or offscreen is not an anchor
      if (r.width > 0 && r.height > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  }
  return last;
}

/** Test seam — the harness drives opens without a real pointer. */
export function setAnchorPoint(p: { x: number; y: number } | null): void { last = p; }
