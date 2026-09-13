// THE HOST'S GUARD REGISTRY — extracted from agents.ts (track B2).
//
// Every dedupe set, in-flight marker and retry counter the agent host keeps, in one place.
// They were declared across four thousand lines, each beside its first use, which made
// "what does this host remember, and for how long" a question you answered by grepping.
//
// The durability split is the load-bearing part and is stated per field below:
//   · a plain Set/Map is EPHEMERAL — it dies with the process, and that is what lets the
//     resume watch pick up work whose host crashed mid-execution.
//   · a DurableSet survives restarts, and is only correct where re-doing the action would
//     be visible to a human (announcing a merge twice, reclaiming a berth twice).
// `claimed` must never become durable: making it so strands every in-flight task forever
// (docs/harness/05 §2.1). adoption.test.ts guards that, and reads this file.
import { DurableSet, type durableStore } from '../harness/hostqueue';
import type { Recommendation, CustomModelPack } from '@neuramesh/shared';
import type { ParkRecord } from '../harness/park';
import type { ExecTask, HostedAgent } from '../agents';

/** the durable store DurableSets write through (durableStore's return) */
type DurableStore = ReturnType<typeof durableStore>;

export interface HostGuards {
  processed: Set<string>;
  firstSeen: Map<string, number>;
  // wake replies that exhausted their post retries (server unreachable for ~45s+).
  // The trigger is un-marked from `processed` so the watches / dead-letter sweep
  // re-answer it when the server comes back; bounded per message so a pathological
  // server can't burn a generation turn per sweep forever.
  wakeGaveUp: Map<string, number>;
  claimedIds: Set<string>;
  reviewed: Set<string>;
  hireProposed: Set<string>;  // task ids we've posted a hire card for (once per session)
  markedOnline: Set<string>;
  claimFailNoticed: Set<string>;  // dedupe the "couldn't pick up" note so a retrying offer-watch doesn't spam the thread
  bootstrapAuthCardPosted: Set<string>;  // one AuthCard per waiting bootstrap per session — the minute-tick must not spam the thread
  // taskId → the exec run a leg should hang off. Populated when executeFlow opens its work run and
  // cleared when it settles, so a later attempt never adopts a previous run as its parent.
  taskRunIds: Map<string, string>;
  parkRequests: Map<string, ParkRecord>;
  parkResumeNotes: Map<string, string>;
  saidNoCompute: Set<string>;
  // retention: a task's local deliverable workspace (worktree / scratch) is
  // kept after submit so a reviewer can open a terminal in it; reclaim it once
  // the task is accepted or closed. Local-only, best-effort. Removal is TOTAL
  // (dir + git admin entry + local branch + subject brain) — the plain `rm -rf`
  // this replaces left every clone accreting orphaned .git/worktrees entries and
  // dead nm/* branches forever (worktree-berths round, 2026-08-11).
  reclaimed: DurableSet<number>;
  // merge on accept: once a human ACCEPTS a repo-backed task that opened a PR, the
  // change is squash-merged to its base and the branch deleted — code reaches main
  // ONLY after acceptance, never by a direct commit. Uses gh's API (no worktree),
  // so it survives the on-accept worktree reclaim; `merged` de-dupes (one attempt
  // per task per process); failures surface in the thread instead of silently
  // swallowing. NM_GH_FAKE makes this deterministic for the gate.
  // DURABLE (docs/harness/05): a merge attempt is an already-handled FACT, not in-flight state. After a
  // restart the old Set was empty, so an accepted task could be re-merged — and `gh pr merge` on an
  // already-merged PR fails loudly into the task thread. Same for the worktree reclaim below.
  merged: DurableSet<string>;
  planned: Set<string>;
  planningStaffingNotified: Set<string>;
  // orchestrator: decide on a proposed plan (plan_review, not yet offered).
  // v1 — approve and offer to a worker in scope. (Human plan-review + a
  // claude-judged revise loop are Phase 2.)
  decided: Set<string>;
  approvedOffered: Set<string>;
  noOrchLogged: Set<string>;
  // task → provider-selection event. A consent card changes messages/decisions,
  // but only a fresh human choice mints a new event key and authorizes a retry.
  designed: Map<string, string>;
  designAsked: Set<string>;
  designQuestionRetries: Map<string, number>;
  // orchestrator: announce proposed mockups (design_review). Unlike plan_review
  // there is NO judgment call here — design approval is human-only by the FSM;
  // the orchestrator's job is to surface the review ask and notify the desktop.
  designNotified: Set<string>;
  importing: Set<string>;
  // approve path: offer the planned task to a worker in scope (the dev claims
  // it from plan_review → in_progress). Used by the auto path and by the
  // human's "Approve" choice.
  planOfferRetries: Map<string, number>;
  // ── memory spine: channel summary blocks (docs/03 §6) ─────────────────
  // The sleep-time worker runs on the orchestrator's machine (local compute,
  // cloud truth): refresh when ≥5 messages accumulated past the block basis.
  refreshing: Set<string>;
  // ── Ship stage (docs/23): the release gate between review-approve and merge ──
  // shipper pool: shipper-role agents on this machine pick up reviewer-approved,
  // PR-backed tasks in ship-gated projects. The done -> shipping transition IS the
  // atomic cross-machine claim (the second claimer gets ILLEGAL_TRANSITION); the
  // server re-verifies the PR + gate regardless of what happens here.
  // taskId → the redraft token this process already prepped for. Keying on the
  // token (not mere presence) is what lets a SECOND revise_ship_plan re-enter:
  // that request leaves the task in `shipping`, so the state never changes and
  // only ship_plan.revisionRequestedAt marks it as new work.
  shipPrepped: Map<string, string>;
  shipCiVerified: Set<string>;  // `${taskId}:${itemId}` — one CI verify per item
  shipExecuting: Set<string>;  // execute attempt in flight (re-armed on SHIP_ITEMS_PENDING)
  // verifying watch (docs/23 v2): execute_ship parked the task here — merge the
  // PR, then verify the RELEASE actually landed (post-merge CI on the merge
  // commit + the release workflows its push triggered) before confirm_release
  // carries it into accepted. Detection is code (shipverify.ts); a red verdict
  // never auto-accepts — it alerts the thread and holds, with the human's
  // Accept as the override and request_changes as the fix-forward bounce.
  // Like the releasing executor, only a machine hosting the channel shipper
  // acts (that's the machine that ran execute_ship); the merge is idempotent
  // across restarts/machines via the PR's own state, and every announcement
  // dedupes against the thread itself — never an in-memory set.
  verifyInFlight: Set<string>;
  // orchestrator: announce a proposed release plan (ship_review). Approval is
  // human-only by the FSM — the announce surfaces the ask + notifies the desktop.
  // Dedupe is PERSISTED via the announce message itself (checked in the thread),
  // NOT an in-memory set — a daemon restart must not re-announce every round
  // (the design_review announcer's known in-memory trap).
  shipAnnounceInFlight: Set<string>;
  // ── Hiring (human-gated agent creation; card + decision table in seed.ts) ──
  // The ACTIVE pack's role→model map (builtin from the shared catalog; custom brains
  // fetched from the server), for pack-default brains on hires. Per-call (no cache):
  // hires are rare and human-gated, and the pack can change mid-session.
  // ── Per-project brains (docs/10) ────────────────────────────────────────────
  // A workspace pack is MATERIALIZED into agents.model when applied. A project pack
  // cannot be: one agent row has one model column, and the same agent works across
  // projects — so the project override is resolved HERE, once per run, from the
  // channel's project. Every flow re-seats its agent at entry, which is why the
  // eleven downstream `agent.model` reads need no changes.
  //
  // Custom packs are not synced (deliberately, like workspaces), so a `custom:` id
  // costs one API fetch — cached briefly, because a run resolves this on every wake.
  customPackCache: Map<string, { at: number; packs: CustomModelPack[] }>;
  failoverCarded: Set<string>;  // `${ws}:${model}` — dedupe to one card per workspace+model
  exhaustedModels: Map<string, Set<string>>;  // ws → models known-capped this window (drives convergence)
  pendingFailover: Map<string, { rec: Recommendation; exhaustedModel: string; currentPack: string; channelId: string; parked: Array<{ agent: HostedAgent; task: ExecTask }> }>;
  sweptSummaries: Set<string>;  // `${chId}:${period}:${yyyy-mm-dd}` — in-memory de-dupe
  // Monitor gate state (sweepgate.ts): live channel-wake counts + per-channel monitor
  // watermarks. A deferred monitor KEEPS its watermark so the same window re-arms next
  // tick once the wake settles — advancing it would drop a crashed wake's request forever.
  wakesInFlight: Map<string, number>;  // channel id → live channel-wake turns
  monitorSince: Map<string, string>;  // channel id → monitor watermark (ISO)
  // ── Stall watchdog (stall.ts + docs/09 §3) ──────────────────────────────────────────────
  // Deterministic detection feeding orchestrator triage. Ages are ABSOLUTE against now —
  // never "since the last sweep" — so the first tick after boot (90s) recovers anything
  // that stalled while the app was closed (the #1011 overnight class: human design
  // feedback sat in a thread all night with no verdict). Detection/cooldowns are code;
  // choosing the unblocking action is the orchestrator's turn.
  firedStalls: Set<string>;  // stallKey() strings — one firing per (task, class, signal[, bucket])
}

/** Build the registry. `hostGuards` is the durable store the DurableSets write through. */
export function makeHostGuards(hostGuards: DurableStore): HostGuards {
  return {
    processed: new Set<string>(),
    firstSeen: new Map<string, number>(),
    wakeGaveUp: new Map<string, number>(),
    claimedIds: new Set<string>(),
    reviewed: new Set<string>(),
    hireProposed: new Set<string>(),
    markedOnline: new Set<string>(),
    claimFailNoticed: new Set<string>(),
    bootstrapAuthCardPosted: new Set<string>(),
    taskRunIds: new Map<string, string>(),
    parkRequests: new Map<string, ParkRecord>(),
    parkResumeNotes: new Map<string, string>(),
    saidNoCompute: new Set<string>(),
    reclaimed: new DurableSet<number>(hostGuards, 'reclaimed'),
    merged: new DurableSet<string>(hostGuards, 'merged'),
    planned: new Set<string>(),
    planningStaffingNotified: new Set<string>(),
    decided: new Set<string>(),
    approvedOffered: new Set<string>(),
    noOrchLogged: new Set<string>(),
    designed: new Map<string, string>(),
    designAsked: new Set<string>(),
    designQuestionRetries: new Map<string, number>(),
    designNotified: new Set<string>(),
    importing: new Set<string>(),
    planOfferRetries: new Map<string, number>(),
    refreshing: new Set<string>(),
    shipPrepped: new Map<string, string>(),
    shipCiVerified: new Set<string>(),
    shipExecuting: new Set<string>(),
    verifyInFlight: new Set<string>(),
    shipAnnounceInFlight: new Set<string>(),
    customPackCache: new Map<string, { at: number; packs: CustomModelPack[] }>(),
    failoverCarded: new Set<string>(),
    exhaustedModels: new Map<string, Set<string>>(),
    pendingFailover: new Map<string, { rec: Recommendation; exhaustedModel: string; currentPack: string; channelId: string; parked: Array<{ agent: HostedAgent; task: ExecTask }> }>(),
    sweptSummaries: new Set<string>(),
    wakesInFlight: new Map<string, number>(),
    monitorSince: new Map<string, string>(),
    firedStalls: new Set<string>(),
  };
}
