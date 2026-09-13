// The brain builder's draft — a half-built custom pack survives a closed popover and a
// reload, because losing six model picks to a stray click is the kind of small cruelty
// that stops people customising at all. Split out of brain/brain.tsx.

import { parseBrainOverride, type BrainOverride } from '@neuramesh/shared';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).


/**
 * The composer's brain draft (docs/10 §15) — machine-local and STICKY, the same class of
 * preference as the theme, the nav fold and the composer's Tasks toggle, and never synced.
 *
 * Before a conversation exists there is nowhere on the server to put a choice, so the pill on
 * Home and on a room composer edits THIS, and the send that births the thread carries it
 * (`birth_brain` → `/v1/messages` → `threads.brain_override`) exactly the way `birth_mode`
 * carries the Tasks toggle. It stays afterwards, so "every new conversation starts on opus" is
 * something you set once rather than every time.
 */
export const BRAIN_DRAFT_KEY = 'nm:brainDraft';

export function readBrainDraft(): BrainOverride | null {
  try { return parseBrainOverride(localStorage.getItem(BRAIN_DRAFT_KEY)); } catch { return null; }
}

export function writeBrainDraft(o: BrainOverride | null): void {
  try {
    const clean = parseBrainOverride(o);
    if (clean) localStorage.setItem(BRAIN_DRAFT_KEY, JSON.stringify(clean));
    else localStorage.removeItem(BRAIN_DRAFT_KEY);
    // both composers and any open pill read it on their next render
    window.dispatchEvent(new Event('nm:brains-changed'));
  } catch { /* private mode: the draft simply does not stick */ }
}
