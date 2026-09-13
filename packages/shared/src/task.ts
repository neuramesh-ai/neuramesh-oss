import { z } from 'zod';
import { TASK_STATES, TASK_KINDS } from './states';

export const ActorRefSchema = z.object({
  kind: z.enum(['human', 'agent']),
  id: z.string().min(1),
});

export type ActorRef = z.infer<typeof ActorRefSchema>;

export const TaskRepoSchema = z.object({
  id: z.string().min(1),
  baseRef: z.string().min(1).default('main'),
  branch: z.string().min(1),
});

// Ship gate (docs/23). The release plan the channel shipper proposes for a
// reviewer-approved, repo-backed task: a risk-scaled report (the markdown rides
// as a versioned 'ship' artifact) plus this structured, owner-tagged checklist.
// Stored as tasks.ship_plan jsonb and mutated ONLY via commands, so the server
// serializes every tick — who checked what, when, lands in the event log.
export const SHIP_RISKS = ['low', 'medium', 'high'] as const;
export type ShipRisk = (typeof SHIP_RISKS)[number];
// item owners: 'shipper' = the shipper does + ticks it; 'human' = a human step
// (env var, dashboard deploy) only a human may tick; 'agent' = delegated to a
// named teammate, ticked by them or the coordinating shipper. Humans may tick
// anything (the boss override); an agent can NEVER tick a human item.
export const SHIP_ITEM_OWNERS = ['shipper', 'human', 'agent'] as const;
export type ShipItemOwner = (typeof SHIP_ITEM_OWNERS)[number];
export const SHIP_ITEM_STATES = ['pending', 'done', 'na'] as const;
export type ShipItemState = (typeof SHIP_ITEM_STATES)[number];

export const ShipItemSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(300),
  detail: z.string().max(2000).default(''),
  owner: z.enum(SHIP_ITEM_OWNERS),
  // the delegated teammate when owner='agent' (agent id)
  agentId: z.string().nullable().default(null),
  // daemon-verifiable marker, never model judgment: 'ci' is re-verified and ticked by
  // the host (gh pr checks); 'merge' and 'verify' are the ROLLOUT SPINE the host appends
  // to every plan (the road to live stays visible on the checklist) and ticks itself —
  // 'merge' when the verifying watch squash-merges, 'verify' when shipverify settles.
  auto: z.enum(['ci', 'merge', 'verify']).nullable().default(null),
  state: z.enum(SHIP_ITEM_STATES).default('pending'),
  checkedBy: ActorRefSchema.nullable().default(null),
  checkedAt: z.string().datetime().nullable().default(null),
  note: z.string().max(500).default(''),
});

export type ShipItem = z.infer<typeof ShipItemSchema>;

export const ShipPlanSchema = z.object({
  round: z.number().int().positive(),
  risk: z.enum(SHIP_RISKS),
  summary: z.string().max(2000).default(''),
  status: z.enum(['draft', 'approved']),
  shipperId: z.string().min(1),
  approvedBy: z.string().nullable().default(null),
  approvedAt: z.string().datetime().nullable().default(null),
  // how many redraft rounds the human has asked for on THIS plan. The host's
  // shipper watch keys its "already prepped this" guard on the value, so a SECOND
  // round of notes (the task is already `shipping`, so the row's state does not
  // change) still re-enters the draft flow instead of being swallowed. A counter,
  // not a timestamp: two requests in the same millisecond must still differ.
  revisions: z.number().int().nonnegative().default(0),
  items: z.array(ShipItemSchema).min(1).max(20),
});

export type ShipPlan = z.infer<typeof ShipPlanSchema>;

/**
 * Unchecked (neither done nor n/a) items — execute_ship is refused while > 0.
 * The rollout-spine legs (auto 'merge'/'verify') never count: they are OUTCOMES of
 * execute_ship, ticked by the host watches after it fires — counting them would
 * deadlock the gate they narrate.
 */
export function shipItemsPending(plan: ShipPlan | null): number {
  return plan ? plan.items.filter((i) => i.state === 'pending' && i.auto !== 'merge' && i.auto !== 'verify').length : 0;
}

/** ship-plan report artifact name, versioned by proposal round like plans/mockups. */
export function shipPlanName(round: number): string {
  return `ship-plan-v${round}.md`;
}

// ── The work plan (plan-first units, 2026-08-17) ─────────────────────────────
// The implementation plan rex proposes at creation: the DECLARED journey (legs), the proposed
// subtasks, and the approach markdown — the human reviews it in the unit's thread before any
// work starts. Structure the server enforces; prose the human reads. Legs are a subset of the
// canonical causal order (design → build → review); ship derives from the project gate + repo
// backing, accept is implicit and always the human's. `review` cannot be declared away for
// repo-backed work — validateWorkPlan is the floor, checked at create AND at re-propose.
export const WORK_PLAN_LEGS = ['design', 'build', 'review'] as const;
export type WorkPlanLeg = (typeof WORK_PLAN_LEGS)[number];
export const WorkPlanSchema = z.object({
  legs: z.array(z.enum(WORK_PLAN_LEGS)).min(1).max(3),
  subtasks: z.array(z.string().min(1).max(200)).max(8).default([]),
  /** the plan prose the human reviews (markdown) — the card renders it; revisions bump version */
  approach: z.string().max(60_000).default(''),
  version: z.number().int().min(1).default(1),
  proposedAt: z.string(),
});
export type WorkPlan = z.infer<typeof WorkPlanSchema>;

/** parse a replica row's work_plan JSON text into its declared legs (null = legacy/unparseable) */
export function parseWorkPlanLegs(text: string | null | undefined): string[] | null {
  if (!text) return null;
  try { return (JSON.parse(text) as { legs?: string[] }).legs ?? null; } catch { return null; }
}

/** the one validator for a declared journey — returns the refusal reason, or null when legal */
export function validateWorkPlanLegs(legs: readonly string[], repoBacked: boolean): string | null {
  if (!legs.includes('build')) return 'a work plan always includes a build leg — something must do the work';
  if (new Set(legs).size !== legs.length) return 'a work plan declares each leg at most once';
  const order = legs.map((l) => WORK_PLAN_LEGS.indexOf(l as WorkPlanLeg));
  if (order.some((i) => i < 0)) return `unknown journey leg — the vocabulary is ${WORK_PLAN_LEGS.join(' · ')} (ship derives from the project gate; accept is always the human's)`;
  if (order.some((v, i) => i > 0 && v <= order[i - 1]!)) return `journey legs follow the causal order ${WORK_PLAN_LEGS.join(' → ')}`;
  if (repoBacked && !legs.includes('review')) return 'repo-backed work cannot declare review away — code never merges unreviewed';
  return null;
}

export const TaskSchema = z.object({
  id: z.string().min(1),
  workspace: z.string().min(1),
  channel: z.string().min(1),
  project: z.string().nullable().default(null),
  number: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().default(''),
  state: z.enum(TASK_STATES),
  // work-type label the orchestrator sets at triage (docs/16) — a routing prior,
  // never a gate. null until categorized (legacy rows, parked backlog, bare todo).
  kind: z.enum(TASK_KINDS).nullable().default(null),
  creator: ActorRefSchema,
  assignee: ActorRefSchema.nullable().default(null),
  offeredAgentId: z.string().nullable().default(null),
  repo: TaskRepoSchema.nullable().default(null),
  submittedSha: z.string().nullable().default(null),
  // the pull request the submitted branch opened (repo-backed work) — the
  // reviewer gates on its CI, the merge-on-accept watch squash-merges it.
  prUrl: z.string().default(''),
  prNumber: z.number().int().positive().nullable().default(null),
  artifactCount: z.number().int().nonnegative().default(0),
  // the stage this task was blocked FROM (null unless blocked) — unblock
  // returns here instead of blindly to in_progress (a task blocked during
  // planning/designing/review must resume its own stage).
  blockedFrom: z.enum(TASK_STATES).nullable().default(null),
  requirements: z.array(z.string()).nullable().default(null),
  requirementsConfirmed: z.boolean().default(false),
  /**
   * When a human approved the implementation plan (docs/29 §4d). Null until they do, and NOTHING is
   * built from an unapproved plan — `plan_review -> in_progress` is refused while it is null. A
   * timestamp rather than a boolean so the record says WHEN, the way approvedAt does on a ship plan.
   */
  planApprovedAt: z.string().nullable().default(null),
  /**
   * Plan-first units (2026-08-17): the implementation plan proposed AT CREATION — declared
   * journey legs + proposed subtasks + the approach text — reviewed by the HUMAN in the unit's
   * thread before any work starts (approve_plan). Null = a legacy/plain task with no declared
   * journey. The legs are floored by validateWorkPlan (build always; review whenever the unit
   * is repo-backed); ship derives from the project gate and accept is implicit + human-only.
   */
  workPlan: WorkPlanSchema.nullable().default(null),
  /**
   * Thread-owned work (2026-08-17): the conversation that OWNS this unit. Many units may share
   * one origin (this inverts the legacy 1:1 threads.task_id upgrade); the create posts a
   * ‹task:id› unit card into it. Null on legacy rows and board-born tasks.
   */
  originThreadId: z.string().nullable().default(null),
  // the authoritative, human-editable acceptance contract the reviewer gates on
  // (architect writes it into the plan; orchestrator sets it at offer otherwise).
  // Distinct from `requirements` (the intake checklist); '' = fall back to it.
  definitionOfDone: z.string().default(''),
  // the ship gate's release plan (docs/23) — null until the shipper proposes one.
  shipPlan: ShipPlanSchema.nullable().default(null),
  // subtasks (docs/24): set = this row is companion work under that parent —
  // rendered under the parent everywhere, restricted to the lean claim/finish/
  // cancel lifecycle, and capped/validated at creation.
  parentTaskId: z.string().nullable().default(null),
  version: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Task = z.infer<typeof TaskSchema>;

export function taskBranch(number: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug ? `nm/${number}-${slug}` : `nm/${number}`;
}

// ── The unblock marker (execpolicy) ──────────────────────────────────────────────────────
// A task's retry budget counts wall messages SINCE THE LAST UNBLOCK. Without an anchor the
// budget was a latch: once a task reached the block threshold, every later attempt blocked on
// its first try and pressing Unblock returned it to blocked immediately. The renderer writes
// this line when a human unblocks; the daemon counts from it. It lives here because those are
// two different processes and a drifting copy would silently disable the reset.
export const UNBLOCK_MARKER = '↻ Unblocked';
export function unblockNote(taskNumber: number): string {
  return `${UNBLOCK_MARKER} #${taskNumber} — the retry budget starts over.`;
}
