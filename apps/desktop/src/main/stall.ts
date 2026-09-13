// Stall watchdog (docs/09 §3): deterministic detection of work that stopped moving,
// pure (the beats.ts/replypolicy idiom) so every class, threshold, and suppression is
// unit-testable without the host. DETECTION is code; what to do about a stall is the
// orchestrator's judgment — the host feeds these results into a stall sweep turn.
//
// The failure this closes (task #1011): a human left design feedback in a task thread
// at night; the designer chatted back but no verdict command followed, the app was
// closed, and the morning monitor sweep couldn't see it — its "needs monitor" gate
// counts activity since the LAST SWEEP (boot-relative, so pre-boot activity is
// invisible) and its transcript carries channel messages only, never thread state.
// The watchdog instead measures ABSOLUTE age against now on every tick, so the first
// sweep after boot recovers anything that stalled while the machine slept.

export type StallClass =
  | 'feedback_unactioned' // review gate with human feedback newer than the transition, no verdict
  | 'stalled_active'      // agent-active phase with no signs of life anywhere
  | 'unclaimed_offer'     // offered todo nobody claimed
  | 'unrouted'            // todo that never got routed and stopped moving
  | 'blocked_stale'       // blocked and sitting
  | 'awaiting_human'      // review gate simply waiting on the human
  | 'stale_done'          // approved work awaiting the human accept (or a shipper claim)
  | 'releasing_stale';    // approved release plan whose checklist stopped clearing

export interface StallCandidate {
  id: string;
  number: number;
  title: string;
  state: string;
  assignee: string | null;      // the working agent's name (tasks.assignee_id)
  offered: string | null;       // offered-but-unclaimed agent name (tasks.offered_agent_id)
  createdAtMs: number;
  updatedAtMs: number;          // last transition/update — the state's age
  lastMsgAtMs: number | null;   // newest thread message (any author)
  lastHumanMsgAtMs: number | null; // newest HUMAN thread message
  lastBeatAtMs: number | null;  // newest beat write (a live run ticks these)
  /** newest write on a RUN for this task (docs/29) — the activity feed's own pulse. Since
   * execution has no time cap, this is the signal that separates "working" from "wedged":
   * a live run steps at least every few seconds, a dead one stops writing entirely. */
  lastRunAtMs: number | null;
  /** a run for this task is still `running` on SOME machine (not just this host) */
  runOpen: boolean;
  hostSeenAtMs: number | null;  // the responsible agent's machine heartbeat
  hasOpenDecision: boolean;     // an open nmq decision already parks the ball with the human
  liveLocal: boolean;           // a flow for this task is running on THIS host right now
}

export interface Stall {
  taskId: string;
  number: number;
  title: string;
  state: string;
  cls: StallClass;
  idleMs: number;    // age of the signal that defines the class
  signalMs: number;  // the signal's timestamp — refire keys derive from it
  assignee: string | null;
  hostOffline: boolean;
  detail: string;    // one factual, human-legible report line
}

// Thresholds before something counts as stalled. Deliberately generous: the flows
// already self-heal fast paths (claim/resume watches, bounce-on-failure) — the
// watchdog is the backstop for what those can't see.
//
// `active` carries more weight since execution lost its 15-minute cap (2026-07-29):
// a long run is no longer bounded by a timer, so this threshold IS how a wedged run
// gets noticed. It stays safe because `lastRunAtMs` makes a live run continuously
// noisy — 25 minutes of TOTAL silence (no transition, message, beat, or run step)
// means the work really did stop, however long the task legitimately takes.
export const STALL_AFTER = {
  feedback: 10 * 60_000,       // human feedback sitting on a review gate
  active: 25 * 60_000,         // agent-active phase with zero activity anywhere
  offer: 20 * 60_000,          // an offer normally claims in seconds
  unrouted: 60 * 60_000,       // a todo the orchestrator never routed
  blocked: 2 * 3600_000,
  design_review: 4 * 3600_000, // no-feedback waiting reminders — the entry push already fired
  plan_review: 2 * 3600_000,
  ship_review: 2 * 3600_000,   // a proposed release plan awaiting the human sign-off (docs/23)
  releasing: 2 * 3600_000,     // an armed checklist whose boxes stopped clearing
  verifying: 45 * 60_000,      // merged but the post-merge verdict never settled (docs/23 v2);
                               // waitForRelease itself watches ~25m, so quiet past that is real
  done: 24 * 3600_000,
} as const;

// Refire buckets: a stall fires ONCE per signal (per feedback message, per offer, per
// idle episode); slow human-gated classes re-arm on a coarse clock so a genuinely
// ignored item resurfaces without becoming a nag loop. 0 = once per signal, period.
export const STALL_REFIRE: Record<StallClass, number> = {
  feedback_unactioned: 0,
  stalled_active: 2 * 3600_000,
  unclaimed_offer: 3600_000,
  unrouted: 4 * 3600_000,
  blocked_stale: 12 * 3600_000,
  awaiting_human: 12 * 3600_000,
  stale_done: 24 * 3600_000,
  releasing_stale: 4 * 3600_000,
};

export const HOST_OFFLINE_AFTER = 5 * 60_000; // machines heartbeat cadence, with slack
export const MAX_STALLS_PER_SWEEP = 5;

const PRIORITY: StallClass[] = ['feedback_unactioned', 'stalled_active', 'unclaimed_offer', 'unrouted', 'releasing_stale', 'blocked_stale', 'awaiting_human', 'stale_done'];

export function fmtAge(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = ms / 3600_000;
  if (h < 48) return `${Math.round(h * 10) % 10 === 0 ? Math.round(h) : (Math.round(h * 10) / 10)}h`;
  return `${Math.round((h / 24) * 10) / 10}d`;
}

function classify(c: StallCandidate, nowMs: number): Stall | null {
  if (c.liveLocal) return null;        // this host is working it right now
  if (c.hasOpenDecision) return null;  // an open card already holds the ball, notified
  // last sign of life anywhere: a transition, a thread message, a beat tick, a run step
  const lastActivity = Math.max(c.updatedAtMs, c.lastMsgAtMs ?? 0, c.lastBeatAtMs ?? 0, c.lastRunAtMs ?? 0);
  const hostOffline = c.hostSeenAtMs !== null && nowMs - c.hostSeenAtMs > HOST_OFFLINE_AFTER;
  const mk = (cls: StallClass, signalMs: number, detail: string): Stall => ({
    taskId: c.id, number: c.number, title: c.title, state: c.state, cls,
    idleMs: nowMs - signalMs, signalMs, assignee: c.assignee, hostOffline, detail,
  });
  const who = c.assignee ?? c.offered;
  const hostNote = hostOffline ? ` — @${who ?? 'the assignee'}'s host looks offline (last seen ${fmtAge(nowMs - (c.hostSeenAtMs ?? nowMs))} ago)` : '';

  switch (c.state) {
    case 'design_review':
    case 'plan_review':
    case 'ship_review': {
      const fb = c.lastHumanMsgAtMs !== null && c.lastHumanMsgAtMs > c.updatedAtMs;
      const noun = c.state === 'design_review' ? 'mockups' : c.state === 'ship_review' ? 'release plan' : 'plan';
      if (fb && nowMs - c.lastHumanMsgAtMs! > STALL_AFTER.feedback) {
        return mk('feedback_unactioned', c.lastHumanMsgAtMs!,
          `human feedback has sat in the thread ${fmtAge(nowMs - c.lastHumanMsgAtMs!)} with no verdict — the ${noun} ${c.state === 'design_review' ? 'were' : 'was'} neither approved nor sent back`);
      }
      const wait = STALL_AFTER[c.state === 'design_review' ? 'design_review' : c.state === 'ship_review' ? 'ship_review' : 'plan_review'];
      if (nowMs - c.updatedAtMs > wait) {
        return mk('awaiting_human', c.updatedAtMs,
          `waiting on the human ${c.state === 'design_review' ? 'design' : c.state === 'ship_review' ? 'release-plan' : 'plan'} sign-off for ${fmtAge(nowMs - c.updatedAtMs)}`);
      }
      return null;
    }
    case 'releasing': {
      if (nowMs - lastActivity > STALL_AFTER.releasing) {
        return mk('releasing_stale', lastActivity,
          `the approved release plan's checklist hasn't moved for ${fmtAge(nowMs - lastActivity)} — an unchecked box is holding the merge`);
      }
      return null;
    }
    case 'verifying': {
      // merged, but the release never settled green — a red verdict already alerted
      // the thread (that message counts as activity); this catches the SILENT hangs:
      // a pipeline stuck in-flight, or the merging host dying mid-verification.
      if (nowMs - lastActivity > STALL_AFTER.verifying) {
        return mk('releasing_stale', lastActivity,
          `merged, but post-merge release verification hasn't settled for ${fmtAge(nowMs - lastActivity)} — check the release pipelines (accept overrides; request changes bounces a fix-forward)`);
      }
      return null;
    }
    case 'todo': {
      if (c.offered && nowMs - c.updatedAtMs > STALL_AFTER.offer) {
        return mk('unclaimed_offer', c.updatedAtMs,
          `offered to @${c.offered} ${fmtAge(nowMs - c.updatedAtMs)} ago and never claimed${hostNote}`);
      }
      if (!c.offered && nowMs - lastActivity > STALL_AFTER.unrouted) {
        return mk('unrouted', lastActivity,
          `open todo with no route or offer, quiet for ${fmtAge(nowMs - lastActivity)}`);
      }
      return null;
    }
    case 'designing':
    case 'planning':
    case 'in_progress':
    case 'shipping':
    case 'in_review': {
      if (nowMs - lastActivity > STALL_AFTER.active) {
        // Name the run explicitly when one is still open: "the row says running but nothing
        // has moved" is a different (and more actionable) report than "nobody started".
        const feed = c.runOpen
          ? `its run still reads as running but has written nothing for ${fmtAge(nowMs - lastActivity)} — no steps, messages, beats, or transitions`
          : `no run activity, messages, beats, or transitions for ${fmtAge(nowMs - lastActivity)}`;
        return mk('stalled_active', lastActivity, `${c.state} but ${feed}${hostNote}`);
      }
      return null;
    }
    case 'blocked': {
      if (nowMs - lastActivity > STALL_AFTER.blocked) {
        return mk('blocked_stale', lastActivity, `blocked and untouched for ${fmtAge(nowMs - lastActivity)}`);
      }
      return null;
    }
    case 'done': {
      if (nowMs - lastActivity > STALL_AFTER.done) {
        return mk('stale_done', lastActivity, `approved and awaiting the human accept for ${fmtAge(nowMs - lastActivity)}`);
      }
      return null;
    }
    default:
      return null; // backlog/accepted/closed (and anything future) never stall
  }
}

// Classify a channel's candidates, most urgent first, capped per sweep so a long-dead
// board becomes a triaged shortlist, not a flood.
export function classifyStalls(candidates: StallCandidate[], nowMs: number): Stall[] {
  return candidates
    .map((c) => classify(c, nowMs))
    .filter((s): s is Stall => s !== null)
    .sort((a, b) => PRIORITY.indexOf(a.cls) - PRIORITY.indexOf(b.cls) || b.idleMs - a.idleMs)
    .slice(0, MAX_STALLS_PER_SWEEP);
}

// The refire key the host remembers (in-memory): one firing per (task, class, signal),
// with slow classes re-arming each refire bucket. A daemon restart forgets the set —
// deliberate: the first sweep after boot re-triages whatever is still stalled.
export function stallKey(s: Stall, nowMs: number): string {
  const bucket = STALL_REFIRE[s.cls] > 0 ? Math.floor(nowMs / STALL_REFIRE[s.cls]) : 0;
  return `${s.taskId}:${s.cls}:${s.signalMs}:${bucket}`;
}

// ── ROUTINES (failure-alerts round, docs/design/failure-alerts-2026-08) ──────────────────
//
// Routines are not tasks — they wear no StallCandidate — but the watchdog's split applies
// unchanged: schedules.last_error is the code-detected signal (written by the fire path),
// and rex's triage is the judgment on top. The attention bar already shows the failure the
// moment it lands; rex speaks only once it has SETTLED — inside the window the human is
// probably mid-fix and a nag would race them.
export interface RoutineCandidate {
  id: string;
  title: string;
  status: string; // only 'active' stalls — pausing IS the human's mute
  lastError: string | null;
  /** advanced by the claim CAS — null for a routine that has never claimed a run (a pre-claim
   *  stall: no agent, no creds), which the fire path only marks once the slot is overdue */
  lastRunAtMs: number | null;
}

export interface RoutineStall {
  scheduleId: string;
  title: string;
  /** the row's own last_error, verbatim — the same words the attention bar shows */
  detail: string;
  signalMs: number;
}

export const ROUTINE_SETTLE_MS = 30 * 60_000;

export function classifyRoutineStalls(rows: RoutineCandidate[], nowMs: number): RoutineStall[] {
  return rows
    .filter((r) => r.status === 'active' && !!r.lastError
      // a never-claimed routine has no run timestamp to settle against; its error was already
      // overdue-gated at the writer, so the error's presence IS the settled signal
      && (r.lastRunAtMs === null || nowMs - r.lastRunAtMs >= ROUTINE_SETTLE_MS))
    .map((r) => ({ scheduleId: r.id, title: r.title, detail: r.lastError!, signalMs: r.lastRunAtMs ?? 0 }))
    .slice(0, MAX_STALLS_PER_SWEEP);
}

// One firing per failed run: the claim moves last_run_at, so the next failure is a new signal.
// A pre-claim stall (signalMs 0) fires once per daemon session — the bar carries it after that.
export function routineStallKey(s: RoutineStall): string {
  return `routine:${s.scheduleId}:${s.signalMs}`;
}
