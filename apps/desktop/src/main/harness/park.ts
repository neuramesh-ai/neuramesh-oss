// Park (docs/harness/05 §3.8) — ending a turn without ending the work.
//
// The capability the shipped worker prompt admits is missing, in its own words: "YOUR TURN IS THE
// EXECUTION. Nothing you start survives it: there are no background agents that keep working after you
// stop, no scheduled check-in that calls you back, no later turn to finish in."
//
// With park that stops being true, and that paragraph comes out of the prompt. A worker waiting on CI
// parks for six minutes at ZERO token cost instead of burning a 15-minute wall; the run stays open
// (state `parked`, migration 0102) so the human sees live work rather than a stall.
//
// Run: pnpm exec tsx --test src/main/harness/park.test.ts
import type { TurnKind } from '@neuramesh/shared';

/** What a parked turn is waiting for. A duration OR a signal — never neither. */
export type WakeCondition =
  | { on: 'duration'; afterMs: number }
  | { on: 'ci'; prNumber: number }
  | { on: 'subagents'; parentTurnId: string }
  | { on: 'answer'; questionId: string };

export interface ParkRequest {
  turnId: string;
  kind: TurnKind;
  agentId: string;
  subject: { taskId?: string | null; threadId?: string | null; channelId?: string };
  condition: WakeCondition;
  /** what the resumed turn is told it was waiting for — its context on re-admission */
  prompt: string;
}

export interface ParkRecord extends ParkRequest {
  parkedAt: number;
  /** hard ceiling: a park is not a way to wait forever (see MAX_PARK_MS) */
  expiresAt: number;
}

/**
 * The longest a turn may stay parked.
 *
 * A park with no bound is indistinguishable from an abandoned turn, and the failure mode we must avoid
 * is a parked run holding a task open silently for days. At expiry the turn is re-admitted anyway with
 * `timeout` as its reason, so the agent reports what it could not finish rather than nothing.
 */
export const MAX_PARK_MS = 60 * 60_000;

/**
 * A subagent may not park in this phase: a parked child holding its parent open is a new failure shape.
 *
 * `own` may. Waiting on CI for a PR its subagents pushed is the canonical park, and it is the OWNER
 * that has to still be there when the checks land — under orchestrator ownership there is no worker
 * left holding the task to wait on its behalf. Mirrors `TOOL_KINDS.park` in shared; the two lists
 * are asserted equal by a test rather than kept in step by memory.
 */
export const PARKABLE_KINDS: readonly TurnKind[] = ['own', 'work', 'review', 'ship', 'deep'];

export function canPark(kind: TurnKind): boolean {
  return PARKABLE_KINDS.includes(kind);
}

export interface ParkRejection { ok: false; reason: string }
export interface ParkAccepted { ok: true; record: ParkRecord }

/**
 * Validate a park request. Pure, so every refusal is testable without a daemon.
 *
 * The refusals matter more than the acceptance: a park that should have been a failure is how a task
 * silently stops moving, which the stall watchdog then has to discover by age instead of by fact.
 */
export function planPark(req: ParkRequest, now: number): ParkAccepted | ParkRejection {
  if (!canPark(req.kind)) return { ok: false, reason: `a ${req.kind} turn cannot park — finish or fail, and let the caller decide` };
  if (req.condition.on === 'duration') {
    if (req.condition.afterMs <= 0) return { ok: false, reason: 'a duration park needs a positive wait' };
    if (req.condition.afterMs > MAX_PARK_MS) return { ok: false, reason: `a park may not exceed ${MAX_PARK_MS / 60_000} minutes` };
  }
  const ttl = req.condition.on === 'duration' ? req.condition.afterMs : MAX_PARK_MS;
  return { ok: true, record: { ...req, parkedAt: now, expiresAt: now + ttl } };
}

// ── Wake evaluation ───────────────────────────────────────────────────────────────────────────
export interface WorldState {
  /** PR → CI verdict, as the host has settled it */
  ci?: Record<number, 'pass' | 'fail' | 'pending' | 'none'>;
  /** parent turn → whether its subtree has closed */
  subtreeClosed?: Record<string, boolean>;
  /** question id → whether a human answered */
  answered?: Record<string, boolean>;
}

export type WakeReason = 'duration' | 'ci' | 'subagents' | 'answer' | 'timeout';

/**
 * Should this parked turn wake?
 *
 * Pure over (record, world, now) so the whole scheduler is testable with no timers.
 *
 * A **duration** park is evaluated FIRST and never as a timeout: its expiry and its condition are the
 * same instant, so reaching it is the park SUCCEEDING. Ordering the generic expiry check ahead of it
 * made every duration park report `timeout`, which `resumeNote` would then hand the agent as "it did
 * not resolve" — a turn told to report a failure that never happened. (Caught by its own test.)
 *
 * For every SIGNAL park, expiry does win: a bounded wrong answer beats an unbounded silence.
 */
export function shouldWake(rec: ParkRecord, world: WorldState, now: number): WakeReason | null {
  if (rec.condition.on === 'duration') {
    return now >= rec.parkedAt + rec.condition.afterMs ? 'duration' : null;
  }
  if (now >= rec.expiresAt) return 'timeout';
  switch (rec.condition.on) {
    case 'ci': {
      const v = world.ci?.[rec.condition.prNumber];
      // pending keeps waiting; `none` (no CI configured) is an ANSWER, not an absence — the reviewer
      // path already treats no-CI as "proceed", so a park on it must not hang to expiry.
      return v && v !== 'pending' ? 'ci' : null;
    }
    case 'subagents':
      return world.subtreeClosed?.[rec.condition.parentTurnId] ? 'subagents' : null;
    case 'answer':
      return world.answered?.[rec.condition.questionId] ? 'answer' : null;
  }
}

/** The line the run's `step` shows while parked — the human must know what it waits on. */
export function parkStepLine(rec: ParkRecord): string {
  switch (rec.condition.on) {
    case 'duration': return `waiting ${Math.round(rec.condition.afterMs / 60_000)}m`;
    case 'ci': return `waiting on CI · PR #${rec.condition.prNumber}`;
    case 'subagents': return 'waiting on its subagents';
    case 'answer': return 'waiting on your answer';
  }
}

/** …and the reason the resumed turn is given, so it knows why it is running again. */
export function resumeNote(rec: ParkRecord, why: WakeReason): string {
  if (why === 'timeout') return `You parked waiting for ${parkStepLine(rec)} and it did not resolve within the park limit. Report what you have and say plainly what is unresolved.`;
  return `You parked waiting for ${parkStepLine(rec)}. That has now resolved (${why}). Continue: ${rec.prompt}`;
}

// ── The park book ─────────────────────────────────────────────────────────────────────────────
/**
 * The set of parked turns, and which are due.
 *
 * Machine-local by design (docs/harness §12 ruling): `runs.state='parked'` is synced and descriptive
 * so every client paints it, while the wake CONDITION stays on the machine that owns the turn. A
 * cross-machine resume is a later question and deliberately not a blocker here.
 */
export class ParkBook {
  private rows = new Map<string, ParkRecord>();

  park(rec: ParkRecord): void { this.rows.set(rec.turnId, rec); }
  release(turnId: string): void { this.rows.delete(turnId); }
  get(turnId: string): ParkRecord | undefined { return this.rows.get(turnId); }
  all(): ParkRecord[] { return [...this.rows.values()]; }

  /** Every parked turn that should now wake, with its reason. Called from the existing sweep tick. */
  due(world: WorldState, now: number): Array<{ record: ParkRecord; why: WakeReason }> {
    const out: Array<{ record: ParkRecord; why: WakeReason }> = [];
    for (const rec of this.rows.values()) {
      const why = shouldWake(rec, world, now);
      if (why) out.push({ record: rec, why });
    }
    // oldest park first, so a queue of wakes drains fairly rather than by map order
    return out.sort((a, b) => a.record.parkedAt - b.record.parkedAt);
  }
}
