// The phase spectrum's data half (docs/24): a task's journey DERIVED at render —
// FSM state + routing evidence + channel staffing — never stored, never
// prompt-maintained. If the board and the bar could disagree, one would be
// lying, so neither keeps state. Pure and platform-free: desktop and mobile
// render the same legs.

export type JourneyKey = 'design' | 'plan' | 'build' | 'review' | 'ship' | 'accept';
export type JourneyStatus = 'done' | 'live' | 'todo' | 'gap';

export interface JourneyLeg {
  key: JourneyKey;
  label: string;
  status: JourneyStatus;
  /** resolved owner display name ('you' for accept; null = unstaffed gap) */
  owner: string | null;
  /** live-leg fill fraction 0..1 (the working agent's beats); undefined = indeterminate */
  fill?: number;
  /** the state token CSS var carrying this leg's hue */
  colorVar: string;
}

export interface JourneyTask {
  state: string;
  /** the work-type label (docs/16) — it names the EXECUTION leg honestly: a research task
   *  researches, a content task drafts; only code-shaped work "builds" (2026-08-19) */
  kind?: string | null;
  /** blocked rows resume their real stage */
  blockedFrom?: string | null;
  /** routing evidence: the task passed (or sits in) the design/plan gates */
  hasDesignRound: boolean;
  hasPlanDoc: boolean;
  /** ship leg present when the project gate is on AND the task is repo-backed */
  repoBacked: boolean;
  shipGate: boolean;
  assigneeName?: string | null;
  /**
   * Plan-first units (2026-08-17): the DECLARED legs from the unit's work plan. When present
   * the journey is declared-at-triage rather than evidence-derived: the plan leg always shows
   * (the universal gate every plan-first unit is born into), design shows iff declared (or the
   * state says a round is live), and review shows iff declared. Null/absent = legacy behavior.
   */
  workPlanLegs?: readonly string[] | null;
}

export interface JourneyRoster {
  designer?: string | null;
  architect?: string | null;
  developer?: string | null;
  reviewer?: string | null;
  shipper?: string | null;
}

const LEG_META: Record<JourneyKey, { label: string; colorVar: string }> = {
  design: { label: 'Design', colorVar: '--design' },
  plan: { label: 'Plan', colorVar: '--plan' },
  build: { label: 'Build', colorVar: '--prog' },
  review: { label: 'Review', colorVar: '--review' },
  ship: { label: 'Ship', colorVar: '--ship' },
  accept: { label: 'Accept', colorVar: '--acc' },
};

/**
 * The execution leg named by what the work IS (2026-08-19, founder report): a research task's
 * journey read "BUILD", which is a code word on a literature sweep. The FSM keeps one execution
 * stage — this maps its LABEL by task kind, in the one place both the journey bar and the plan
 * card's leg chips read.
 */
export function executionLegLabel(kind?: string | null): string {
  switch (kind) {
    case 'research':
    case 'spike':
      return 'Research';
    case 'content':
      return 'Draft';
    case 'docs':
      return 'Write';
    default:
      return 'Build';
  }
}

/** which leg a board state lives on (blocked resolves via blockedFrom first) */
function legOfState(state: string): JourneyKey | 'past-all' | null {
  switch (state) {
    case 'designing':
    case 'design_review':
      return 'design';
    case 'planning':
    case 'plan_review':
      return 'plan';
    case 'todo':
    case 'in_progress':
      return 'build';
    case 'in_review':
      return 'review';
    case 'shipping':
    case 'ship_review':
    case 'releasing':
    case 'verifying':
      return 'ship';
    case 'done':
      return null; // between review and ship/accept — nothing is live
    case 'accepted':
    case 'closed':
      return 'past-all';
    default:
      return null;
  }
}

/** the ordered legs this task was ACTUALLY routed through (docs/24: the bar
 * never invents phases — a fast-path bug simply has fewer segments) */
export function journeyFor(task: JourneyTask, roster: JourneyRoster, beats?: { done: number; total: number }): JourneyLeg[] {
  const state = task.state === 'blocked' ? (task.blockedFrom ?? 'in_progress') : task.state;
  const declared = task.workPlanLegs ?? null;
  const keys: JourneyKey[] = [];
  if (declared) {
    // Plan-first units (2026-08-17): the journey is DECLARED, and its causal order inverts the
    // legacy design-gate-then-architect ceremony — the plan leg comes FIRST (the unit is born
    // into that gate), then any declared design round, then build, then a declared review.
    keys.push('plan');
    if (declared.includes('design') || state === 'designing' || state === 'design_review') keys.push('design');
    keys.push('build');
    if (declared.includes('review') || state === 'in_review') keys.push('review');
  } else {
    if (task.hasDesignRound || state === 'designing' || state === 'design_review') keys.push('design');
    if (task.hasPlanDoc || state === 'planning' || state === 'plan_review') keys.push('plan');
    keys.push('build', 'review');
  }
  if (task.shipGate && (task.repoBacked || state === 'shipping' || state === 'ship_review' || state === 'releasing' || state === 'verifying')) keys.push('ship');
  keys.push('accept');

  const cur = legOfState(state);
  const curIdx = cur === 'past-all' ? keys.length
    : cur === null
      ? (state === 'done' ? keys.indexOf(keys.includes('review') ? 'review' : 'build') + 0.5 : -1)
      : keys.indexOf(cur);

  const ownerOf = (k: JourneyKey): string | null => {
    switch (k) {
      case 'design': return roster.designer ?? null;
      case 'plan': return roster.architect ?? null;
      case 'build': return task.assigneeName ?? roster.developer ?? null;
      case 'review': return roster.reviewer ?? null;
      case 'ship': return roster.shipper ?? null;
      case 'accept': return 'you';
    }
  };

  return keys.map((k, i) => {
    const meta = k === 'build' ? { ...LEG_META.build, label: executionLegLabel(task.kind) } : LEG_META[k];
    const owner = ownerOf(k);
    const status: JourneyStatus =
      i < curIdx ? 'done'
      : i === curIdx ? 'live'
      : owner === null ? 'gap'
      : 'todo';
    const fill = status === 'live' && beats && beats.total > 0 ? Math.max(0.06, Math.min(1, beats.done / beats.total)) : undefined;
    return { key: k, label: meta.label, status, owner, ...(fill !== undefined ? { fill } : {}), colorVar: meta.colorVar };
  });
}
