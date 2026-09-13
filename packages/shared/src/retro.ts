// Agent Retro math (docs/13 §3–4) — pure functions only, shared by the
// control-api aggregator and the desktop view so both sides agree on what a
// window, a level, and a renderable rate ARE. Nothing here is stored: levels
// re-derive from history on every call, which is the honesty guarantee.

// XP weights are product policy, not measurement — one place, documented in
// docs/13 §4; changing them re-levels everyone retroactively and consistently.
export const XP_WEIGHTS = {
  accepted: 10,
  reviews: 3,
  plansApproved: 5,
  lessons: 2,
  skillsProposed: 5,
} as const;

export interface XpCounts {
  accepted: number;
  reviews: number;
  plansApproved: number;
  lessons: number;
  skillsProposed: number;
}

export function xpOf(c: XpCounts): number {
  return (
    XP_WEIGHTS.accepted * c.accepted +
    XP_WEIGHTS.reviews * c.reviews +
    XP_WEIGHTS.plansApproved * c.plansApproved +
    XP_WEIGHTS.lessons * c.lessons +
    XP_WEIGHTS.skillsProposed * c.skillsProposed
  );
}

// level n requires 10·n² xp (lv1→10, lv2→40, lv3→90 …). Level 0 = no xp yet.
export function levelOf(xp: number): number {
  if (xp < 10) return 0;
  return Math.floor(Math.sqrt(xp / 10));
}

export function xpForLevel(level: number): number {
  return 10 * level * level;
}

// progress into the next level, 0..1 (for the "XP to lv.N+1" bar)
export function levelProgress(xp: number): number {
  const lvl = levelOf(xp);
  const cur = xpForLevel(lvl);
  const next = xpForLevel(lvl + 1);
  return Math.max(0, Math.min(1, (xp - cur) / (next - cur)));
}

// Rolling retro windows — semantics shared with Mission Control's Throughput
// picker (docs/12 §3.5): trailing/prior spans anchored to local midnight.
export type RetroRange = 'week' | 'lastweek' | 'month' | 'quarter';

export const RETRO_RANGES: Record<
  RetroRange,
  { label: string; days: number; offset: number; weeklyBuckets: boolean; prev: string }
> = {
  week: { label: 'This week', days: 7, offset: 0, weeklyBuckets: false, prev: 'the week before' },
  lastweek: { label: 'Last week', days: 7, offset: 7, weeklyBuckets: false, prev: 'the week before it' },
  month: { label: 'Last month', days: 30, offset: 0, weeklyBuckets: false, prev: 'the prior 30 days' },
  quarter: { label: 'Last 3 months', days: 90, offset: 0, weeklyBuckets: true, prev: 'the prior 90 days' },
};

const DAY = 86_400_000;

export interface RetroWindow {
  from: number; // inclusive, ms epoch
  to: number; // exclusive
  prevFrom: number;
  prevTo: number;
  bucketMs: number;
}

// dayStart = local midnight of "today" as ms epoch — passed in so the math is
// deterministic and testable (no Date.now() in here).
export function retroWindow(range: RetroRange, dayStart: number): RetroWindow {
  const r = RETRO_RANGES[range];
  const to = dayStart - r.offset * DAY + DAY;
  const from = to - r.days * DAY;
  return {
    from,
    to,
    prevFrom: from - r.days * DAY,
    prevTo: from,
    bucketMs: r.weeklyBuckets ? 7 * DAY : DAY,
  };
}

// A rate is only a rate when the denominator can carry it (docs/13 §3):
// below the floor, show raw counts instead of a percentage.
export const RATE_DENOMINATOR_FLOOR = 3;

export function rateOrNull(numerator: number, denominator: number): number | null {
  if (denominator < RATE_DENOMINATOR_FLOOR) return null;
  return numerator / denominator;
}

// delta in percentage points between two rates, null unless both windows
// clear the denominator floor — deltas between noise are noise.
export function rateDeltaPoints(
  cur: { n: number; d: number },
  prev: { n: number; d: number },
): number | null {
  const a = rateOrNull(cur.n, cur.d);
  const b = rateOrNull(prev.n, prev.d);
  if (a == null || b == null) return null;
  return Math.round((a - b) * 100);
}

// ── /v1/retro payload — one shape, shared by the control-api aggregator and
// the desktop view. Every number traces to events/tasks/facts/skills rows.
export type RetroHeadlineKind = 'firstTry' | 'caught' | 'planFirstPass' | 'routed';

export interface RetroHeadline {
  kind: RetroHeadlineKind;
  n: number; // numerator in the window
  d: number; // denominator in the window
  rate: number | null; // null under the denominator floor
  deltaPoints: number | null; // vs the prior window, null when either side is under-floor
}

export interface RetroAgentStats {
  id: string;
  name: string;
  role: string;
  level: number;
  leveledUp: boolean; // levelOf(xp at window end) > levelOf(xp at window start)
  xp: number;
  progress: number; // 0..1 toward the next level
  headline: RetroHeadline;
  counts: { accepted: number; reviews: number; plansApproved: number; lessons: number; skillsProposed: number };
  spark: number[]; // accepted + reviews per bucket (volume, not rate — docs/13 §3)
  learned: string | null; // newest lesson from a task this agent was assignee of
}

export interface RetroOrg {
  accepted: number;
  acceptedPrev: number;
  avgCycleMs: number | null; // claim → accepted over the window
  prevAvgCycleMs: number | null;
  lessons: number;
  leveledUp: number;
}

export interface RetroLesson {
  content: string;
  taskNumber: number | null;
  learner: string | null; // agent name (task assignee)
  at: string;
}

export interface RetroCurvePoint {
  weekStart: string;
  n: number;
  d: number;
  rate: number | null; // org first-try pass; null under the floor → the bar stays a gap
}

export interface RetroPayload {
  range: RetroRange;
  from: string;
  to: string;
  org: RetroOrg;
  agents: RetroAgentStats[];
  curve: RetroCurvePoint[]; // last 8 trailing weeks
  lessons: RetroLesson[];
}
