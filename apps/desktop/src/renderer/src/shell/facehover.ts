// THE WORKSPACE FACE's hover contract (2026-08-16), as a reducer.
//
// It exists because the first cut of the workspace foot shipped an infinite flip, and the flip
// was not a timing bug you could tune away — it was a shape:
//
//   the foot lived INSIDE the rooms face
//   → hovering it opened the projects face
//   → the rooms face went `visibility: hidden`, taking the foot with it
//   → the foot's own `mouseleave` fired, because it had vanished from under the cursor
//   → that scheduled a close
//   → the rooms face came back, putting the foot under the cursor again
//   → `mouseenter` → …forever.
//
// Two things fix it, and both are encoded here rather than described in a comment. The foot now
// renders OUTSIDE the faces (App.tsx — a hover trigger cannot live inside the thing it reveals),
// and **opening and closing have different owners**: only the FOOT may open, only leaving the
// PANEL may close. Nothing inside the column can schedule a close, so no reveal can dismiss
// itself. `faceCannotSelfDismiss` below is that claim, and src/main/facehover.test.ts checks it
// against every reachable state rather than against the one sequence we happened to think of.
//
// 2026-08-20: hover stopped opening ANYTHING. Even with the 140ms intent delay, a cursor
// passing the foot on its way elsewhere swapped the entire nav column mid-flight (George,
// live: "users hovering by mistake cause the left nav to switch"). A whole-surface swap is
// too much consequence for a hover; the face is now click-only (bar click · avatar · ⌘⇧P),
// and every open face is born pinned. The hover events stay in the contract — inert at the
// reducer, so no wiring change can quietly resurrect the old behavior — and the unpinned
// branches keep their guard rails for the states clicks can no longer reach.

export type FaceName = 'rooms' | 'projects';

export type FaceHoverEvent =
  /** the workspace bar — the ONLY thing that may open the face */
  | { type: 'foot-enter' }
  /** left the bar: drop a pending OPEN, never schedule a close */
  | { type: 'foot-leave' }
  /** back inside the column: drop a pending close */
  | { type: 'panel-enter' }
  /** left the column — the ONLY thing that may close the face */
  | { type: 'panel-leave' }
  /** the armed timer fired */
  | { type: 'settle' }
  /** a click on the bar: pin what hover opened, or toggle outright */
  | { type: 'click' }
  /** Esc, ⌘⇧P off, a nav fold — the face goes away and stays away */
  | { type: 'dismiss' };

export interface FaceState {
  face: FaceName;
  /** pinned beats hover in both directions */
  pinned: boolean;
  /** an armed transition, waiting out its intent delay */
  pending: { to: FaceName; delay: number } | null;
}

/** 240ms out: a diagonal reach from the bar into the face must not cross "outside". */
export const HOVER_OUT = 240;

export const initialFace = (): FaceState => ({ face: 'rooms', pinned: false, pending: null });

export function faceHover(s: FaceState, e: FaceHoverEvent): FaceState {
  switch (e.type) {
    case 'foot-enter':
      // hover never opens (2026-08-20) — entering the bar only steadies what is already
      // showing: drop a pending close, schedule nothing
      return s.pending ? { ...s, pending: null } : s;
    case 'foot-leave':
      // cancel a pending OPEN only. Scheduling a close here is exactly what made the flip
      // possible — the face's own arrival fires this event by hiding the bar underneath it.
      return s.pending?.to === 'projects' ? { ...s, pending: null } : s;
    case 'panel-enter':
      return s.pending?.to === 'rooms' ? { ...s, pending: null } : s;
    case 'panel-leave':
      if (s.pinned || s.face === 'rooms') return s.pending ? { ...s, pending: null } : s;
      return { ...s, pending: { to: 'rooms', delay: HOVER_OUT } };
    case 'settle':
      return s.pending ? { face: s.pending.to, pinned: s.pinned, pending: null } : s;
    case 'click':
      // an unpinned open face is unreachable now that hover cannot open — but if one ever
      // exists, a click PINS it rather than closing it under the cursor
      if (s.face === 'projects' && !s.pinned) return { face: 'projects', pinned: true, pending: null };
      return s.face === 'projects'
        ? { face: 'rooms', pinned: false, pending: null }
        : { face: 'projects', pinned: true, pending: null };
    case 'dismiss':
      return initialFace();
  }
}

/**
 * The invariant the flip violated: while the face is SHOWING, no event that can be fired from
 * inside the column may schedule a close. Only `panel-leave` — which by definition means the
 * pointer is out — is allowed to.
 */
export const INSIDE_EVENTS: FaceHoverEvent['type'][] = ['foot-enter', 'foot-leave', 'panel-enter', 'settle'];

export function faceCannotSelfDismiss(s: FaceState): boolean {
  return INSIDE_EVENTS.every((type) => {
    const next = faceHover(s, { type } as FaceHoverEvent);
    return next.face === s.face && next.pending?.to !== 'rooms';
  });
}
