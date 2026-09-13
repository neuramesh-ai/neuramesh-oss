// The type ramp as style fragments (docs/33 §5, the Foundry system): every text style picks a
// family + weight from here, never a fontWeight — expo-font registers each weight as its own
// family, so the weight IS the family name. Sizes stay at the call site; only the face is
// centralized. Weights stop at 600: the desktop folded its 700 and 800 cuts to 600 and every
// display cut to 500, and the phone bundles exactly what it can name.
import { TYPOGRAPHY } from '@neuramesh/client-core';

const W = { 400: 'Regular', 500: 'Medium', 600: 'SemiBold' } as const;
export type Weight = keyof typeof W;

export const F = {
  /** NeuraMesh Sans — all UI text; base 14, controls 11–13 */
  body: (w: Weight = 400) => ({ fontFamily: `${TYPOGRAPHY.body}_${w}${W[w]}` }),
  /** Geist Mono — kickers, chips, toks, facts, buttons, code; the wayfinding voice, tracked tight */
  mono: (w: Weight = 500) => ({ fontFamily: `${TYPOGRAPHY.mono}_${w}${W[w]}` }),
  /** NeuraMesh Sans at 500 — display moments: greetings, titles, gate heads. Track it with `tight(size)` */
  display: (w: Weight = 500) => ({ fontFamily: `${TYPOGRAPHY.display}_${w}${W[w]}` }),
  /** the display and label tracking, -0.02em as px at the size (tight, never letterspaced) */
  tight: (size: number) => Math.round(-2 * size) / 100,
  /** the mono label's tracking at its 9.5–11px sizes: -0.02em, the site's label voice */
  track: -0.2,
} as const;

/** The radius ramp, the desktop's `--r-*` tokens verbatim (docs/33 §6): controls and chips 3,
 *  inputs, menus and the composer 6, cards, sheets and modals 8. Nothing user-facing exceeds 8
 *  except what must be round: dots, rings, faces and the send. */
export const R = { xs: 3, sm: 4, md: 6, lg: 8, pill: 3, full: 999 } as const;
