// THE SIDE DOCK's rules (rail-ink round 3, 2026-09-04) — pure, so they are tested, not eyeballed.
//
// The workspace tab strip left the sheet for a column of its own at the frame's right edge
// (docs/36 §3.3 amended): the conversation is not a tab any more, it IS the sheet, and every
// other kind — file, terminal, browser, whiteboard, review — opens BESIDE it. The tab model
// (wtabs.ts) keeps its conversation record in slot 0 on purpose: it is the dock's scope subject
// (which worktree the ＋ points at) and the room-follow logic lives on it. The dock never draws it.
import type { WTab } from '../wtabs';

/** what the dock draws: every tab but the conversation, in strip order */
export function dockTabs(tabs: WTab[]): WTab[] { return tabs.filter((t) => t.kind !== 'conversation'); }

/** the dock's fronted tab — the model's active id when it names a guest, else the LAST guest (a
 *  revived tab set boots with no active id, and a strip of tabs over a blank pane is a defect);
 *  nothing when there are no guests at all */
export function dockActiveId(tabs: WTab[], activeId: string | null): string | null {
  const t = activeId ? tabs.find((x) => x.id === activeId) : undefined;
  if (t && t.kind !== 'conversation') return t.id;
  const guests = dockTabs(tabs);
  return guests.length ? guests[guests.length - 1]!.id : null;
}

/** ⌘1…⌘9 (docs/36 §3.7 amended): ⌘1 is the conversation — its composer, since the conversation
 *  never leaves the screen; ⌘2 onwards are the dock's tabs in strip order. */
export function dockKeyTarget(tabs: WTab[], digit: number): { kind: 'composer' } | { kind: 'tab'; id: string } | null {
  if (digit === 1) return { kind: 'composer' };
  const t = dockTabs(tabs)[digit - 2];
  return t ? { kind: 'tab', id: t.id } : null;
}

/** what a change in the tab set does to the fold: a guest coming to the front UNFOLDS the dock (a
 *  file you just opened must be visible), the last guest leaving FOLDS it (a column of nothing).
 *  A switch between two guests, and the human's own fold, are left alone. */
export function dockFoldAfter(prev: { active: string | null; count: number }, next: { active: string | null; count: number }): 'open' | 'close' | null {
  if (next.count === 0 && prev.count > 0) return 'close';
  if (next.active && next.active !== prev.active) return 'open';
  return null;
}
