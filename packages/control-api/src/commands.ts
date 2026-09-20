import { z } from 'zod';
import { MACHINE_COMMANDS } from './commands-machine';
import { MARKETING_RELEASES, SCHEDULE_RUN_COMMANDS, SETUP_RELEASES_VALUE } from './commands-schedule';
import { WORK_PLAN_LEGS,
  MODEL_ID_SET, PACKS, CUSTOM_PACK_ID, isCustomPackId, TASK_KINDS, TASK_STATES, BEAT_STATUSES, RUN_KINDS, RUN_SETTLE_STATES, THREAD_MODES,
  // Human (companion) command schemas — defined in @neuramesh/shared so mobile/web
  // clients type their payloads against the same schema the server validates.
  taskCreateCommand, taskAcceptCommand, taskApproveCommand, taskRequestChangesCommand,
  taskCancelCommand, taskBlockCommand, taskUnblockCommand, taskArchiveCommand,
  taskPromoteCommand, taskReopenCommand, taskUpdateDetailsCommand, taskSetDefinitionOfDoneCommand,
  taskRequestPlanCommand, taskRevisePlanCommand, taskRequestDesignCommand,
  taskSelectDesignProviderCommand,
  taskReviseDesignCommand, taskApproveDesignCommand, messagePinCommand,
  taskApproveShipPlanCommand, taskReviseShipPlanCommand, taskCheckShipItemCommand,
  taskAddShipItemCommand, taskFinishSubtaskCommand, SHIP_ITEM_OWNERS, SHIP_RISKS,
  decisionAnswerCommand, decisionDismissCommand,
  POLICY_SCOPES, POLICY_CAPABILITIES, POLICY_VERDICTS, PolicySelectorSchema,
  WB_TITLE_MAX, WB_MERMAID_MAX, WB_SCENE_MAX, WB_SNAPSHOT_MAX,
} from '@neuramesh/shared';

// A model id must be one the system knows how to route (the current + legacy catalog in
// @neuramesh/shared). Rejecting unknown ids at the boundary closes the "typo'd/hallucinated
// pack model persists, then fails at agent-run time" gap — NeuraMesh #4 (enforced, not prompted).
const modelId = z.string().min(1).refine((m) => MODEL_ID_SET.has(m), { message: 'unknown model id' });
// A workspace's active model pack: a known pack id, the 'custom' sentinel (no managed pack),
// or a `custom:<uuid>` custom-brain id (the handler verifies the row exists before persisting).
const packId = z.string().refine((p) => p === CUSTOM_PACK_ID || p in PACKS || isCustomPackId(p), { message: 'unknown model pack' });
// A custom-brain id is always prefixed — it can never collide with a builtin pack id.
const customPackId = z.string().refine((p) => isCustomPackId(p), { message: 'not a custom pack id' });
// A custom brain's role→model map: every agent role seated with a routable model, worker
// mirroring developer (it is a legacy alias — one seat, not two). `satisfies` keeps the key
// set compile-locked to AgentRole, so a new role can't silently ship unseated.
const packRoles = z.object({
  worker: modelId, developer: modelId, reviewer: modelId, orchestrator: modelId,
  designer: modelId, sales: modelId, architect: modelId, curator: modelId, shipper: modelId, marketer: modelId,
} satisfies Record<import('@neuramesh/shared').AgentRole, typeof modelId>)
  .refine((r) => r.worker === r.developer, { message: 'worker aliases developer — their models must match' });

export const ActorSchema = z.object({
  kind: z.enum(['human', 'agent']),
  id: z.string().min(1),
  role: z.enum(['worker', 'developer', 'reviewer', 'orchestrator', 'designer', 'sales', 'architect', 'curator', 'shipper', 'marketer']).optional(),
});

const taskId = z.string().min(1);
// work-type label (docs/16). Optional on every command that carries it: the handler
// enforces a task IS labeled at ROUTE time (create-with-offerTo, offer, request_plan,
// request_design), but never couples kind to route — any kind may take any route.
// 'setup' is EXCLUDED at the schema: setup tasks are born by the SERVER when a flow-bearing
// channel is (setupflows.ts, one per channel by index) — task.create minting one would be an
// agent filing a human checklist, which is a category error, not a routing choice.
const taskKind = z.enum(TASK_KINDS.filter((k) => k !== 'setup') as [Exclude<(typeof TASK_KINDS)[number], 'setup'>, ...Exclude<(typeof TASK_KINDS)[number], 'setup'>[]]);

const ArtifactInputSchema = z.object({
  kind: z.enum(['screenshot', 'test_report', 'diff', 'doc', 'file', 'design']),
  name: z.string().min(1),
  // small text artifacts (diffs, notes) inline; binary/large go to Storage later
  content: z.string().max(400_000).optional(),
});

// The full command union the server validates: the shared human commands + the
// agent/daemon/admin commands a phone never sends (claim, submit, propose_*,
// register, memory, skills, repo/project/channel admin, credentials). Members are
// inlined as a literal array so zod keeps precise per-member type inference.
export const CommandSchema = z.discriminatedUnion('type', [
  taskCreateCommand,
  z.object({
    type: z.literal('task.offer'),
    taskId,
    offerTo: z.string().min(1),
    // intake resolution may bind the repo the thread conversation settled on
    repo: z
      .object({ id: z.string().min(1), baseRef: z.string().min(1).default('main') })
      .optional(),
    // the resolved requirement checks from the thread — recorded as confirmed
    checklist: z.array(z.string().min(1)).optional(),
    // the Definition of Done the orchestrator settled on for this offer
    definitionOfDone: z.string().max(20_000).optional(),
    // work-type label (docs/16) — the handler requires the task to be labeled at
    // offer (this kind, or one already on the task); it never gates the route.
    kind: taskKind.optional(),
  }),
  z.object({ type: z.literal('task.claim'), taskId }),
  z.object({
    type: z.literal('task.confirm_requirements'),
    taskId,
    checklist: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal('task.submit'),
    taskId,
    artifacts: z.array(ArtifactInputSchema).default([]),
    sha: z.string().min(1).optional(),
    // repo-backed work opens a PR — its url/number ride the submit so the reviewer
    // can gate on CI and the merge-on-accept watch can squash-merge it.
    prUrl: z.string().min(1).optional(),
    prNumber: z.number().int().positive().optional(),
  }),
  taskRequestChangesCommand,
  taskApproveCommand,
  taskAcceptCommand,
  taskCancelCommand,
  taskBlockCommand,
  taskUnblockCommand,
  taskArchiveCommand,
  // Backlog lifecycle (docs/15). promote releases a parked idea into todo —
  // humans or the orchestrator only (the FSM rejects everyone else); from todo
  // it enters the normal triage (design/plan/offer). update_details is the
  // scratch-board edit: title/description stay mutable while the task is
  // pre-work (backlog/todo); humans or the orchestrator only.
  taskPromoteCommand,
  taskReopenCommand,
  taskUpdateDetailsCommand,
  // Plan lifecycle (implementation-quality gate). request_plan routes a task
  // into planning and assigns the architect; propose_plan (architect) moves it
  // to plan_review; revise_plan (orchestrator/human) sends it back for changes.
  taskRequestPlanCommand,
  // the architect's final plan rides in as markdown — attached as a reviewable
  // 'doc' artifact (implementation-plan.md) when the task enters plan_review
  z.object({
    type: z.literal('task.propose_plan'),
    taskId,
    plan: z.string().min(1).max(60_000),
    // Plan-first units (2026-08-17): a revise round may also update the STRUCTURE — the
    // declared legs and proposed subtasks — not just the prose. Floored by validateWorkPlanLegs
    // in the reducer; re-proposing always clears planApprovedAt (a changed plan needs a fresh
    // human sign-off, never an inherited one).
    legs: z.array(z.enum(WORK_PLAN_LEGS)).min(1).max(3).optional(),
    subtasks: z.array(z.string().min(1).max(200)).max(8).optional(),
  }),
  taskRevisePlanCommand,
  // Design lifecycle (visual-quality gate BEFORE planning — docs/14). request_design
  // routes user-facing work to the channel designer; propose_design (designer) carries
  // the mockups — self-contained HTML that lands as versioned 'design' artifacts —
  // into design_review; revise_design bounces it back with feedback; approve_design
  // is the HUMAN sign-off (enforced) that releases the task into planning.
  taskRequestDesignCommand,
  taskSelectDesignProviderCommand,
  z.object({
    type: z.literal('task.propose_design'),
    taskId,
    summary: z.string().max(2000).optional(),
    // the proposal round, computed by the proposing host (count of prior rounds + 1)
    // — cosmetic versioning for artifact names; the FSM/kind are what's enforced
    round: z.number().int().min(1).max(99).default(1),
    mockups: z
      .array(z.object({ name: z.string().min(1).max(120), html: z.string().min(1).max(300_000) }))
      .min(1)
      .max(6),
  }),
  taskReviseDesignCommand,
  taskApproveDesignCommand,
  // Ship lifecycle (the release gate between review-approve and merge — docs/23).
  // claim_ship: the channel shipper claims a reviewer-approved, repo-backed task in a
  // ship-gated project (the claim IS the atomic cross-machine dedupe — second claimer
  // gets ILLEGAL_TRANSITION). propose_ship_plan carries the readiness report (markdown →
  // a versioned 'ship' artifact) + the owner-tagged checklist into ship_review.
  // approve/revise/check/add are the shared human commands above; execute_ship is the
  // shipper's merge trigger, structurally refused until every item is checked (SHIP_ITEMS_PENDING).
  z.object({ type: z.literal('task.claim_ship'), taskId }),
  z.object({
    type: z.literal('task.propose_ship_plan'),
    taskId,
    report: z.string().min(1).max(60_000),
    risk: z.enum(SHIP_RISKS),
    summary: z.string().max(2000).default(''),
    // the proposal round, computed by the proposing host (count of prior rounds + 1)
    round: z.number().int().min(1).max(99).default(1),
    items: z
      .array(
        z.object({
          id: z.string().min(1).max(40),
          title: z.string().min(1).max(300),
          detail: z.string().max(2000).default(''),
          owner: z.enum(SHIP_ITEM_OWNERS),
          agentId: z.string().min(1).optional(),
          // 'ci' items are host-verified (gh pr checks) — may arrive pre-checked
          auto: z.enum(['ci']).optional(),
          state: z.enum(['pending', 'done']).default('pending'),
          note: z.string().max(500).default(''),
        }),
      )
      .min(1)
      .max(20),
  }),
  taskApproveShipPlanCommand,
  taskReviseShipPlanCommand,
  taskCheckShipItemCommand,
  taskAddShipItemCommand,
  taskFinishSubtaskCommand,
  z.object({ type: z.literal('task.execute_ship'), taskId }),
  // confirm_release: the host's verifying watch reports the release landed —
  // post-merge CI on the merge commit + release workflows settled green — moving
  // verifying → accepted. Issued as the shipper by the machine that merged;
  // a red/pending verdict never sends it (the human's accept is the override).
  z.object({ type: z.literal('task.confirm_release'), taskId, note: z.string().max(2000).default('') }),
  // Set/edit the task's Definition of Done (the acceptance contract the reviewer
  // gates on). Humans or the orchestrator, while the task is still open.
  taskSetDefinitionOfDoneCommand,
  // Beats (docs/17): an agent declares the ordered steps for the phase it just picked up,
  // then advances them live. The handler gates on the agent's role owning the current phase;
  // beats are DESCRIPTIVE and never gate an FSM transition.
  z.object({
    type: z.literal('beats.declare'),
    taskId,
    phase: z.enum(TASK_STATES),
    items: z.array(z.string().min(1).max(200)).min(1).max(12),
  }),
  z.object({ type: z.literal('beats.advance'), taskId, seq: z.number().int().min(0), status: z.enum(BEAT_STATUSES) }),
  // Runs (docs/29): the durable row behind a stretch of agent work. `run.open` mints it (an
  // agent, always — a human never opens a run), `run.step` bumps the live line + progress,
  // `run.settle` closes it into a terminal state. Descriptive, never gating.
  // The third of the four human gates (docs/29 §4d). Not a transition: approving does not move the
  // task, it unlocks the edge OUT of plan_review — the same shape as confirm_requirements, because
  // both the owned and the delegated path need the claim that follows to stay exactly as it is.
  z.object({
    type: z.literal('task.approve_plan'),
    taskId: z.string().min(1),
  }),
  z.object({
    type: z.literal('run.open'),
    id: z.string().uuid().optional(), // caller-minted so the daemon can address it before the round trip
    workspace: z.string().min(1),
    channel: z.string().min(1),
    threadId: z.string().min(1).optional(),
    runTaskId: z.string().min(1).optional(),
    parentRunId: z.string().min(1).optional(),
    kind: z.enum(RUN_KINDS),
    title: z.string().min(1).max(200),
    total: z.number().int().min(0).max(64).default(0),
    step: z.string().max(200).optional(),
    // which config this run is seated on — `role·model[·@specialist]` (0103). Leg runs only.
    seat: z.string().max(160).optional(),
    // The WAKE LEASE (0114). Set to the message this run answers and the open becomes a claim:
    // one host per (agent, trigger) wins, the rest get `won: false` and stand down BEFORE
    // spending a token. Omitted for task/sweep runs, which their own claim already dedupes.
    triggerMessageId: z.string().uuid().optional(),
    // which member's machine is actually serving this run — the thing that makes shared compute
    // legible ("patch is working on bob's laptop") and billing attributable
    machineId: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal('run.step'),
    runId: z.string().min(1),
    step: z.string().max(200).optional(),
    done: z.number().int().min(0).max(64).optional(),
    total: z.number().int().min(0).max(64).optional(),
  }),
  z.object({
    type: z.literal('run.settle'),
    runId: z.string().min(1),
    state: z.enum(RUN_SETTLE_STATES), // includes `parked` — settleable, but NOT terminal
    summary: z.string().max(600).optional(),
  }),
  // the machine commands live in commands-machine.ts (member-machines round, 2026-09-03): this
  // file sits at its size-ratchet cap and the kind grew three verbs
  ...MACHINE_COMMANDS,
  z.object({
    type: z.literal('agent.register'),
    workspace: z.string().min(1),
    machineId: z.string().min(1),
    name: z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/),
    role: z.enum(['worker', 'developer', 'reviewer', 'orchestrator', 'designer', 'sales', 'architect', 'curator', 'shipper', 'marketer']).default('developer'),
    model: modelId.default('claude-opus-4-8'),
    runtime: z.enum(['claude-code', 'codex', 'gemini']).default('claude-code'),
    emoji: z.string().min(1).max(8).optional(), // persona face; omitted → client derives from name
    // The two agent strings (0110). `description` is the ROUTING signal — third person, what it
    // does + when to route here — read by the orchestrator in list_agents and published on the
    // A2A card. `brief` is the INSTRUCTIONS: second person, how the work is done, injected into
    // every turn this agent takes. Two readers, two caps.
    description: z.string().min(1).max(280).optional(),
    brief: z.string().min(1).max(2000).optional(),
    channels: z.array(z.string().min(1)).min(1),
  }),
  // edit a registered agent's brain (model/provider), name, description or instructions — the
  // daemon re-reads them live. role stays immutable (FSM/permissions depend on it).
  z.object({
    type: z.literal('agent.update'),
    agent: z.string().min(1), // agent id
    model: modelId.optional(),
    runtime: z.enum(['claude-code', 'codex', 'gemini']).optional(),
    name: z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/).optional(),
    // '' clears either string back to null (the UI's empty field must be able to mean "none")
    description: z.string().max(280).optional(),
    brief: z.string().max(2000).optional(),
    // provenance: 'manual' = a human pinned this brain (pack-apply must skip it); 'pack' = pack-managed.
    // The handler stamps 'manual' on a human model edit when the caller doesn't set it explicitly.
    modelSource: z.enum(['pack', 'manual']).optional(),
  }),
  // Retire an agent (HUMAN-ONLY, soft): it leaves the active roster — daemon stops
  // hosting it, selection pools skip it, its A2A card unpublishes — but the row and
  // every event/task attribution stay, so derived history (docs/13) never orphans.
  // Refused while the agent has open work. agent.register with the same name rehires.
  z.object({ type: z.literal('agent.retire'), agent: z.string().min(1) /* agent id */ }),
  // Consume an external A2A agent: fetch its Agent Card by URL, register it as a
  // 'remote' agent (no local machine) the host delegates to over A2A JSON-RPC.
  z.object({
    type: z.literal('agent.connect_remote'),
    workspace: z.string().min(1),
    channels: z.array(z.string().min(1)).min(1),
    cardUrl: z.string().min(1), // the agent's /.well-known/a2a/agent-card.json or card URL
  }),
  z.object({
    type: z.literal('agent.set_status'),
    agentId: z.string().min(1),
    status: z.enum(['online', 'offline', 'thinking', 'working']),
  }),
  z.object({ type: z.literal('artifact.promote'), artifactId: z.string().min(1) }),
  // Deleting a file (2026-08-18). HUMAN_ONLY, and REFUSED for anything a gate resolves against —
  // a design round, an implementation or release plan, a reviewer's diff, a test report. See
  // `isGateArtifact` in @neuramesh/shared: the client hides the control from the same predicate,
  // but the refusal lives here, because "don't delete the evidence" must be impossible rather
  // than discouraged (doctrine §4).
  z.object({ type: z.literal('artifact.delete'), artifactId: z.string().min(1) }),
  z.object({
    type: z.literal('memory.refresh_block'),
    workspace: z.string().min(1),
    channel: z.string().min(1),
    kind: z.enum(['channel_summary', 'project_brief']).default('channel_summary'),
    content: z.string().min(1).max(4000),
    basisCount: z.number().int().nonnegative().default(0),
  }),
  z.object({
    type: z.literal('memory.upsert_fact'),
    workspace: z.string().min(1),
    channel: z.string().min(1),
    content: z.string().min(8).max(600),
    basisCount: z.number().int().nonnegative().default(0),
  }),
  // A lesson: the durable norm a review correction taught (e.g. "evidence renders
  // attach as artifacts — mock HTML never gets committed"). The one memory write ANY
  // teammate may make — the agent that was just corrected holds the freshest version.
  z.object({
    type: z.literal('memory.record_lesson'),
    workspace: z.string().min(1),
    channel: z.string().min(1),
    content: z.string().min(12).max(500),
    taskId: taskId.optional(), // provenance: the task whose review taught it
  }),
  // Curation: end a fact/lesson's validity (bitemporal retire — the row and its
  // provenance stay; valid_until closes). supersededBy names the successor when a
  // correction was recorded but the reconcile's overlap check missed the rewrite,
  // so the supersession chain stays intact either way.
  z.object({
    type: z.literal('memory.retire_fact'),
    factId: z.string().uuid(),
    supersededBy: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal('workspace.create'),
    name: z.string().min(1).max(60),
    slug: z.string().min(2).max(40).regex(/^[a-z0-9][a-z0-9-]*$/),
  }),
  z.object({ type: z.literal('workspace.delete'), workspace: z.string().min(1) }),
  z.object({ type: z.literal('account.delete') }),
  // An invite is a pending row + an email; the invitee authenticates through Clerk and the
  // verified-email claim attaches them (docs/27 §1d). No password: the old one created a
  // Supabase auth user that Clerk would never accept, for an identity that never got a
  // membership. `password` is accepted-and-ignored for one release so an older desktop build
  // doesn't hard-fail zod validation mid-rollout.
  z.object({
    type: z.literal('workspace.invite'),
    workspace: z.string().min(1),
    email: z.string().email(),
    password: z.string().optional(),
    memberRole: z.enum(['member', 'admin']).default('member'),
  }),
  z.object({ type: z.literal('workspace.revoke_invite'), workspace: z.string().min(1), invite: z.string().uuid() }),
  // Answering an invitation (0113). No `workspace` field on purpose: the invite id resolves its
  // own workspace, and taking one from the caller would invite a mismatch to reason about. The
  // server re-verifies the caller's email against the invite — the id is a handle, not a key.
  z.object({ type: z.literal('workspace.accept_invite'), invite: z.string().uuid() }),
  z.object({ type: z.literal('workspace.decline_invite'), invite: z.string().uuid() }),
  // Membership exits. `leave` acts on the caller; `remove_member` on someone else — kept apart
  // so the owner rules can differ (you may not leave as owner; nobody may remove the owner).
  z.object({ type: z.literal('workspace.leave'), workspace: z.string().min(1) }),
  z.object({ type: z.literal('workspace.remove_member'), workspace: z.string().min(1), member: z.string().uuid() }),
  // workspace-level settings (Workspace settings UI). autoFailover = the provider-auth
  // failover policy: when a preferred subscription login is down, false (default) surfaces
  // an auth card (no surprise spend); true fails over to a provided API key automatically.
  z.object({
    type: z.literal('workspace.update'),
    workspace: z.string().min(1),
    autoFailover: z.boolean().optional(), activeModelPack: packId.optional(),
    // the workspace's voice (docs/design/agent-comm-rules-2026-08) — HUMAN-only in the handler; null reads as defaults-ON
    commRules: z.object({ ste100: z.boolean().optional(), noEmdash: z.boolean().optional(), custom: z.array(z.string().min(1).max(200)).max(8).optional() }).optional(),
    // the video tier (0140): a Pro workspace's pick among the tiers the server serves; null = the default
    videoTier: z.enum(['starter', 'xpress', 'premium']).nullable().optional(),
  }),
  // re-bind every agent to its home-remit channels across all projects (recovery for orphaned
  // registrations + makes the team usable across projects). idempotent.
  z.object({ type: z.literal('workspace.sync_agents'), workspace: z.string().min(1) }),
  // Custom brains (user-authored model packs): save = create (packId omitted; the server
  // mints `custom:<uuid>`) or update (packId present). Human-only in the handler, like
  // workspace.update. Activation stays a separate workspace.update {activeModelPack}.
  z.object({
    type: z.literal('modelpack.save'),
    workspace: z.string().min(1),
    packId: customPackId.optional(),
    name: z.string().trim().min(1).max(40),
    roles: packRoles,
  }),
  z.object({ type: z.literal('modelpack.delete'), workspace: z.string().min(1), packId: customPackId }),
  // Agent permission policy (Phase 1): humans configure allow/ask/deny rules per scope.
  // setPolicy upserts by id (absent id = insert a new rule); selector is the shared DSL.
  z.object({
    type: z.literal('policy.set'),
    workspace: z.string().min(1),
    id: z.string().min(1).optional(),
    scope: z.enum(POLICY_SCOPES),
    projectId: z.string().min(1).nullable().optional(),
    channelId: z.string().min(1).nullable().optional(),
    agentId: z.string().min(1).nullable().optional(),
    capability: z.enum(POLICY_CAPABILITIES),
    selector: PolicySelectorSchema,
    verdict: z.enum(POLICY_VERDICTS),
    rationale: z.string().max(400).optional(),
    locked: z.boolean().optional(),
  }),
  z.object({ type: z.literal('policy.delete'), workspace: z.string().min(1), policyId: z.string().min(1) }),
  z.object({
    type: z.literal('skill.create'),
    workspace: z.string().min(1),
    channel: z.string().min(1).optional(), // omitted/global scope = workspace-wide
    name: z.string().min(1).max(60).regex(/^[a-z0-9][a-z0-9-]*$/),
    description: z.string().min(1).max(300),
    scope: z.enum(['channel', 'global']).default('channel'),
    body: z.string().min(1).max(40_000),
    packId: z.string().min(1).optional(), // bind into a skill pack (importer/seed use)
    enabled: z.boolean().default(true),
  }),
  // toggle a single skill's discoverability without deleting it (greyed in UI)
  z.object({ type: z.literal('skill.set_enabled'), skillId: z.string().min(1), enabled: z.boolean() }),
  z.object({
    type: z.literal('skill.update'),
    skillId: z.string().min(1),
    description: z.string().min(1).max(300).optional(),
    body: z.string().min(1).max(40_000).optional(),
    scope: z.enum(['channel', 'global']).optional(),
  }),
  z.object({ type: z.literal('skill.deprecate'), skillId: z.string().min(1) }),
  // agent self-learning: any agent proposes a reusable procedure it discovered
  // → lands as draft for orchestrator/human curation (dedups onto an existing
  // draft of the same name+scope rather than spamming).
  z.object({
    type: z.literal('skill.propose'),
    workspace: z.string().min(1),
    channel: z.string().min(1).optional(),
    name: z.string().min(1).max(60).regex(/^[a-z0-9][a-z0-9-]*$/),
    description: z.string().min(1).max(300),
    scope: z.enum(['channel', 'global']).default('channel'),
    body: z.string().min(1).max(40_000),
  }),
  // curation gate: promote a draft to active (supersedes a same-name active).
  z.object({ type: z.literal('skill.promote'), skillId: z.string().min(1) }),
  // Skill packs: a versioned bundle of skills. create opens an 'importing' row;
  // the Curator (or the bundled seed path) commits the parsed skills atomically.
  z.object({
    type: z.literal('skillpack.create'),
    workspace: z.string().min(1),
    channel: z.string().min(1),
    name: z.string().min(1).max(60).regex(/^[a-z0-9][a-z0-9-]*$/),
    description: z.string().max(300).default(''),
    sourceUrl: z.string().max(400).default(''),
    sourceRef: z.string().min(1).max(120).default('main'),
    origin: z.enum(['bundled', 'imported']).default('imported'),
  }),
  z.object({
    type: z.literal('skillpack.commit'),
    packId: z.string().min(1),
    version: z.string().max(120).default(''),
    skills: z
      .array(
        z.object({
          name: z.string().min(1).max(60).regex(/^[a-z0-9][a-z0-9-]*$/),
          description: z.string().max(300).default(''),
          body: z.string().min(1).max(40_000),
        }),
      )
      .max(300),
  }),
  z.object({
    type: z.literal('skillpack.update'), // importer progress + terminal states
    packId: z.string().min(1),
    status: z.enum(['importing', 'ready', 'error']).optional(),
    step: z.string().max(120).optional(),
    progress: z.number().int().min(0).max(100).optional(),
    error: z.string().max(2000).optional(),
    description: z.string().max(300).optional(),
  }),
  z.object({ type: z.literal('skillpack.set_enabled'), packId: z.string().min(1), enabled: z.boolean() }),
  z.object({ type: z.literal('skillpack.remove'), packId: z.string().min(1) }),
  // idempotently seed the bundled default packs into a channel (backfills existing #dev);
  // kind picks the seed list — marketing rooms get marketing-core
  z.object({ type: z.literal('skillpack.seed_defaults'), workspace: z.string().min(1), channel: z.string().min(1), kind: z.enum(['build', 'marketing']).optional() }),
  // register a GitHub repo to the workspace so tasks can bind + push to it.
  // Metadata only — no tokens stored; the executing machine's own git creds
  // authenticate at clone/push (platform never holds repo write tokens).
  z.object({
    type: z.literal('repo.link'),
    workspace: z.string().min(1),
    channel: z.string().min(1).optional(), // attach to this channel's default project
    project: z.string().min(1).optional(), // …or attach directly to this project (code workspace)
    url: z.string().min(1).optional(), // github/gitlab URL — or use localPath
    localPath: z.string().min(1).optional(), // a local folder on the machine → provider 'local'
    name: z.string().min(1).optional(), // display name for a local folder
    defaultBranch: z.string().min(1).default('main'),
  }),
  // Projects are the work axis: workspace-scoped initiatives that OWN channels
  // (1:N — a channel belongs to one project). create may move existing channels in.
  z.object({
    type: z.literal('project.create'),
    workspace: z.string().min(1),
    name: z.string().min(1).max(80),
    // the slug is set at creation (immutable after); omitted = derived from the name.
    slug: z.string().min(1).max(40).regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
    description: z.string().max(2000).default(''),
    // project identity — the site the project ships, and a small logo detected from it
    // (or from the repo folder) on the user's machine. The logo is a compact data: URL
    // (icon resized client-side) or an https URL; capped well under the inline sync limit.
    website: z.string().max(2048).regex(/^$|^https?:\/\//).optional(),
    logoUrl: z.string().max(200_000).regex(/^$|^(data:image\/|https?:\/\/)/).optional(),
    channels: z.array(z.string().min(1)).default([]), // channel ids to move into the new project
    newChannels: z.array(z.string().min(1)).default([]), // slugs of fresh channels to create in the new project
  }),
  // Conversation threads (the conversation-first shell): refine the heuristic title or
  // add a description — the orchestrator does this after its first reply; humans may too.
  z.object({
    type: z.literal('thread.update'),
    workspace: z.string().min(1),
    threadId: z.string().uuid(),
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
  }),
  // docs/34 — the Tasks toggle, moved on a conversation that already exists. HUMAN_ONLY: this
  // is the line between "the agent is talking to me" and "the agent is filing work", and an
  // agent must never be able to move its own conversation onto the board. Both directions are
  // legal — chat → tasks escalates in place (the next message triages), tasks → chat stops the
  // routing without touching whatever task the thread already carries.
  z.object({
    type: z.literal('thread.set_mode'),
    workspace: z.string().min(1),
    threadId: z.string().uuid(),
    mode: z.enum(THREAD_MODES),
  }),
  // WHERE A SESSION RUNS (0134, rule D9): move a conversation's designated machine. Human-only,
  // like the mode: an agent steering a conversation onto a machine is the confused-deputy shape.
  // Null = no designation (the ladder's origin rung and the member's standing choices decide).
  z.object({
    type: z.literal('thread.set_machine'),
    workspace: z.string().min(1),
    threadId: z.string().uuid(),
    machineId: z.string().uuid().nullable(),
  }),
  // Compute choice (0118): where THIS member's requests run — a default machine for new
  // conversations plus per-agent overrides. Self-only by construction: the handler writes the
  // ACTOR's row, so the payload cannot name another member. Null machine = back to origin
  // affinity. Advisory routing (shouldClaim reads it); the wake lease stays the enforcement.
  z.object({
    type: z.literal('member.set_compute'),
    workspace: z.string().min(1),
    machine: z.string().uuid().nullable().optional(),
    agents: z.record(z.string().uuid(), z.string().uuid()).optional(),
    // consent (0119): members this one lends their machines to. '*' = the whole workspace.
    shares: z.array(z.union([z.literal('*'), z.string().uuid()])).max(200).optional(),
    // rule D9 (2026-09-04): where sessions started on this member's desktop run — 'here' or 'auto'
    desktopSessions: z.enum(['here', 'auto']).optional(),
  }),
  // ONE lend/revoke, as INTENT. The client used to compute the resulting set, which meant
  // expanding '*' from its own replica — and on a stale one that silently dropped everyone it had
  // not synced yet (live, 2026-08-14). The server has the real roster.
  z.object({
    type: z.literal('member.share_compute'),
    workspace: z.string().min(1),
    member: z.string().uuid(),
    on: z.boolean(),
  }),
  // Auto-filing (0109): move a conversation into the room it belongs in. The orchestrator does
  // this during the triage turn it already runs, so the human never has to pick a room; a human
  // can correct it any time. Every rule lives in `canFileConversation` (packages/shared/filing.ts)
  // so the gate is one pure function both this handler and the daemon read.
  z.object({
    type: z.literal('thread.move'),
    workspace: z.string().min(1),
    threadId: z.string().uuid(),
    channel: z.string().uuid(),
    // the one clause shown beside Undo. Required of an agent (a move with no stated reason is a
    // move you cannot argue with); optional for a human, whose reason is that they said so.
    reason: z.string().min(1).max(200).optional(),
  }),
  // Archiving a conversation (0108). HUMAN_ONLY: it is the human's own filing, and an agent that
  // could archive a thread could hide a conversation the human is waiting on. Chat threads only —
  // enforced in the handler, because a TASK thread's life belongs to the board, not to a list.
  z.object({
    type: z.literal('thread.archive'),
    workspace: z.string().min(1),
    threadId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('thread.unarchive'),
    workspace: z.string().min(1),
    threadId: z.string().uuid(),
  }),
  // Settle (0137): settled_at and nothing else, HUMAN_ONLY, any thread (shared/threadstatus.ts). One line: the file's cap.
  z.object({ type: z.literal('thread.settle'), workspace: z.string().min(1), threadId: z.string().uuid() }), z.object({ type: z.literal('thread.unsettle'), workspace: z.string().min(1), threadId: z.string().uuid() }),
  // docs/10 §15 — the thread brain override: which MODEL each role runs in THIS conversation.
  // HUMAN_ONLY, like every other spend of money the human did not ask for: an agent that could
  // set its own model could move itself onto the most expensive one in the catalog.
  //
  // `override: null` is Reset — the WHOLE override, never a per-role clear (ruling 7). The role
  // keys and model values are validated in the handler against the same allow-list the packs
  // use, so an unknown model is a 400 rather than a seat that fails at run time.
  z.object({
    type: z.literal('thread.set_brain'),
    workspace: z.string().min(1),
    threadId: z.string().uuid(),
    override: z.record(z.string(), z.string()).nullable(),
  }),
  z.object({
    type: z.literal('project.update'),
    project: z.string().min(1),
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(2000).optional(),
    // '' clears the stored value (omitted = keep) — same shape as project.create
    website: z.string().max(2048).regex(/^$|^https?:\/\//).optional(),
    logoUrl: z.string().max(200_000).regex(/^$|^(data:image\/|https?:\/\/)/).optional(),
    autoOpenPr: z.boolean().optional(),
    runCiBeforeMerge: z.boolean().optional(),
    // the release gate (docs/23): reviewer-approved, PR-backed tasks get a
    // production-readiness plan from the channel shipper before merging.
    // Defaults ON — null/absent reads as true everywhere.
    shipGate: z.boolean().optional(),
    // per-project brains (docs/10): overrides the workspace pack for work in this
    // project. '' clears the override (back to inherit); omitted keeps it.
    modelPack: z.union([packId, z.literal('')]).optional(),
  }),
  // move a channel into a project (1:N ownership)
  z.object({
    type: z.literal('channel.assign'),
    channel: z.string().min(1), // channel id
    project: z.string().min(1), // project id
  }),
  // create a fresh room in a project (slug unique per project; topic optional)
  z.object({
    type: z.literal('channel.create'),
    workspace: z.string().min(1),
    project: z.string().min(1), // owning project id
    slug: z.string().min(1).max(40).regex(/^[a-z0-9][a-z0-9-]*$/),
    topic: z.string().max(280).default(''),
  }),
  // rename a room — slug and/or topic. Safe because a channel is identified by its
  // id, not its slug (everything refs the uuid); the slug is a per-project label.
  z.object({
    type: z.literal('channel.rename'),
    channel: z.string().min(1), // channel id
    slug: z.string().min(1).max(40).regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
    topic: z.string().max(280).optional(),
  }),
  // set a room's threads mode (docs/03 §5, docs/20): 'on' (default) keeps task replies in
  // their threads (the channel reads as digests); 'off' widens the channel feed to show thread
  // traffic inline. A view lens, never a reroute — every message keeps its task_id.
  z.object({
    type: z.literal('channel.set_thread_mode'),
    channel: z.string().min(1), // channel id
    mode: z.enum(['on', 'off']),
  }),
  // what the room is for (docs/design/marketing-channel-2026-07): 'build' runs today's
  // chat + board; 'marketing' runs the growth HQ (Feed · Calendar · Library). A lens plus
  // a toolbelt, never a silo — ACL, FSM, and artifacts are untouched. Human-only: rooms
  // change trade by the settings Kind row or the one-time #marketing upgrade prompt.
  z.object({
    type: z.literal('channel.set_kind'),
    channel: z.string().min(1), // channel id
    kind: z.enum(['build', 'marketing']),
  }),
  // permanently delete a room + everything in it (messages, tasks, history).
  // irreversible — the client gates it behind a type-the-slug confirmation.
  z.object({ type: z.literal('channel.delete'), channel: z.string().min(1) }),
  // schedules (marketing-channel plan §4.6): the generic "run X at time T" primitive. Arming
  // is human-only AND Cloud-gated — THE deep-funnel paywall moment (round 2); agents may only
  // propose (a card). 'once' carries its exact runAt; recurring carries local time + IANA tz
  // (+ weekday for weekly) and the server computes next_run_at via the shared cadence brain.
  z.object({
    type: z.literal('schedule.create'),
    channel: z.string().min(1), // channel id
    title: z.string().trim().min(1).max(200),
    prompt: z.string().trim().min(1).max(4000), // what the run asks the agent to do
    cadence: z.enum(['once', 'daily', 'weekdays', 'weekly']),
    runAt: z.string().datetime().optional(), // once only
    atTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), // recurring, default 09:00
    tz: z.string().max(64).optional(), // IANA, from the arming client
    weekday: z.number().int().min(0).max(6).optional(), // weekly only
    agent: z.string().min(1).optional(), // agent name; defaults to the room's marketer at run time
    // A ROUTINE (the universal launcher) rather than a marketing content schedule. The two share
    // this table, and the firing path used to tell them apart by CHANNEL KIND — so a routine armed
    // in a marketing room silently took the drafting path and produced a scheduled-draft card
    // instead of its own conversation. The distinction belongs to the row, not to the room.
    routine: z.boolean().optional(),
  }),
  z.object({ type: z.literal('schedule.set_status'), schedule: z.string().min(1), status: z.enum(['active', 'paused']) }),
  z.object({ type: z.literal('schedule.delete'), schedule: z.string().min(1) }),
  // edit an armed schedule in place (round 20): title/prompt/cadence/time — next_run_at
  // recomputes from the same cadence brain create uses; run_count is untouched (this is an
  // edit, not a claim). HUMAN_ONLY like the rest of schedule management.
  z.object({
    type: z.literal('schedule.update'),
    schedule: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    prompt: z.string().trim().min(1).max(4000),
    cadence: z.enum(['once', 'daily', 'weekdays', 'weekly']),
    runAt: z.string().datetime().optional(), // once only
    atTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    tz: z.string().max(64).optional(),
    weekday: z.number().int().min(0).max(6).optional(),
  }),
  // the verbs the daemon's schedule tick writes (claim_run · mark_result · set_cursor) ride
  // commands-schedule.ts, the commands-machine.ts shape: this file sits at its ratchet cap
  ...SCHEDULE_RUN_COMMANDS,
  // content items (marketing-channel plan §4.7): agents DRAFT (create), humans PUBLISH —
  // approve is HUMAN_ONLY and is what puts an item on the clock; unschedule bounces it
  // back to draft. Actual posting is the server's publish pass once connectors land.
  z.object({
    type: z.literal('content.create'),
    channel: z.string().min(1), // channel id
    task: z.string().min(1).optional(), // the content task (kind:'content') this draft delivers — renders inline in its thread
    // …or the CONVERSATION this draft was written in (0115). A social-post ask does not need a
    // board row, and before this the card could only exist on a task — which is why an agent
    // asked for drafts in a thread had to propose one. Either anchor renders the same card.
    thread: z.string().min(1).optional(),
    platform: z.enum(['x', 'instagram', 'linkedin', 'tiktok', 'email']).default('x'),
    body: z.string().trim().min(1).max(10_000),
    schedule: z.string().min(1).optional(), // the schedule row this draft came from
    // the slot this draft is FOR (draft-ahead: the tick runs ~30min early; approve
    // keeps this time unless overridden, and the calendar places the draft chip on it)
    slotAt: z.string().datetime().optional(),
    // the public image URL the post publishes with (REQUIRED by Instagram; optional context elsewhere)
    mediaUrl: z.string().url().max(2000).optional(),
    // the visual the marketer described. Kept OUT of the body (where it would publish verbatim
    // and break the character count) and stored beside the post — it is what the image generator
    // draws from, and what the card shows when generation didn't happen.
    imageBrief: z.string().trim().max(2000).optional(),
    // inline preview of the generated image: a downscaled data: URI that replicates with the
    // draft so the card shows the real picture (the 0048 chat-attachment precedent — thumbnail
    // travels, full bytes stay on the machine that made them). Bounded to protect the replica.
    thumb: z.string().startsWith('data:image/').max(200_000).optional(),
    // why a briefed draft has no image (generation failed / capped) — shown ON the card with a
    // Try-again, instead of the reason being buried in the marketer's summary message
    imageError: z.string().trim().max(600).optional(),
    // a VIDEO post's creator script (the UGC round): the body is the caption that posts with the
    // video, the script is what the creator films. Kept in media.script, never in the body.
    // `frame`: the shelf image the film shows as the product (brand-grounding plan §6), by name. `seconds`: the film's length (video-rung plan §8), the human's pick on the angle card or their word; the door holds it inside the tier's range
    script: z.string().trim().min(1).max(10_000).optional(), frame: z.string().trim().min(1).max(200).optional(), seconds: z.number().int().min(1).max(60).optional(),
  }),
  // the human tweaks a draft's text/media before approving (calendar preview edit) — never
  // a published item, and agents never rewrite what a human is reviewing. mediaUrl: a url
  // sets it, '' clears it, absent leaves it alone.
  z.object({ type: z.literal('content.update'), item: z.string().min(1), body: z.string().trim().min(1).max(10_000), mediaUrl: z.union([z.string().url().max(2000), z.literal('')]).optional() }),
  // the MARKETER revises its own still-unpublished draft after a human requests a change (§4.5).
  // Editing a draft is still DRAFTING — "agents draft, humans publish" — so this is agent-allowed,
  // but ONLY while status='draft' (a scheduled/published item is the human's, enforced in the
  // handler). body updates the copy; imageBrief re-states the visual it wants (kept in media.brief,
  // the daemon regenerates + re-hosts separately via attach_media).
  z.object({ type: z.literal('content.revise'), item: z.string().min(1), body: z.string().trim().min(1).max(10_000).optional(), imageBrief: z.string().trim().max(2000).optional(), script: z.string().trim().min(1).max(10_000).optional(), frame: z.string().trim().max(200).nullable().optional(), seconds: z.number().int().min(1).max(60).nullable().optional(),
    // the film's facts (the video rung): what filmed it, for how long, at what price; the machine's own-key lane writes them, the server's lane writes them itself
    videoMeta: z.object({ tier: z.string().max(40), model: z.string().max(80), seconds: z.number().int().min(1).max(60), credits: z.number().int().min(0), at: z.string().datetime(), frame: z.string().max(200).nullable().optional(), frameUsed: z.boolean().optional() }).optional(),
    videoErrorCode: z.enum(['NO_CREDITS', 'UNAVAILABLE']).nullable().optional(), thumb: z.string().startsWith('data:image/').max(200_000).optional(), imageError: z.union([z.string().trim().max(600), z.literal('')]).optional(), videoError: z.union([z.string().trim().max(600), z.literal('')]).optional() }),
  // host a draft's image so it can actually PUBLISH (0090). Every network takes media only as a
  // public URL someone else fetches — Meta pulls it directly, TikTok pulls it through our proxy,
  // X wants the bytes — so a picture generated on the user's machine has to land somewhere
  // fetchable. The bytes ride in as a data: URI and become /media/<id>, HMAC-gated.
  // a video rides the same lane (the UGC film, 2026-09-18): `data:video/mp4` bytes, one media per draft
  z.object({ type: z.literal('content.attach_media'), item: z.string().min(1), dataUrl: z.string().regex(/^data:(?:image|video)\//).max(9_000_000) }),
  // remove a draft/scheduled item from the calendar entirely (published stays, it's history)
  z.object({ type: z.literal('content.delete'), item: z.string().min(1) }),
  z.object({
    type: z.literal('content.approve'),
    item: z.string().min(1),
    scheduledAt: z.string().datetime().optional(), // default: one hour out
  }),
  z.object({ type: z.literal('content.unschedule'), item: z.string().min(1) }),
  // connectors (marketing-channel plan §4.8): connecting is the OAuth round-trip (no command);
  // disconnecting is a human call — revokes the row and deletes the sealed secret.
  z.object({ type: z.literal('connector.disconnect'), connector: z.string().min(1) }),
  // a plain channel artifact (no task): the marketing bootstrap's conversational doc drops
  // (round 4 — the analysis is a CONVERSATION, not a task) and any future channel-scoped file.
  z.object({
    type: z.literal('artifact.create'),
    channel: z.string().min(1), // channel id
    kind: z.enum(['doc', 'file']).default('doc'),
    name: z.string().trim().min(1).max(200),
    inlineContent: z.string().min(1).max(300_000),
    mime: z.string().max(100).optional(), tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(), // tags e.g. ['brand'] — the rail filters on it
  }),
  // Whiteboards (docs/38). create is the AGENT door — a board born from a generation source
  // (mermaid for flow/sequence/class, or an element-skeleton JSON string; strings only — the
  // lowest common schema every runtime's tool layer speaks). Humans create boards through the
  // local-first row path (/v1/whiteboards), never this command.
  z.object({
    type: z.literal('whiteboard.create'),
    channel: z.string().min(1), // channel id — the board's filing
    threadId: z.string().optional(), // provenance: the session that asked for it
    taskId: z.string().optional(), // provenance: the task it evidences
    title: z.string().trim().min(1).max(WB_TITLE_MAX),
    mermaid: z.string().min(1).max(WB_MERMAID_MAX).optional(),
    elements: z.string().min(1).max(WB_SCENE_MAX).optional(),
  }),
  // update is three shapes over one strict rev guard (baseRev must equal the board's rev, else
  // WHITEBOARD_STALE — the caller re-reads and reapplies): a new generation SOURCE (agent edit),
  // MATERIALIZE (the first desktop to render converts source → scene + snapshot and clears it),
  // or a TITLE-only rename. The LWW autosave path is /v1/whiteboards PATCH, not this command.
  z.object({
    type: z.literal('whiteboard.update'),
    whiteboardId: z.string().min(1),
    baseRev: z.number().int().min(1),
    title: z.string().trim().min(1).max(WB_TITLE_MAX).optional(),
    mermaid: z.string().min(1).max(WB_MERMAID_MAX).optional(),
    elements: z.string().min(1).max(WB_SCENE_MAX).optional(),
    scene: z.string().min(1).max(WB_SCENE_MAX).optional(),
    snapshotSvg: z.string().min(1).max(WB_SNAPSHOT_MAX).optional(),
    clearSource: z.boolean().optional(),
  }),
  // marketing HQ setup (marketing-channel plan §4.3): point the room at the product. Writes the
  // profile onto channels.marketing and fans out the bootstrap task ("Build the brand foundation")
  // through the ordinary task path, so triage/staffing take it from there. Human-only; FREE on
  // every plan by design (round 2) — the paywall sits on schedule.*/content.*, not the front door.
  z.object({
    type: z.literal('marketing.setup'),
    channel: z.string().min(1), // channel id
    website: z.string().trim().max(400).optional(),
    focus: z.array(z.enum(['social', 'content', 'seo', 'email', 'ads'])).max(5).optional(),
    goal: z.string().trim().max(300).optional(), // the human's stated aim, in their words
    // step 5, release drafts (docs/design/release-drafts-2026-09 §4.7): the repository to watch,
    // draft the latest release now (a free one-shot), watch daily (a Team routine)
    releases: MARKETING_RELEASES.optional(),
  }),
  // flip one marketing MCP integration on the room (marketing.mcp.<provider>) — the daemon
  // attaches the enabled servers to marketer research runs with MACHINE-LOCAL creds
  // (integrations-and-skills-plan.md: read paths local, publish custody stays ours)
  z.object({
    type: z.literal('marketing.set_integration'),
    channel: z.string().min(1), // channel id
    provider: z.enum(['posthog', 'x', 'meta', 'tiktok']),
    enabled: z.boolean(),
  }),
  // one answered SETUP-FLOW step (shared/setupflows.ts), written as it lands — what makes an
  // abandoned wizard resumable. flow/step must name a registered flow; the value's shape is
  // checked against the step in the handler (a website string vs a focus array). Human-only:
  // setup is the human's checklist by construction, like the flow's completing command.
  z.object({
    type: z.literal('setup.step'),
    channel: z.string().min(1), // channel id
    flow: z.string().min(1), // the registered flow id, e.g. 'marketing.v1'
    step: z.string().min(1), // a step id of that flow
    value: z.union([z.string().trim().max(400), z.array(z.string().trim().max(40)).max(8), SETUP_RELEASES_VALUE]).optional(),
  }),
  // release-day backfill (idempotent, daemon boot): setup tasks for flow-bearing rooms that
  // predate setup flows and were never configured. Returns how many were created.
  z.object({ type: z.literal('setup.backfill'), workspace: z.string().min(1) }),
  // add / remove an agent's membership in a channel (the agent_channels row). Agents are
  // workspace-scoped but only see a channel's context once added here — humans (the live-panel
  // "+") or the orchestrator (the "add @agent to #channel?" card). agent = id or name; channel = id or slug.
  z.object({ type: z.literal('channel.add_agent'), workspace: z.string().min(1), channel: z.string().min(1), agent: z.string().min(1) }),
  z.object({ type: z.literal('channel.remove_agent'), workspace: z.string().min(1), channel: z.string().min(1), agent: z.string().min(1) }),
  // channel people roster (0094): which humans the room's rail lists. `person` is an
  // nm_users id. A ROSTER, not an ACL — membership here grants nothing and gates nothing.
  z.object({ type: z.literal('channel.add_person'), workspace: z.string().min(1), channel: z.string().min(1), person: z.string().min(1) }),
  z.object({ type: z.literal('channel.remove_person'), workspace: z.string().min(1), channel: z.string().min(1), person: z.string().min(1) }),
  // pin/unpin a channel message so it stands out and can be found later
  messagePinCommand,
  // Card revisions (reply-radar): a card whose state lives in its body is rewritten IN PLACE,
  // never re-posted beside itself; the handler requires the new body to still carry a fence.
  z.object({ type: z.literal('message.revise_card'), message: z.string().min(1), body: z.string().min(1).max(60_000) }),

  // decisions (docs/12 slice 2): answer/dismiss an agent's nmq card — human-only, exactly-once
  decisionAnswerCommand,
  decisionDismissCommand,
  z.object({ type: z.literal('project.archive'), project: z.string().min(1) }), z.object({ type: z.literal('project.unarchive'), project: z.string().min(1) }),
  // permanently delete an ARCHIVED project + everything in it (rooms, tasks, messages, history).
  // irreversible — the client gates it behind a type-the-slug confirmation.
  z.object({ type: z.literal('project.delete'), project: z.string().min(1) }),
  z.object({
    type: z.literal('credential.set'),
    workspace: z.string().min(1),
    provider: z.string().min(1).default('anthropic'),
    scope: z.enum(['workspace', 'agent']),
    agentId: z.string().min(1).optional(),
    // token is required for apikey mode (validated in the handler). In subscription mode the
    // login lives in the provider CLI, so a token is optional there — but if supplied it's kept
    // as the FAILOVER key (used only when the subscription is down and Auto failover is on).
    token: z.string().min(8).optional(),
    authMode: z.enum(['apikey', 'subscription']).default('apikey'),
  }),
  // a member edits their OWN profile — the display name shown on their messages and
  // in the channel/people lists. The handler scopes the write to actor.id, so a
  // member can only ever change their own row (no target user id is accepted).
  z.object({
    type: z.literal('member.update_profile'),
    workspace: z.string().min(1),
    displayName: z.string().trim().min(1).max(60),
  }),
]);

export type Command = z.infer<typeof CommandSchema>;
