// THE SHORTCUTS BAND, as data (2026-08-16 — the shell-simplification round).
//
// The band shrank to three destinations. Home left for the bell (a count that means *someone is
// waiting on you* lives on chrome and opens a popover, never a nav row), and Tasks left for
// nothing at all — the board is deprecating, and a nav row is the last place to keep a door onto
// a surface that is coming down. What is left is Whiteboards · Scheduled · Files.
//
// **Scheduled** (relabelled from Automations — label only; the `view` keys, ids, routes and every
// doc keep `automations`/`calendar`, exactly the Board → Tasks precedent) owns two surfaces,
// Routines and Calendar. From 2026-08-13 to 2026-09-20 they nested UNDER the row as a fold with
// two child rows, and four tested rules kept that fold honest (children always present, one fill,
// the fold is the human's, a fold costs no information). **The fold retired 2026-09-20 (George):
// the two surfaces are the room tab strip on the Scheduled page** (docs/33 §8), so the row is a
// plain destination like Whiteboards and Files. What survives here: exactly ONE row carries the
// fill, and the row is lit on EITHER of its surfaces — a destination with two lenses is one door.
//
// No counts in the band at all now: armed routines and drafted posts are inventory, not attention
// (the same ruling as Whiteboards and Files), and each count rides the tab that names what it
// counts. Attention lives on the bell.

export interface NavDestRow {
  /** stable key + the `data-tour` hook; also what the click handler switches on */
  key: string;
  label: string;
  /** the selected fill. Invariant: at most one row in the returned list has this */
  on: boolean;
}

export interface NavDestInput {
  /** the shell's `nav` destination */
  nav: string;
  /** the shell's `view` within `nav === 'home'` */
  view: string;
  /** the rail's mode (the Chat | Code switch); Chat when absent */
  mode?: 'chat' | 'code';
}

/** the two surfaces the Scheduled destination switches between with its tab strip */
export const SCHEDULED_VIEWS = ['automations', 'calendar'] as const;
export const isScheduledView = (nav: string, view: string): boolean =>
  nav === 'home' && (SCHEDULED_VIEWS as readonly string[]).includes(view);

export function navDestRows({ nav, view, mode }: NavDestInput): NavDestRow[] {
  const home = nav === 'home';
  // CODE MODE (rail-ink round, 2026-09-04): the same band, code's nouns — the board where
  // repo-backed work is reviewed, and the worktrees (the footprint destination). Pull requests
  // are the board's rows, so they get no second door (two doors onto one surface).
  if (mode === 'code') {
    return [
      { key: 'tasks', label: 'Tasks', on: home && view === 'board' },
      { key: 'footprint', label: 'Worktrees', on: home && view === 'footprint' },
    ];
  }
  const rows: NavDestRow[] = [
    // no badge on Whiteboards: a count of boards is inventory, not attention (docs/38)
    { key: 'whiteboards', label: 'Whiteboards', on: home && view === 'whiteboards' },
    // lit on either surface: the tabs on the page pick the lens, the row is the door
    { key: 'scheduled', label: 'Scheduled', on: isScheduledView(nav, view) },
    { key: 'library', label: 'Files', on: nav === 'artifacts' },
  ];
  // Marketing OS (docs/design/marketing-os-2026-08): the marketing floor as a destination —
  // the Calendar/Files ungating ruling applied a third time. No badge: live marketing runs
  // already pulse on the rail rows, and asks stay on the bell (plan §7.8 resolved to none).
  rows.push({ key: 'marketing', label: 'Marketing OS', on: home && view === 'marketing' });
  // CODE — a second door, on purpose (George, 2026-09-05): "the tab is a new feature we are
  // launching; users may not be used to switching at the top yet." The row is a DOOR onto the
  // Code MODE, not a destination of its own: it never wears the fill (Code mode draws a different
  // band, so standing in Code you cannot be looking at this row), carries no count, and only the
  // Chat band lists it. The rail-ink ruling — a mode wearing a row's clothes is two doors onto one
  // surface — stands as the reason this row is a door and not a view; the launch is why it exists.
  rows.push({ key: 'code', label: 'Code', on: false });
  return rows;
}
