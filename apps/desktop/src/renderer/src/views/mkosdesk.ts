// THE DESK'S PURE HALF (the Marketing OS desk round, 2026-09-17; docs/design/marketing-os-desk-2026-09).
// The destination is ONE page in today's order: the desk, the playbooks, the threads underneath as
// you scroll. ONE bar under the desk carries the pills at the left and the two section words at the
// right. The words are subheadings, not tabs: a click scrolls to the section, the bar sticks, and the
// lit word follows the section under it. Everything the bar decides lives here without React, so
// src/main/mkosdesk.test.ts can assert it the way navdest.test.ts asserts the Shortcuts band.
import { PLAYBOOKS, type PlaybookGroup } from '@neuramesh/shared';

export type DeskSection = 'playbooks' | 'threads';
export const DESK_SECTIONS: readonly DeskSection[] = ['playbooks', 'threads'];
export const DESK_SECTION_LABEL: Record<DeskSection, string> = { playbooks: 'Playbooks', threads: 'Threads' };
export const PLAYBOOK_GROUPS: readonly PlaybookGroup[] = ['foundations', 'content', 'campaigns'];
export const PLAYBOOK_GROUP_LABEL: Record<PlaybookGroup, string> = { foundations: 'Foundations', content: 'Content', campaigns: 'Campaigns' };

/** the group chips' counts over the whole catalog — a chip and its list agree by construction */
export function groupCounts(): Record<PlaybookGroup, number> & { all: number } {
  const c = { all: PLAYBOOKS.length, foundations: 0, content: 0, campaigns: 0 };
  for (const pb of PLAYBOOKS) c[pb.group] += 1;
  return c;
}

export interface DeskGeometry {
  /** the scroller's scrollTop */
  scrollTop: number;
  /** the threads section's top, in the scroller's content coordinates */
  threadsTop: number;
  /** the bar's height — stuck, its bottom edge sits at scrollTop + barHeight */
  barHeight: number;
  /** scrollHeight - clientHeight: where the scroller stops */
  maxScroll: number;
}

/** the section under the bar. The threads own the word once their head has reached the bar's bottom
 *  edge, or once the page cannot scroll any further (a short list still earns its word). */
export function sectionAt(g: DeskGeometry): DeskSection {
  if (g.scrollTop + g.barHeight >= g.threadsTop - 1) return 'threads';
  if (g.maxScroll > 0 && g.scrollTop >= g.maxScroll - 1) return 'threads';
  return 'playbooks';
}

/** where a click on a word scrolls to: the section's head lands under the bar, never past the end */
export function scrollTargetFor(section: DeskSection, g: Pick<DeskGeometry, 'threadsTop' | 'barHeight' | 'maxScroll'>): number {
  if (section === 'playbooks') return 0;
  return Math.max(0, Math.min(g.threadsTop - g.barHeight, g.maxScroll));
}

/** the hand-off's length: docs/33 §7's --dur-studio, a column hand-off is one gesture, slower than an entrance */
export const HANDOFF_MS = 420;

// The signature ease, cubic-bezier(.22, 1, .36, 1) (--ease), solved for a scripted scroll: x(u) = t by
// Newton's method, then y(u). P0 = (0,0) and P3 = (1,1), so the cubic reduces to the two control points.
const P1X = 0.22, P1Y = 1, P2X = 0.36, P2Y = 1;
const bez = (a: number, b: number, u: number) => 3 * a * u * (1 - u) * (1 - u) + 3 * b * u * u * (1 - u) + u * u * u;
const bezDx = (u: number) => 3 * P1X * (1 - u) * (1 - u) + 6 * (P2X - P1X) * u * (1 - u) + 3 * (1 - P2X) * u * u;
export function signatureEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let u = t;
  for (let i = 0; i < 8; i++) {
    const x = bez(P1X, P2X, u) - t;
    if (Math.abs(x) < 1e-5) break;
    const dx = bezDx(u);
    if (dx < 1e-6) break;
    u -= x / dx;
  }
  return bez(P1Y, P2Y, Math.min(1, Math.max(0, u)));
}

/** what a catalog row rests on when no project is picked: the NEWEST state across the rooms in scope,
 *  with its room, because the scope does not say the project. An armed cadence with no run yet counts;
 *  a room with neither is skipped, so the row says "never run" only when every room has nothing. */
export interface DeskState { lastAt: string | null; lastScore: number | null; armed: string | null }
export function newestState<S extends DeskState>(entries: ReadonlyArray<{ roomId: string; state: S | undefined }>): { roomId: string; state: S } | null {
  let best: { roomId: string; state: S } | null = null;
  for (const e of entries) {
    if (!e.state || (!e.state.lastAt && !e.state.armed)) continue;
    if (!best || (e.state.lastAt ?? '') > (best.state.lastAt ?? '')) best = { roomId: e.roomId, state: e.state };
  }
  return best;
}
