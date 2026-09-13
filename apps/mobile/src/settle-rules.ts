// SETTLE, the pure half (the thread-status round, 2026-09-08). Kept apart from settle.ts, which
// reaches SecureStore and the API, so a node test can hold these without the phone's runtime.

/** the later of two ISO moments — a local settle rides ahead of the synced stamp until sync catches up */
export function laterOf(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

/** how long the undo pill holds a settle before it is just settled */
export const UNDO_MS = 5000;

/**
 * THE SWIPE SHOWS ITSELF (George, 2026-09-08: "there's no indication to the user that they can swipe
 * to settle"). The top needs-you row peeks once per launch until the person has settled a thread
 * once; a reduced-motion setting turns the peek into a line of text instead.
 */
export function shouldPeek(i: { reduceMotion: boolean; settledOnce: boolean; peekedThisLaunch: boolean; rows: number }): boolean {
  return !i.reduceMotion && !i.settledOnce && !i.peekedThisLaunch && i.rows > 0;
}
