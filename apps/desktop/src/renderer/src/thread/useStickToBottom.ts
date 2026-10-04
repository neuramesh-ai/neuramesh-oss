// STICK TO THE BOTTOM, AND LET GO WHEN THE READER DOES (render round, 2026-09-24).
//
// The two transcripts followed a stream two different ways, and both were visible:
//   · the conversation set scrollTop = scrollHeight on EVERY delta, unconditionally, so a reader
//     who scrolled up to read was dragged back down twenty times a second;
//   · the task panel read the distance in an effect after paint and scrolled a frame later, so
//     the growing text dipped below the fold and snapped back, and the reveal between deltas was
//     never followed at all.
//
// One rule now, for both. The list is PINNED while the reader sits at the bottom. Growth is
// caught by a ResizeObserver on the list's rows, whose callback runs after layout and before
// paint, so the pin lands in the same frame as the growth: no read-after-write, no frame of lag.
// A reader's own scroll up (wheel, touch, keys, the scrollbar) releases the pin; coming back to
// within a few pixels of the bottom takes it again. Programmatic scrolls elsewhere (the design
// round reveal, the run dock) keep working: they only move scrollTop, and the next scroll event
// re-reads where the reader is. A jump that must hold (a run link, SessionRuns.tsx) lets go of the
// pin by name first: it dispatches `nm:unpin` on the list.
import { useLayoutEffect } from 'react';

/** how close to the bottom counts as "at the bottom" when the reader scrolls back down */
export const REPIN_PX = 32;
/** a scroll within this long of a user gesture is the user's, not ours */
const INTENT_MS = 600;

export function useStickToBottom(ref: React.RefObject<HTMLElement | null>, resetKey: unknown): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let pinned = true;
    let intentAt = -Infinity;
    const pin = () => { if (pinned) el.scrollTop = el.scrollHeight; };
    pin(); // a thread opens at its newest message
    const ro = new ResizeObserver(pin);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    // a new row gets observed; its first observation pins it (after layout, never a forced one)
    const mo = new MutationObserver((recs) => {
      for (const r of recs) r.addedNodes.forEach((n) => { if (n instanceof Element) ro.observe(n); });
    });
    mo.observe(el, { childList: true });
    const intent = () => { intentAt = performance.now(); };
    const onWheel = (e: WheelEvent) => { intent(); if (e.deltaY < 0) pinned = false; };
    const onKey = (e: KeyboardEvent) => { intent(); if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) pinned = false; };
    const unpin = () => { pinned = false; };
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (gap <= REPIN_PX) pinned = true;
      else if (performance.now() - intentAt < INTENT_MS) pinned = false;
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', intent, { passive: true });
    el.addEventListener('pointerdown', intent, { passive: true });
    el.addEventListener('keydown', onKey);
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('nm:unpin', unpin);
    return () => {
      ro.disconnect(); mo.disconnect();
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', intent);
      el.removeEventListener('pointerdown', intent);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('nm:unpin', unpin);
    };
  }, [ref, resetKey]);
}
