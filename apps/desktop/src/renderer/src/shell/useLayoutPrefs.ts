// The shell's machine-local layout preferences — the nav's width and Home's visible scope.
//
// Both are per-machine on purpose: they are how THIS screen is set up, not what the workspace
// agrees about, so they live in localStorage and never sync. The width persists on release
// rather than on every pointer move — a drag would otherwise write a hundred times.
// Split out of App.tsx (track A5).
import { useState } from 'react';

// the nav grip's clamp (the shell round, 2026-08-10) — module scope so the boot-time
// localStorage read shares the exact bounds the drag uses
export const NAV_W_MIN = 224;
export const NAV_W_MAX = 356;
export const NAV_W_DEFAULT = 320; // 266 until 2026-09-12 (George: "a bit too tight"), 290 until the reading step that afternoon put the rail at 16px
export const clampNavW = (w: number) => Math.max(NAV_W_MIN, Math.min(NAV_W_MAX, Math.round(w)));

export function useLayoutPrefs() {
// ── the nav's width (the shell round, 2026-08-10): a hairline grip on the nav↔sheet gutter —
// the split stage's contract at the nav edge. Clamped 224–356, double-click resets 320, arrow
// keys nudge ±12 when the grip is focused. Machine-local like the theme and the fold — never
// synced — and the FOLD is untouched: ⌘\ still collapses to zero, unfold restores this width
// (the folded rule outranks the width var by specificity, so no inline-style fight).
const [navW, setNavW] = useState<number>(() => {
  try { const v = Number(localStorage.getItem('nm:navw')); return Number.isFinite(v) && v > 0 ? clampNavW(v) : NAV_W_DEFAULT; }
  catch { return NAV_W_DEFAULT; }
});
const [navWDragging, setNavWDragging] = useState(false);
const setNavWPersist = (w: number) => {
  const c = clampNavW(w);
  setNavW(c);
  try { localStorage.setItem('nm:navw', String(c)); } catch { /* private mode */ }
};
// keyboard nudges are FUNCTIONAL updates: two arrow presses in one frame both read the same
// render's navW otherwise, and the second overwrites the first (caught in the harness)
const nudgeNavW = (d: number) => setNavW((w) => {
  const c = clampNavW(w + d);
  try { localStorage.setItem('nm:navw', String(c)); } catch { /* private mode */ }
  return c;
});
// Home's visible scope retired with Home (2026-08-16): `nm:homescope` narrowed the briefing's
// sections, and the briefing is a popover now. Every destination carries its own ScopeBar; a
// notification tray with two filters on it is the chrome this round is deleting.
// ── the projects tree (2026-08-07): prefs are machine-local, like the theme and the fold ──
  return { navW, setNavW, navWDragging, setNavWDragging, setNavWPersist, nudgeNavW };
}
