// Monitor sweep gate (docs/19 §6): decides whether a channel's PERIODIC SELF-CHECK (the
// "monitor" orchestrator turn) may run this tick — pure, so the race rules are
// unit-testable without the host.
//
// The failure this closes (#1015/#1016, 2026-07-14): a human request woke the orchestrator
// (message triage) and the 15-min sweep tick landed ~40s later. The monitor turn's board
// snapshot predated the wake's create_task by seconds, so it re-triaged the same request
// as "fallen through" and created a duplicate task — routed to the architect, skipping the
// design gate the wake turn had correctly chosen. Two rules kill the race:
//
//   1. wake_in_flight — a channel-wake turn is LIVE in this channel right now: its routing
//      hasn't settled, so any monitor snapshot of the board is stale by construction.
//   2. fresh_human_message — the newest human message in the window is younger than the
//      wake-dispatch grace: its wake may not have STARTED yet (sync fan-out + the message
//      watch both sit between "row lands" and "wake starts"), so an empty in-flight count
//      proves nothing about it.
//
// Both rules DEFER without consuming the window: the caller keeps the channel's monitor
// watermark, so the same window re-arms the next tick — by then the wake has settled and
// the board carries its result, and the monitor verifies instead of re-triaging (or the
// wake crashed, and the monitor is still there to catch what fell through). Advancing the
// watermark on a defer would drop a crashed wake's request forever — never do that.

export type MonitorSignals = {
  /** human channel messages newer than the channel's monitor watermark */
  humanMsgsSince: number;
  /** open-task updates newer than the watermark (agent work rides task state) */
  tasksUpdatedSince: number;
  /** age of the newest in-window human message; null when the window has none */
  newestHumanMsgAgeMs: number | null;
  /** live channel-wake turns in this channel right now */
  wakesInFlight: number;
};

export type MonitorGate =
  | { run: false; defer: false; reason: 'idle' }
  | { run: false; defer: true; reason: 'wake_in_flight' | 'fresh_human_message' }
  | { run: true; defer: false; reason: 'human_activity' | 'task_activity' };

// A message younger than this may not have dispatched its wake yet. Deliberately fat:
// the only cost of a defer is a 15-min delay on the self-check of an ALREADY-live channel,
// while a thin grace re-opens the double-triage race.
export const MONITOR_FRESH_GRACE_MS = 90_000;

export function gateMonitor(s: MonitorSignals, graceMs: number = MONITOR_FRESH_GRACE_MS): MonitorGate {
  if (s.humanMsgsSince <= 0 && s.tasksUpdatedSince <= 0) return { run: false, defer: false, reason: 'idle' };
  if (s.wakesInFlight > 0) return { run: false, defer: true, reason: 'wake_in_flight' };
  if (s.newestHumanMsgAgeMs !== null && s.newestHumanMsgAgeMs < graceMs) return { run: false, defer: true, reason: 'fresh_human_message' };
  return { run: true, defer: false, reason: s.humanMsgsSince > 0 ? 'human_activity' : 'task_activity' };
}
