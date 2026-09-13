// WHAT LANDS TODAY — the window, with no React and no PowerSync under it.
//
// Kept apart from the band on purpose: importing the component reaches @powersync/react-native,
// which a node test cannot load at all, and the window is the part worth testing. "Today" that
// leaks into tomorrow puts a post on Home a day early; "today" that starts at midnight puts one
// there that has already gone out. Both read as the band being wrong about the one thing it exists
// to be right about.
import { scheduleFirings } from '@neuramesh/shared';
import { platformName, postHeadline, postSlot, type PostItem } from './post-item';
import type { ScheduleRow } from './routine-card';

/** the minutes inside which a post is close enough that the clock itself is the news. The push
 *  reminds at thirty; the band warms at the same number, so the screen and the notification agree
 *  about what "soon" means. */
export const SOON_MIN = 30;

export interface Slot { key: string; at: Date; kind: 'run' | 'post'; id: string; title: string; sub: string; dim: boolean }

/** the rest of today, both lanes, in time order. Exported for its own test: the window is the whole
 *  feature and an off-by-one day would put tomorrow's post on today's Home. */
export function todaySlots(schedules: readonly ScheduleRow[], posts: readonly PostItem[], now: Date, roomOf: (id: string) => string = () => ''): Slot[] {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const runs = scheduleFirings(schedules.filter((s) => s.status !== 'paused'), now, end).map<Slot>((f) => ({
    key: f.key, at: f.at, kind: 'run', id: f.schedule.id, title: f.schedule.title,
    sub: `#${f.schedule.channel_slug} · routine`, dim: false,
  }));
  const items: Slot[] = [];
  for (const p of posts) {
    const at = postSlot(p);
    // scheduled ONLY: a draft has no time, and a published post has already gone
    if (!at || p.status !== 'scheduled' || at < now || at >= end) continue;
    items.push({ key: `post:${p.id}`, at, kind: 'post', id: p.id, title: postHeadline(p.body), sub: `${platformName(p.platform)} · ${roomOf(p.channel_id)}`, dim: false });
  }
  return [...runs, ...items].sort((a, b) => a.at.getTime() - b.at.getTime());
}

