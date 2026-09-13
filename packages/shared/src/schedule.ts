// Schedule cadence math (marketing-channel plan §4.6). Pure and tz-correct via Intl —
// no date library. cadence is a small enum + local time-of-day in an IANA tz (what the
// picker collects), never raw cron: the server computes the FIRST next_run_at at arm
// time, the daemon recomputes each subsequent one with this same helper, and the two
// can't drift because both call here.

export const SCHEDULE_CADENCES = ['once', 'daily', 'weekdays', 'weekly'] as const;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** ms offset of `tz` from UTC at instant `t` (positive east of UTC). */
function tzOffsetMs(tz: string, t: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(t)).map((x) => [x.type, x.value])) as Record<string, string>;
  const asUtc = Date.UTC(+p['year']!, +p['month']! - 1, +p['day']!, +p['hour']! % 24, +p['minute']!, +p['second']!);
  return asUtc - t;
}

/** The UTC instant of a wall-clock date+time in `tz` (two-pass for DST edges). */
function wallToInstant(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - tzOffsetMs(tz, guess);
  t = guess - tzOffsetMs(tz, t);
  return new Date(t);
}

/** Wall-clock parts of instant `t` in `tz`. */
function wallParts(tz: string, t: number): { y: number; m: number; d: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(dtf.formatToParts(new Date(t)).map((x) => [x.type, x.value])) as Record<string, string>;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p['weekday']!);
  return { y: +p['year']!, m: +p['month']!, d: +p['day']!, weekday: wd };
}

/**
 * The next fire instant STRICTLY AFTER `after` for a recurring cadence ('once' has no
 * next — the client supplies its exact runAt). Returns null for 'once' or bad input.
 * weekday (0=Sun..6=Sat) applies to 'weekly' only; 'weekdays' = Mon–Fri.
 */
export function nextScheduleRun(input: {
  cadence: ScheduleCadence;
  atTime: string;
  tz: string;
  weekday?: number | null;
  after: Date;
}): Date | null {
  const { cadence, atTime, tz, after } = input;
  if (cadence === 'once') return null;
  const m = TIME_RE.exec(atTime);
  if (!m) return null;
  const hh = +m[1]!;
  const mm = +m[2]!;
  try {
    // walk day by day from `after`'s local date (candidate at hh:mm may already be past today)
    for (let i = 0; i <= 8; i++) {
      const probe = wallParts(tz, after.getTime() + i * 86_400_000);
      const cand = wallToInstant(probe.y, probe.m, probe.d, hh, mm, tz);
      if (cand.getTime() <= after.getTime()) continue;
      if (cadence === 'weekdays' && (probe.weekday === 0 || probe.weekday === 6)) continue;
      if (cadence === 'weekly' && input.weekday != null && probe.weekday !== input.weekday) continue;
      return cand;
    }
    return null; // unreachable for valid input (8 days covers every cadence)
  } catch {
    return null; // bad IANA tz
  }
}

// ── The calendar's projection and the routine card's words (the mobile-cloud round, S4) ──────────
// Both clients draw "when does this fire" from HERE, never from a second implementation: the
// desktop's calendar grid walked its own loop over nextScheduleRun, and the phone would have been a
// third answer. One projection, tested once.

export interface FiringSource {
  id: string;
  cadence: string;
  at_time: string;
  tz: string;
  weekday?: number | null;
  next_run_at: string | null;
}

export interface Firing<S extends FiringSource> {
  key: string;
  at: Date;
  schedule: S;
}

/**
 * Every firing of every schedule inside [from, to), walked through the SAME helper that computes
 * next_run_at. `once` has no recurrence (nextScheduleRun returns null for it by contract), so it
 * rides its stored next_run_at. The step guard is a belt-and-braces stop: a cadence that somehow
 * failed to advance would otherwise spin here. Callers decide WHICH schedules to project (armed,
 * paused-and-dimmed, a room's) — this only answers "when".
 */
export function scheduleFirings<S extends FiringSource>(schedules: readonly S[], from: Date, to: Date): Array<Firing<S>> {
  const out: Array<Firing<S>> = [];
  for (const s of schedules) {
    if (s.cadence === 'once') {
      const at = s.next_run_at ? new Date(s.next_run_at) : null;
      if (at && !Number.isNaN(at.getTime()) && at >= from && at < to) out.push({ key: `${s.id}:once`, at, schedule: s });
      continue;
    }
    let cursor = new Date(from.getTime() - 1);
    for (let guard = 0; guard < 64; guard++) {
      const at = nextScheduleRun({ cadence: s.cadence as ScheduleCadence, atTime: s.at_time, tz: s.tz, weekday: s.weekday, after: cursor });
      if (!at || at >= to) break;
      out.push({ key: `${s.id}:${at.getTime()}`, at, schedule: s });
      cursor = at;
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export const SCHED_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** the card's cadence line: `Once · 09:00` · `Weekdays · 09:00` · `Mons · 17:00` */
export function cadenceLine(s: { cadence: string; at_time: string; weekday?: number | null }): string {
  if (s.cadence === 'once') return `Once · ${s.at_time}`;
  if (s.cadence === 'weekly') return `${SCHED_WEEKDAYS[s.weekday ?? 1]}s · ${s.at_time}`;
  return `${s.cadence[0]!.toUpperCase()}${s.cadence.slice(1)} · ${s.at_time}`;
}

/** `now` · `in 12m` · `in 3h` · `in 2d` — the next-fire countdown; '' when there is no next */
export function nextRunLabel(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '';
  const mins = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (mins <= 1) return 'now';
  if (mins < 60) return `in ${mins}m`;
  if (mins < 48 * 60) return `in ${Math.round(mins / 60)}h`;
  return `in ${Math.round(mins / (60 * 24))}d`;
}
