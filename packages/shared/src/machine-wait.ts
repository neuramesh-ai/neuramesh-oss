// HOW LONG A MACHINE START TAKES, SAID WHERE A PERSON WAITS (thread-wait-and-plan round, 2026-11-17).
//
// Every surface that shows a machine start (the thread's wait row, the terminal boot pane, the
// compute pill, the composer chip) reads this one estimate, so one start never gets two numbers.
//
// The estimate is the machine's last measured wake (machines.last_wake_ms: the wake stamp to the
// first ready report, control-api fleet-cloudrun.ts). A machine with no measured wake gets 60 s,
// because the production wake with saved state took 57 s. Past the estimate the count turns
// around: "Taking longer than usual" and the time spent. A slow start then never shows a number
// that is false, and no count is ever negative.

/** the estimate for a machine with no measured wake */
export const MACHINE_WAKE_ESTIMATE_MS = 60_000;
/** a measured wake longer than this is a fault, not a wake time. The server stores none above it */
export const MACHINE_WAKE_MAX_MS = 15 * 60_000;

/** "m:ss". Callers set tabular figures, so the width holds still each second */
export function waitClock(ms: number): string {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** the estimate to count down from: the last measured wake when it is usable, else 60 s */
export function wakeEstimateMs(lastWakeMs: number | null | undefined): number {
  return typeof lastWakeMs === 'number' && Number.isFinite(lastWakeMs) && lastWakeMs > 0 && lastWakeMs <= MACHINE_WAKE_MAX_MS
    ? lastWakeMs
    : MACHINE_WAKE_ESTIMATE_MS;
}

export interface WakeEta {
  /** past the estimate: the count shows the time spent, in --warn */
  late: boolean;
  /** the time left (on time) or the time spent (late), never negative */
  ms: number;
  /** that time as m:ss */
  clock: string;
  /** the words before the clock: "Ready in about" or "Taking longer than usual ·" */
  lead: string;
  /** the full line, for a tooltip or a label */
  text: string;
}

export const WAKE_ETA_LEAD = 'Ready in about';
export const WAKE_LATE_LEAD = 'Taking longer than usual ·';

/**
 * Where the wait started and how far it got. `since` is the wait's start in ms (waitStartMs), and a
 * start in the future (a server clock ahead of this one) counts as now.
 */
export function wakeEta(since: number, now: number, lastWakeMs?: number | null): WakeEta {
  const start = Number.isFinite(since) ? Math.min(since, now) : now;
  const spent = Math.max(0, now - start);
  const left = wakeEstimateMs(lastWakeMs) - spent;
  // the last second of the estimate reads 0:01, never 0:00: at 0:00 the count turns around
  if (left > 0) {
    const ms = Math.ceil(left / 1000) * 1000;
    const clock = waitClock(ms);
    return { late: false, ms, clock, lead: WAKE_ETA_LEAD, text: `${WAKE_ETA_LEAD} ${clock}` };
  }
  const clock = waitClock(spent);
  return { late: true, ms: spent, clock, lead: WAKE_LATE_LEAD, text: `${WAKE_LATE_LEAD} ${clock}` };
}

/**
 * WHEN THIS WAIT STARTED. A waking machine has its own start (machines.started_at), and that is
 * the truth. In any other state the 60 s poll can be stale (the snapshot still says asleep while
 * the send already woke it), so the wait counts from the waiting message instead. A restart (a
 * resize, a roll) also reads as waking but keeps the first wake's started_at, which can be hours
 * old: a start more than MACHINE_WAKE_MAX_MS before the message is not this wait's start. NaN when
 * neither is known, which wakeEta reads as now.
 */
export function waitStartMs(status: string | null | undefined, startedAt: string | null | undefined, messageAt: string | null | undefined): number {
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  const message = messageAt ? Date.parse(messageAt) : Number.NaN;
  if (status === 'waking' && !Number.isNaN(started) && (Number.isNaN(message) || message - started <= MACHINE_WAKE_MAX_MS)) return started;
  return message;
}

/** a wait longer than this shows no count at all: it is a fault, and the machine's state says so */
export const waitCountable = (since: number, now: number): boolean => Number.isFinite(since) && now - since <= MACHINE_WAKE_MAX_MS;
