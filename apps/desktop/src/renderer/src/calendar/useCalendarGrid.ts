// THE CALENDAR'S GRID — which days are on screen, and what lands on each of them.
//
// Split out of WorkspaceCalendar: five inputs in (the filtered posts and routines, the lens,
// and the two offsets), fifteen derivations out. Nothing here renders and nothing here fetches,
// which is why it is a hook rather than a smaller component — the component's own job is the
// two lanes and the modals.
//
// Automation firings are walked through the SAME nextScheduleRun the daemon uses, never
// re-derived: a second implementation of "when does this fire next" is a second answer.
import { useMemo } from 'react';
import { scheduleFirings } from '@neuramesh/shared';
import type { ContentItemWide, ScheduleRow } from '../bridge/rows-content';

/** one projected firing of an armed automation — the calendar's own row shape */
export type CalRun = { key: string; at: Date; sched: ScheduleRow };

export function useCalendarGrid({ shown, shownScheds, lens, weekOff, monthOff }: {
  shown: ContentItemWide[];
  shownScheds: ScheduleRow[];
  lens: 'week' | 'month';
  weekOff: number;
  monthOff: number;
}) {
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const todayKey = dayKey(new Date());
  const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
  const briefOnly = (it: ContentItemWide) => {
    try { const m = JSON.parse(it.media ?? 'null') as { brief?: string; thumb?: string; image_url?: string } | null; return !!m?.brief && !m.thumb && !m.image_url; } catch { return false; }
  };
  // A slot is what puts a post ON the grid. Published posts keep their date (they happened);
  // everything else needs `scheduled_at` or it belongs in the rail, not in a day.
  const slotOf = (it: ContentItemWide) => it.scheduled_at ?? (it.status === 'published' ? it.published_at : null);
  const unslotted = useMemo(() => shown.filter((it) => !slotOf(it)), [shown]);
  const slotted = useMemo(() => shown.filter((it) => !!slotOf(it)), [shown]);

  const monday = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weekOff * 7);
    return d;
  }, [weekOff]);
  const days = useMemo(() => [...Array(7)].map((_, i) => new Date(monday.getTime() + i * 86_400_000)), [monday]);
  const weekRange = `${monday.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${days[6]!.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;

  // month lens: the six-week page the day grid always occupies, Monday-start like the week lens
  const monthStart = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(1); d.setMonth(d.getMonth() + monthOff); return d; }, [monthOff]);
  const monthCells = useMemo(() => {
    const first = new Date(monthStart);
    first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    return [...Array(42)].map((_, i) => new Date(first.getTime() + i * 86_400_000));
  }, [monthStart]);

  const windowFrom = lens === 'week' ? monday : monthCells[0]!;
  const windowTo = lens === 'week' ? new Date(monday.getTime() + 7 * 86_400_000) : new Date(monthCells[41]!.getTime() + 86_400_000);
  const inWindow = useMemo(
    () => slotted.filter((it) => { const t = new Date(slotOf(it)!).getTime(); return t >= windowFrom.getTime() && t < windowTo.getTime(); }),
    [slotted, windowFrom, windowTo],
  );
  // Every firing of every armed routine inside the visible window — the SHARED projection
  // (scheduleFirings walks nextScheduleRun; the phone's calendar draws from the same walk)
  const runs = useMemo<CalRun[]>(
    () => scheduleFirings(shownScheds, windowFrom, windowTo).map((f) => ({ key: f.key, at: f.at, sched: f.schedule })),
    [shownScheds, windowFrom, windowTo],
  );
  const tally = useMemo(() => {
    const n = (s: string) => inWindow.filter((it) => it.status === s).length;
    return [
      runs.length && `${runs.length} run${runs.length === 1 ? '' : 's'}`,
      n('scheduled') && `${n('scheduled')} scheduled`,
      n('published') && `${n('published')} published`,
      n('failed') && `${n('failed')} failed`,
    ].filter(Boolean).join(' · ');
  }, [inWindow, runs]);
  const byDay = useMemo(() => {
    const m = new Map<string, ContentItemWide[]>();
    for (const it of inWindow) { const k = dayKey(new Date(slotOf(it)!)); m.set(k, [...(m.get(k) ?? []), it]); }
    return m;
  }, [inWindow]);
  const runsByDay = useMemo(() => {
    const m = new Map<string, CalRun[]>();
    for (const r of runs) { const k = dayKey(r.at); m.set(k, [...(m.get(k) ?? []), r]); }
    for (const list of m.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());
    return m;
  }, [runs]);
  const localTz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } }, []);


  return { briefOnly, byDay, dayKey, days, localTz, monday, monthCells, monthStart, runsByDay, slotOf, tally, timeOf, todayKey, unslotted, weekRange };
}
