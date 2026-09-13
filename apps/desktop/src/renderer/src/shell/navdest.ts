// THE SHORTCUTS BAND, as data (2026-08-16 — the shell-simplification round).
//
// The band shrank to three destinations. Home left for the bell (a count that means *someone is
// waiting on you* lives on chrome and opens a popover, never a nav row), and Tasks left for
// nothing at all — the board is deprecating, and a nav row is the last place to keep a door onto
// a surface that is coming down. What is left is Whiteboards · Scheduled · Files.
//
// **Scheduled** (relabelled from Automations — label only; the `view` keys, ids, routes and every
// doc keep `automations`/`calendar`, exactly the Board → Tasks precedent) still owns two surfaces,
// and the nesting it shipped with in 2026-08-13 did four things that read as chrome moving on its
// own. This module is the rebuild, and it exists as a pure function precisely so those four rules
// are testable rather than asserted in a comment:
//
//   ① The children are ALWAYS rendered while the parent is expanded — they no longer appear only
//      when you are already inside the section, which made Calendar two clicks from everywhere
//      else and put the second click's door behind the first.
//   ② EXACTLY ONE row in the band carries the fill, ever. The parent never does; standing inside
//      the group tints it (`inGroup`) instead, which is a different signal in kind rather than a
//      second, weaker selection.
//   ③ The fold is the HUMAN's (persisted in `nm:navSec`, like Shortcuts / Projects / Recents) and
//      the route never touches it.
//   ④ A fold must not cost information (docs/33 §8's rail rule): folded, the parent carries its
//      children's summed count.
//
// The parent is a fold, not a link — it toggles and never navigates, because a parent that opens
// its own default child is two doors onto one surface.

/** `item` is a plain destination · `parent` is the fold · `sub` is one of its children */
export type NavDestTier = 'item' | 'parent' | 'sub';

export interface NavDestRow {
  /** stable key + the `data-tour` hook; also what the click handler switches on */
  key: string;
  label: string;
  tier: NavDestTier;
  /** the selected fill. Invariant: at most one row in the returned list has this */
  on: boolean;
  /** the parent's quieter mark — *you are in here*, never *you are on this* */
  inGroup: boolean;
  /** informational count; 0 renders no badge */
  count: number;
  /** parents only — drives the chevron and whether the children were emitted */
  folded?: boolean;
}

export interface NavDestInput {
  /** the shell's `nav` destination */
  nav: string;
  /** the shell's `view` within `nav === 'home'` */
  view: string;
  /** `nm:navSec.scheduled` — the human's fold, never the route's. Folded by default since
   *  2026-09-12 (George): the two children are one click away, and a fresh rail reads shorter. */
  scheduledFolded: boolean;
  /** armed routines in scope */
  routines: number;
  /** drafted + scheduled posts in scope */
  calendar: number;
  /** the rail's mode (the Chat | Code switch); Chat when absent */
  mode?: 'chat' | 'code';
}

/** the fold key in `nm:navSec` — shared by the band and the shell that toggles it */
export const SCHEDULED_SEC = 'scheduled';

export function navDestRows({ nav, view, scheduledFolded, routines, calendar, mode }: NavDestInput): NavDestRow[] {
  const home = nav === 'home';
  // CODE MODE (rail-ink round, 2026-09-04): the same band, code's nouns — the board where
  // repo-backed work is reviewed, and the worktrees (the footprint destination). Pull requests
  // are the board's rows, so they get no second door (two doors onto one surface).
  if (mode === 'code') {
    return [
      { key: 'tasks', label: 'Tasks', tier: 'item', on: home && view === 'board', inGroup: false, count: 0 },
      { key: 'footprint', label: 'Worktrees', tier: 'item', on: home && view === 'footprint', inGroup: false, count: 0 },
    ];
  }
  const onRoutines = home && view === 'automations';
  const onCalendar = home && view === 'calendar';
  const rows: NavDestRow[] = [
    // no badge on Whiteboards: a count of boards is inventory, not attention (docs/38)
    { key: 'whiteboards', label: 'Whiteboards', tier: 'item', on: home && view === 'whiteboards', inGroup: false, count: 0 },
    {
      key: 'scheduled',
      label: 'Scheduled',
      tier: 'parent',
      on: false,                                   // rule ②: the parent never wears the fill
      inGroup: onRoutines || onCalendar,
      count: scheduledFolded ? routines + calendar : 0, // rule ④
      folded: scheduledFolded,
    },
  ];
  if (!scheduledFolded) {                          // rule ①: not gated on being inside the section
    rows.push({ key: 'automations', label: 'Routines', tier: 'sub', on: onRoutines, inGroup: false, count: routines });
    rows.push({ key: 'calendar', label: 'Calendar', tier: 'sub', on: onCalendar, inGroup: false, count: calendar });
  }
  rows.push({ key: 'library', label: 'Files', tier: 'item', on: nav === 'artifacts', inGroup: false, count: 0 });
  // Marketing OS (docs/design/marketing-os-2026-08): the marketing floor as a destination —
  // the Calendar/Files ungating ruling applied a third time. No badge: live marketing runs
  // already pulse on the rail rows, and asks stay on the bell (plan §7.8 resolved to none).
  rows.push({ key: 'marketing', label: 'Marketing OS', tier: 'item', on: home && view === 'marketing', inGroup: false, count: 0 });
  // CODE — a second door, on purpose (George, 2026-09-05): "the tab is a new feature we are
  // launching; users may not be used to switching at the top yet." The row is a DOOR onto the
  // Code MODE, not a destination of its own: it never wears the fill (Code mode draws a different
  // band, so standing in Code you cannot be looking at this row), carries no count, and only the
  // Chat band lists it. The rail-ink ruling — a mode wearing a row's clothes is two doors onto one
  // surface — stands as the reason this row is a door and not a view; the launch is why it exists.
  rows.push({ key: 'code', label: 'Code', tier: 'item', on: false, inGroup: false, count: 0 });
  return rows;
}
