// A POPOVER THAT LETS GO (the round-5 sweep). The Background processes popover opened on a click
// and closed only when the pointer LEFT it. A pointer that never entered it (a click on the button,
// then a move elsewhere) left it open over every later view, behind the settings dialog too, and a
// keyboard had no way to close it at all. This is the rest of the usual contract: Escape closes it,
// and so does a press outside `inside` (the popover and the button that opens it, so the button's
// own click still toggles). Pure DOM listeners, so a test drives it with a plain stand-in.
//
// AND A MODAL THAT LETS GO ON ESCAPE (the round-5 re-sweep). ui/Modal closed on its ✕ and on a
// click on the veil, and never on Escape: the sweep left Agent details open, and every later click
// landed on its overlay. `escapeCloses` is that contract for a stack of surfaces: one Escape closes
// the top one only.

type Listeners = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** an Escape that is not "close this": in a text field with an open IME composition, Escape
 *  cancels the composition (keyCode 229 is how some browsers say the same) */
const composing = (e: KeyboardEvent): boolean => e.isComposing || e.keyCode === 229;

/** close on Escape or on a pointer press outside `inside()`. Returns the unsubscribe. */
export function dismissOn(doc: Listeners, inside: () => { contains(node: Node | null): boolean } | null, close: () => void): () => void {
  const key = (e: Event): void => { if ((e as KeyboardEvent).key === 'Escape' && !composing(e as KeyboardEvent)) close(); };
  const down = (e: Event): void => {
    const box = inside();
    if (box && !box.contains(e.target as Node | null)) close();
  };
  doc.addEventListener('keydown', key);
  doc.addEventListener('pointerdown', down);
  return () => {
    doc.removeEventListener('keydown', key);
    doc.removeEventListener('pointerdown', down);
  };
}

/** `close` at most once: the popover's mouse-leave and a press outside can both fire before it
 *  unmounts, and its close is a toggle, so a second call would open it again */
export function once(close: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    close();
  };
}

/** the surfaces that Escape can close, oldest first: only the last one takes the key */
const surfaces: object[] = [];

/**
 * Escape closes this surface when it is the top one. Three Escapes do not:
 *  - one inside an open IME composition (it cancels the composition)
 *  - one a control inside already took (an open select or menu calls preventDefault). That is
 *    known only after every listener has run, so the decision waits for `later`
 *  - one that arrives while `enabled()` says no (a confirm that is mid-delete)
 * Which surface is on top is read when the key arrives, while all of them are still mounted.
 * Returns the unsubscribe.
 */
export function escapeCloses(
  doc: Listeners,
  close: () => void,
  opts: { enabled?: () => boolean; later?: (fn: () => void) => void } = {},
): () => void {
  const me = {};
  surfaces.push(me);
  const later = opts.later ?? ((fn: () => void) => { setTimeout(fn, 0); });
  const key = (e: Event): void => {
    const k = e as KeyboardEvent;
    if (k.key !== 'Escape' || composing(k) || surfaces[surfaces.length - 1] !== me) return;
    later(() => {
      if (!k.defaultPrevented && (opts.enabled?.() ?? true)) close();
    });
  };
  doc.addEventListener('keydown', key);
  return () => {
    doc.removeEventListener('keydown', key);
    const at = surfaces.indexOf(me);
    if (at >= 0) surfaces.splice(at, 1);
  };
}
