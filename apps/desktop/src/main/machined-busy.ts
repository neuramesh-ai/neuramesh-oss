// WHAT COUNTS AS WORK on a machine (docs/design/cloud-run-2026-10/architecture.md §5, the activity
// meter in machined.ts). The beat reports `busy` and the sampled active seconds from this rule, and the
// Cloud Run idle sweep parks a machine whose last activity is old (fleet-cloudrun-sweep.ts).
//
// A terminal or a Code tab counts only while a person uses it: input within NM_TERMINAL_IDLE_MS
// (default 10 min). Before this rule an open terminal was work for as long as it stayed open, so a tab
// left open kept a machine awake and metered until the relay socket's hourly cut. A Code turn that
// runs counts by itself, however long ago its prompt was typed. A turn held on an approval does not:
// that approval is a durable park on Cloud Run, and the park's own rule (lifecycle.ts parksBusy) keeps
// the machine up only when it is about to expire.
export const DEFAULT_TERMINAL_IDLE_MS = 10 * 60_000;
const MIN_TERMINAL_IDLE_MS = 10_000;
const MAX_TERMINAL_IDLE_MS = 24 * 3_600_000;

/** NM_TERMINAL_IDLE_MS, bounded to 10 s .. 24 h; anything else is the default */
export function terminalIdleMsOf(env: Record<string, string | undefined>): number {
  const raw = env['NM_TERMINAL_IDLE_MS'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_TERMINAL_IDLE_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= MIN_TERMINAL_IDLE_MS && n <= MAX_TERMINAL_IDLE_MS ? Math.round(n) : DEFAULT_TERMINAL_IDLE_MS;
}

export interface BusySources {
  /** room-agent turns in flight (agents.ts `executing`) */
  agentTurns: number;
  /** Code turns that run and wait on nobody (EngineeringMachineHost.workingCount) */
  codeTurns: number;
  /** the relay edge's last input into a still-open terminal or Code session, epoch ms (0 = none) */
  lastInputAt: number;
  /** a person typing into the machine's browser, or an agent's browser call in flight */
  browserBusy: boolean;
  /** Cloud Run: an open park about to expire */
  parksBusy: boolean;
}

export function machineBusy(s: BusySources, now: number, idleMs: number): boolean {
  if (s.agentTurns > 0 || s.codeTurns > 0 || s.browserBusy || s.parksBusy) return true;
  return s.lastInputAt > 0 && now - s.lastInputAt < idleMs;
}
