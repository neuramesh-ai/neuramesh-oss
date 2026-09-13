// THE PAGE ARITHMETIC, ON ITS OWN (the mobile fix round, 2026-09-06).
//
// It lives apart from `sessions.ts` because that module imports PowerSync's React Native binding,
// which a plain Node test runner cannot load. The rule that decides whether a person is offered
// another page is exactly the kind of thing a test should hold, so it lives where a test can reach
// it and `sessions.ts` re-exports it.

/** How many sessions a page holds. One screen shows about eight rows, so a page is three screens
 *  of scrolling before the next one is asked for. */
export const SESSION_PAGE = 25;

/** The most pages a list will grow to. The query grows with the pages, so without a rail a long
 *  scroll walks back to the unbounded read this round removed. Eight pages is 200 sessions, the
 *  cap the shared derivation always applied, and the footer then points at History, which searches
 *  the rest rather than holding it. */
export const SESSION_MAX_PAGES = 8;

/** Is there another page? Both lists are asked for ONE row more than the page needs, so this is the
 *  answer without a second count query: a list that came back full has more behind it. */
export function hasMoreSessions(counts: { threads: number; tasks: number; asked: number }): boolean {
  return counts.threads >= counts.asked || counts.tasks >= counts.asked;
}
