// THE STORE CONTRACT — extracted from store.ts (track C-store).
//
// 162 methods across ~23 domains, implemented twice (MemoryStore, PostgresStore). It is
// deliberately still ONE interface: splitting it into domain sub-interfaces is only worth
// doing alongside the repositories that implement them, and those wait on a shared
// contract suite — today's memory/pg test pairs are hand-written twice with mostly
// disjoint cases, so nothing yet proves the two implementations agree (plan §5).
import { type BrainOverride, type ActorRef, type Beat, type BeatStatus, type NMEvent, type Run, type RunSettleState, type RetroPayload, type RetroRange, type Task, type TaskKind, type TaskState, type ThreadMode } from '@neuramesh/shared';
import type { LifecycleRow } from '../lifecycle';
import type { MutationResult, ArtifactRow, AttachmentInput, ScheduleInput, NMMessage, DecisionSeed, DecisionRow, PolicyRow, PolicyInput, DesktopAuthResult, RunInput, WhiteboardRow, WhiteboardMeta, WhiteboardCreate, WhiteboardLwwPatch, WhiteboardUpdate } from './types';


export interface Store {
  nextTaskNumber(workspace: string): Promise<number>;
  // Agent Retro (docs/13) — optional: only the postgres store aggregates it
  // (events/facts are server-side); callers 501 when absent.
  retro?(workspace: string, range: RetroRange, dayStart: number): Promise<RetroPayload>;
  // fleet desired state (docs/design/cloud-first-2026-08) — optional: cloud machines are
  // server-side rows; only the postgres store serves the operator's poll. callers 501 when absent.
  fleetDesired?(): Promise<import('../fleet').FleetDesired>;
  createCloudMachine?(m: import('../fleet').CloudMachineCreate): Promise<{ id: string }>;
  machineByTokenHash?(hash: string): Promise<import('../fleet').MachineIdentityRow | null>;
  rotateMachineToken?(machineId: string, tokenHash: string): Promise<{ id: string } | null>;
  // nm-relay's client-attach check (relay.ts): which workspace does this machine live in?
  machineWorkspace?(machineId: string): Promise<import('../relay').MachineAttachRow | null>;
  // wake/idle-stop + starter metering (fleet-lifecycle.ts): the message path's wake bump, the
  // machine-sweep cron's pass (meter → cap-stop → idle-stop), and the UI meter's read.
  bumpMachineWake?(workspaceId: string, originUserId?: string | null): Promise<void>;
  machineSweep?(intervalMin: number): Promise<import('../fleet-lifecycle').MachineSweepResult>;
  machineUsageToday?(workspaceId: string): Promise<{ day: string; minutes: number }>;
  /** the public announce door (0139): one object, two implementations (store/announce.ts) */
  announcements?: import('./announce').AnnounceStore;
  createTask(task: Task, event: NMEvent): Promise<Task>;
  // Duplicate-create guard (handler createTask): the newest OPEN non-backlog task in the
  // channel whose normalizeTaskTitle(title) matches, created at/after sinceIso — else null.
  // sinceIso NULL = no age bound: an open same-title task is a duplicate however old it is.
  recentDuplicateTask(workspace: string, channel: string, normTitle: string, sinceIso: string | null): Promise<{ number: number; title: string } | null>;
  getTask(id: string): Promise<Task | null>;
  // Ship gate (docs/23): is the release gate armed for this task's project?
  // Defaults ON — a project row without the flag (pre-migration replicas,
  // legacy rows) reads as true; only an explicit false disarms it.
  shipGate(taskId: string): Promise<boolean>;
  // Subtasks (docs/24): live (not done/closed) subtasks — the SUBTASKS_PENDING gate…
  pendingSubtasks(taskId: string): Promise<number>;
  // …and all non-closed subtasks — the ≤8 creation cap.
  subtaskCount(taskId: string): Promise<number>;
  // The shadow-task bounce: an open task by its channel-visible number, or null.
  getTaskByNumber(workspace: string, channel: string, number: number): Promise<{ id: string; number: number; state: TaskState } | null>;
  // Runs fn with the current task, persisting the returned task + events.
  // Serialized per task id — this is what makes claims atomic.
  mutate(id: string, fn: (task: Task) => Promise<MutationResult>): Promise<MutationResult>;
  listEvents(target: string): Promise<NMEvent[]>;
  listArtifacts(taskId: string): Promise<ArtifactRow[]>;
  // Beats (docs/17): the working agent's ordered steps for a phase. declareBeats opens a new
  // run (all pending); advanceBeat updates the task's latest run at seq; listBeats reads them all.
  declareBeats(task: Task, role: string, items: string[]): Promise<{ runId: string }>;
  advanceBeat(taskId: string, seq: number, status: BeatStatus): Promise<void>;
  // acceptance settles the tracker: any beat still 'active' goes done (the enforcement
  // backstop for a flow whose final settle raced its own phase transition — descriptive
  // only, never a gate; pending beats stay pending, they honestly never ran)
  settleBeats(taskId: string): Promise<void>;
  listBeats(taskId: string): Promise<Beat[]>;
  // Runs (docs/29): the durable row behind a stretch of agent work — opened by the agent,
  // stepped live, settled into a terminal state. Never gating; the renderer reads the synced
  // replica, so these exist only to write.
  // `triggerMessageId` turns this into the WAKE LEASE (0114): one host per (agent, trigger) wins
  // and `won: false` tells the rest to stand down BEFORE generating. Shared compute means several
  // member machines host the same agent, so without it each would spin a model on one message.
  openRun(input: RunInput & { triggerMessageId?: string | null; machineId?: string | null }): Promise<{ id: string; won: boolean }>;
  getRun(id: string): Promise<Run | null>;
  stepRun(id: string, patch: { step?: string; done?: number; total?: number }): Promise<void>;
  settleRun(id: string, state: RunSettleState, summary: string | null): Promise<void>;
  /** open runs for a surface — the daemon's boot sweep reads it to settle what a dead host left behind */
  listOpenRuns(workspaceId: string): Promise<Run[]>;
  // Onboarding: workspace + owner membership + #general + default project.
  createWorkspace(input: { name: string; slug: string; createdBy: string }, event: NMEvent): Promise<{ workspaceId: string; channelId: string }>;
  listWorkspaces(userId: string): Promise<Array<{ id: string; name: string; slug: string; role: string; memberCount: number; autoFailover: boolean; activeModelPack: string; commRules: unknown; plan: string; seats: number; subscriptionStatus: string | null; currentPeriodEnd: string | null; primaryMachineId: string | null }>>;
  // Workspace-level settings (provider-auth failover policy + the active model-config pack).
  updateWorkspace(workspaceId: string, patch: { autoFailover?: boolean; activeModelPack?: string; commRules?: { ste100?: boolean; noEmdash?: boolean; custom?: string[] } }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  /** the workspace's stored comm_rules jsonb (null = never configured = defaults) */
  getCommRules(workspace: string): Promise<unknown>;
  // Custom brains (user-authored model packs, docs/10 §14): workspace-scoped named role→model
  // maps. save upserts (create mints `custom:<uuid>`; duplicate name → CONFLICT); delete also
  // resets workspaces.active_model_pack to the 'custom' sentinel when it pointed at the pack —
  // same mutation, so a dangling active id is impossible.
  listModelPacks(workspace: string): Promise<Array<{ id: string; name: string; roles: Record<string, string>; updatedAt: string }>>;
  saveModelPack(input: { workspace: string; packId?: string; name: string; roles: Record<string, string>; createdBy: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  deleteModelPack(workspace: string, packId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  // Billing/plan reads for entitlement gating + the sanctioned plan writer (the Stripe webhook;
  // never client-settable). workspacePlan + activeProjectCount back the Free caps enforced in handler.ts.
  workspacePlan(workspace: string): Promise<string>;
  activeProjectCount(workspace: string): Promise<number>;
  setWorkspacePlan(workspace: string, patch: { plan?: string; seats?: number; subscriptionStatus?: string | null; stripeCustomerId?: string | null; stripeSubscriptionId?: string | null; currentPeriodEnd?: string | null }): Promise<void>;
  // Billing-checkout inputs: the existing Stripe customer (reuse it) + the member count to bill (seats).
  workspaceForBilling(workspace: string): Promise<{ stripeCustomerId: string | null; memberCount: number } | null>;
  // Re-bind every agent to its home-remit channels across all projects (recovery + cross-project).
  syncWorkspaceAgents(workspace: string, makeEvent: (workspace: string) => NMEvent): Promise<{ registered: number }>;
  // Sanctioned purge: owner + sole member only; the events log clears under
  // a transaction-local GUC (the only path that may delete events).
  deleteWorkspace(workspaceId: string, requestedBy: string): Promise<void>;
  // Removes the auth user once no memberships remain.
  deleteAccount(userId: string): Promise<void>;
  // Auth-provider migration: map a Clerk user (JWT sub + email) to a stable
  // internal uuid, creating the mapping on first sign-in.
  resolveClerkUser(clerkId: string, email: string | null): Promise<{ id: string; created: boolean }>;
  // Read-only Clerk id → internal uuid for the /v1 Bearer middleware (the mapping
  // is created by resolveClerkUser at sign-in). null when no account is linked.
  userIdForClerkId(clerkId: string): Promise<string | null>;
  // The reverse: internal uuid → the auth-provider handle + last-known address. Used by
  // accept_invite to re-read the caller's VERIFIED email from Clerk before matching it against
  // an invitation, so the invite id can never stand in for proof of who you are.
  userIdentity(userId: string): Promise<{ clerkUserId: string | null; email: string | null } | null>;
  // The local stack's one human (0138, local-auth.ts): seeded at boot under NM_LOCAL=1 with the
  // sha256 of its `nmh_` bearer (idempotent; a re-seed rotates the hash) and resolved by that hash
  // on the /v1 token lane. schemaVersion is the last migration the runner applied — null where the
  // runner never tracked (the memory store, the test lane) — reported by /.well-known/nm-config.
  seedLocalUser(input: { clerkUserId: string; email: string; tokenHash: string }): Promise<{ id: string }>;
  userIdForLocalTokenHash(hash: string): Promise<string | null>;
  schemaVersion?(): Promise<string | null>;
  // Push devices (mobile companion; control-api-only, never synced to PowerSync).
  // register upserts a device's Expo token; remove drops it on sign-out;
  // devicesForUsers + revokeDeviceToken back the fan-out; humanMemberIds are a
  // workspace's push recipients; recordPushOnce dedupes an event per recipient/window.
  registerDevice(input: { userId: string; platform: 'ios' | 'android'; token: string; deviceName?: string | null; appVersion?: string | null }): Promise<void>;
  removeDevice(userId: string, token: string): Promise<void>;
  devicesForUsers(userIds: string[]): Promise<Array<{ userId: string; token: string; platform: string }>>;
  revokeDeviceToken(token: string): Promise<void>;
  humanMemberIds(workspace: string): Promise<string[]>;
  /** the workspace an agent belongs to — the authz half of the credential lane, where the
   *  caller is an agent rather than a member (see credentials-authz.ts). null when unknown. */
  agentWorkspace(agentId: string): Promise<string | null>;
  recordPushOnce(userId: string, dedupeKey: string, windowMs: number): Promise<boolean>;
  // Writes a PENDING invite row (0092) and returns the raw token for the email. Membership
  // is NOT created here: the invitee signs in through Clerk and answers the invitation. Only
  // workspace owners/admins may invite. See docs/27 §1d for why the old
  // create-a-Supabase-auth-user flow could never work in a Clerk world.
  createInvite(input: { workspace: string; email: string; memberRole: string; invitedBy: string }, event: NMEvent): Promise<{ inviteId: string; token: string; workspaceName: string; inviterName: string; inviterEmail: string }>;
  // Seats in use = members + unexpired pending invites. Counting members alone lets a free
  // workspace issue N invites at 1/3 and land at N+1 members when they all accept.
  workspaceSeatsUsed(workspace: string): Promise<number>;
  // Every pending invite waiting on a VERIFIED email address. READ-ONLY (0113): sign-in used to
  // claim these silently, which meant an already-signed-in user never got one and a stray invite
  // bound an account to a workspace it could not leave. The membership now comes from
  // acceptInvite, so this is what the invitee is shown before they answer.
  pendingInvitesForEmail(email: string): Promise<Array<{
    inviteId: string; workspaceId: string; workspaceName: string; role: string;
    inviterEmail: string | null; inviterName: string | null; createdAt: string; expiresAt: string;
  }>>;
  // Answer an invitation. The caller MUST have re-verified that `email` is the caller's own
  // verified address with the auth provider — the invite id is a handle, never an authorisation.
  // Re-checks the seat cap: an invite can sit pending for 14 days while the workspace fills.
  acceptInvite(inviteId: string, userId: string, email: string): Promise<{
    workspaceId: string; workspaceName: string; role: string; inviterEmail: string | null; seatsUsed: number; plan: string;
  }>;
  // Decline. Frees the address (the unique index is partial on status='pending'), so a re-invite
  // is a normal act rather than a constraint violation.
  declineInvite(inviteId: string, email: string): Promise<boolean>;
  pendingInvites(workspace: string): Promise<Array<{ id: string; email: string; role: string; expiresAt: string; createdAt: string }>>;
  revokeInvite(inviteId: string, workspace: string): Promise<boolean>;
  inviteByToken(tokenHash: string): Promise<{ id: string; workspaceId: string; workspaceName: string; email: string; role: string } | null>;
  // Membership exits (0113). Both refuse to strand a workspace: the owner may not leave, and
  // nobody may remove the owner. `leaveWorkspace` is what finally makes the long-standing
  // "they must leave first" / "delete or leave your workspaces first" messages true.
  leaveWorkspace(workspaceId: string, userId: string): Promise<void>;
  removeMember(workspaceId: string, targetUserId: string, requestedBy: string): Promise<void>;

  // ── email outbox (0091) ─────────────────────────────────────────────────
  // Insert-if-absent on the UNIQUE dedupe_key. Returns null when the key already exists —
  // that duplicate-key rejection IS the exactly-once guarantee, not an error path.
  enqueueEmail(input: {
    workspace?: string | null; userId?: string | null; toEmail: string; template: string;
    kind: 'transactional' | 'lifecycle' | 'broadcast'; subject: string; dedupeKey: string;
    payload?: unknown; scheduledAt?: string | null;
  }): Promise<{ id: string } | null>;
  markEmail(id: string, patch: { status: 'sent' | 'failed' | 'skipped'; providerId?: string | null; error?: string | null }): Promise<void>;
  /** Candidates for the lifecycle pass. The query carries every fact `dueFor` needs so the
   *  decision stays pure and testable; see lifecycle.ts. */
  lifecycleCandidates(limit: number): Promise<LifecycleRow[]>;
  /** Marketing opt-out / hard bounce. Transactional mail ignores this. */
  emailSuppressed(userId: string): Promise<boolean>;
  setUnsubscribed(userId: string): Promise<void>;
  markEmailBounced(toEmail: string, complaint: boolean): Promise<void>;
  // Memory view: the channel block + facts (valid first, recent superseded).
  // kind distinguishes lessons (review corrections) from plain facts; taskNumber
  // carries a lesson's provenance when it was recorded against a task.
  channelMemory(workspace: string, channel: string): Promise<{
    block: { content: string; basisCount: number; updatedAt: string } | null;
    facts: Array<{ id: string; content: string; kind: string; taskNumber: number | null; validFrom: string; validUntil: string | null; supersededBy: string | null }>;
  }>;
  // Hybrid recall over channel messages (FTS + vector legs, RRF-fused).
  recall(workspace: string, channel: string | null, query: string, k: number): Promise<Array<{ id: string; kind: 'fact' | 'message'; body: string; channel: string; createdAt: string; score: number }>>;
  // Fact store: reconcile a candidate fact against valid facts in the channel
  // — ADD new, UPDATE (invalidate + supersede) on contradiction, NOOP on dup.
  // Reconcile is kind-scoped: a lesson never supersedes a decision-fact.
  upsertFact(
    input: { workspace: string; channel: string; content: string; basisCount: number; kind?: 'fact' | 'lesson'; taskId?: string | null },
    makeEvent: (decision: string) => NMEvent,
  ): Promise<{ decision: 'add' | 'update' | 'noop'; factId: string }>;
  // Curation: close a fact's validity (valid_until = now; the row + provenance
  // stay queryable). No successor unless supersededBy names one — the UI's
  // correct-a-lesson flow passes the replacement when the reconcile missed it.
  // Idempotent: an already-retired fact returns retired=false, appends no event.
  retireFact(factId: string, supersededBy: string | null, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; retired: boolean }>;
  // Memory spine: upsert the channel's summary block (docs/03 §6).
  refreshMemoryBlock(input: { workspace: string; channel: string; kind: string; content: string; basisCount: number }, event: NMEvent): Promise<{ id: string }>;
  // Channel library curation: marks the artifact promoted (docs/03 §7).
  // The event factory receives the workspace the artifact belongs to.
  promoteArtifact(artifactId: string, promotedByAgent: string | null, makeEvent: (workspace: string) => NMEvent): Promise<{ workspace: string }>;
  /** kind + name — what `isGateArtifact` judges before a delete is allowed (2026-08-18) */
  artifactById(artifactId: string): Promise<{ id: string; kind: string; name: string; taskId: string | null } | null>;
  deleteArtifact(artifactId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ workspace: string }>;
  // decisions: nmq cards the message body carries, extracted by the route — inserted in the
  // same transaction. A new card supersedes (dismisses) an older OPEN card with the same
  // question in the same channel/thread, so re-emitted cards (plan re-review rounds) never
  // pile up as stale "needs you" entries.
  postMessage(msg: NMMessage, event: NMEvent, decisions?: DecisionSeed[]): Promise<NMMessage>;
  /** the automation that opened this thread, when a routine did (0119) — null for human threads */
  getThreadScheduleId(workspace: string, threadId: string): Promise<string | null>;
  /** the room's setup task id (docs/39) — null when the kind has no flow or none was planted */
  getSetupTaskId(channelId: string): Promise<string | null>;
  // Conversation threads: refine the heuristic title/description (thread.update — human or
  // orchestrator), and link the task a conversation fanned out into (threads.task_id; only
  // an unlinked thread links, so a second task born in the same room can't steal it).
  /** agentTitleOnce: refuse an agent title change once titled_at is stamped (humans always may) */
  updateThread(workspace: string, threadId: string, patch: { title?: string; description?: string }, opts?: { agentTitleOnce?: boolean }): Promise<void>;
  // Pre-birth a titled conversation thread (marketing bootstrap): the first message then
  // lands on the existing row, so the title never flashes the raw-message heuristic.
  createThread(workspace: string, channelId: string, threadId: string, title: string, description: string, createdBy: string): Promise<void>;
  linkThreadTask(workspace: string, threadId: string, taskId: string): Promise<void>;
  // docs/34: the conversation's mode. `getThreadMode` is the server floor's read — task.create
  // naming a chat thread is rejected — and returns null for a thread that doesn't exist (a
  // stale id must not be mistaken for a chat). `setThreadMode` is the human-only escalation
  // valve behind thread.set_mode.
  getThreadMode(workspace: string, threadId: string): Promise<ThreadMode | null>;
  setThreadMode(workspace: string, threadId: string, mode: ThreadMode): Promise<void>;
  /** Compute choice (0118): replace the ACTOR's own compute prefs. Validates every named
   *  machine/agent id against the workspace — a pref naming a foreign machine must 404 at set
   *  time, not silently mis-route at claim time. */
  setThreadMachine(workspace: string, threadId: string, machineId: string | null): Promise<void>;
  setMemberCompute(workspace: string, userId: string, prefs: { machine?: string | null; agents?: Record<string, string>; shares?: string[]; desktopSessions?: 'here' | 'auto' }): Promise<void>;
  /** Lend/revoke ONE member; the server expands any '*' against the real roster. */
  shareCompute(workspace: string, userId: string, member: string, on: boolean): Promise<void>;
  /** undefined = no such thread; null = a chat thread; a string = the task it belongs to. */
  threadTaskId(workspace: string, threadId: string): Promise<string | null | undefined>;
  setThreadArchived(workspace: string, threadId: string, archived: boolean): Promise<void>;
  /** Settle (0137): stamp or clear threads.settled_at. The stamp never touches updated_at, so a settled thread does not jump to the top of a recency list. */
  setThreadSettled(workspace: string, threadId: string, settled: boolean): Promise<void>;
  /**
   * The human's word (2026-09-08): the newest HUMAN message in a task's thread that is newer than the
   * review verdict (approved_at, else the task's last change). Null when nobody spoke since. This is the
   * evidence an agent accept is refused without: the agent judges what the words meant, the server
   * proves a person said something after the verdict, in this thread.
   */
  latestHumanWord(taskId: string): Promise<{ id: string; createdAt: string } | null>;
  // Auto-filing (0109). `threadFiling` is what the gate reads (canFileConversation, shared/filing);
  // `moveThread` performs it — the thread AND its messages, in one transaction, because a message
  // left behind in the old room is a conversation split across two rooms' surfaces.
  threadFiling(workspace: string, threadId: string): Promise<{ taskId: string | null; filedAt: string | null; channelId: string; projectId: string | null } | null>;
  channelProject(workspace: string, channelId: string): Promise<{ projectId: string | null; slug: string } | null>;
  /** `stamp` records the agent's one move; a human's correction leaves `filed_at` untouched. */
  moveThread(workspace: string, threadId: string, channelId: string, reason: string | null, stamp: boolean): Promise<void>;
  /** docs/10 §15 — the thread's brain override (role → model). Null clears it entirely. */
  setThreadBrain(workspace: string, threadId: string, override: BrainOverride | null): Promise<void>;
  // Decisions (docs/12 slice 2): flip open → answered/dismissed exactly once (first writer
  // wins — the losing machine gets CONFLICT). NOT_FOUND when the id doesn't exist.
  answerDecision(
    id: string,
    input: { status: 'answered' | 'dismissed'; answer: string | null; by: ActorRef },
    makeEvent: (workspace: string) => NMEvent,
    resolveTaskMutation?: (decision: { taskId: string | null; question: string; options: DecisionRow['options'] }) => ((task: Task) => MutationResult) | null,
  ): Promise<{ id: string; taskId: string | null; question: string; options: DecisionRow['options'] }>;
  listDecisions(workspace: string): Promise<DecisionRow[]>;
  // Agent permission policies (Phase 1): humans upsert/delete allow/ask/deny rules; the
  // daemon lists them to gate tool calls. setPolicy upserts by id (absent id = insert).
  setPolicy(input: PolicyInput, event: NMEvent): Promise<{ id: string }>;
  deletePolicy(policyId: string, event: NMEvent): Promise<{ id: string }>;
  listPolicies(workspace: string): Promise<PolicyRow[]>;
  // Chat attachment: idempotent insert linked to a message; enforces per-plan caps in-transaction.
  createAttachment(input: AttachmentInput, limits: { maxPerMessage: number; maxBytes: number }): Promise<{ id: string }>;
  pinMessage(messageId: string, pinned: boolean): Promise<{ id: string }>;
  /** rewrite a card message's body in place — author-only, guarded to card bodies (reply-radar) */
  reviseCardMessage(messageId: string, body: string, actor: { kind: string; id: string }): Promise<{ id: string }>;
  // Upsert by (workspace, name); event persisted only on first registration.
  registerMachine(input: {
    workspace: string;
    name: string;
    platform: string;
    daemonVersion: string;
    ownerId: string;
    transfer?: boolean;
    /** what this host can serve right now (0114) — published so OTHER machines can tell
     *  "the origin is busy" from "the origin can never run this" */
    runtimes?: string[];
  }, event: NMEvent): Promise<{ id: string; inserted: boolean }>;
  heartbeatMachine(machineId: string, activity?: { activeSeconds: number; busy: boolean; runtimes?: string[] }): Promise<void>;
  // Upsert by (workspace, name); registers channel scope. Event on first insert.
  registerAgent(input: {
    workspace: string;
    machineId: string;
    name: string;
    role: string;
    model: string;
    runtime: string;
    emoji?: string;
    description?: string; // routing signal (0110): what it does + when to route here, ≤280
    brief?: string; // instructions; a briefless re-register keeps the stored one (as does a descriptionless one)
    channels: string[];
  }, event: NMEvent): Promise<{ id: string; inserted: boolean }>;
  // Edit a registered agent's model/runtime/name/description/instructions (role is immutable).
  // Refreshes its A2A card. '' on either string clears it to null; undefined leaves it alone.
  updateAgent(agentId: string, patch: { model?: string; runtime?: string; name?: string; description?: string; brief?: string; modelSource?: 'pack' | 'manual' }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  // Soft-retire an agent: stamps retired_at + status offline, keeps the row (and all
  // event/task attribution) for derived history. Refuses (CONFLICT) while the agent is
  // assignee/offeree of open work. Idempotent — no second event. Register-same-name rehires.
  retireAgent(agentId: string, makeEvent: (workspace: string, name: string, role: string) => NMEvent): Promise<{ id: string; name: string; alreadyRetired: boolean }>;
  // A member edits their OWN display name (shown on their messages + in people lists).
  // Scoped to (workspace, userId) — callers pass actor.id as userId, so it's self-only.
  updateMemberProfile(workspace: string, userId: string, displayName: string): Promise<void>;
  // Offer resolution: agent name -> id, validated against channel registration.
  resolveOffer(workspace: string, channel: string, agentName: string): Promise<string>;
  // The agent's stored A2A 1.0 Agent Card (discovery), or null. Public read.
  getAgentCard(agentId: string): Promise<unknown | null>;
  // Consume an external A2A agent: upsert it as a 'remote' agent (machine_id null,
  // endpoint_url, fetched card) registered to channels. Event on first connect.
  connectRemoteAgent(input: { workspace: string; channels: string[]; name: string; role: string; endpointUrl: string; card: unknown }, event: NMEvent): Promise<{ id: string }>;
  // Offer an EXISTING todo task (intake threads resolve, then offer); the
  // resolution may bind a repo the task was created without.
  offerTask(
    taskId: string,
    agentName: string,
    repo: { id: string; baseRef: string } | null,
    checklist: string[] | null,
    dod: string | null,
    // work-type label to stamp at offer (docs/16) — null keeps whatever the task already carries
    kind: TaskKind | null,
    event: (agentId: string) => NMEvent,
  ): Promise<{ offeredAgentId: string }>;
  setAgentStatus(agentId: string, status: string): Promise<void>;
  // Agent Skills: reusable named procedures (docs/decisions 2026-06-13).
  // channel === null => global/workspace scope.
  createSkill(input: { workspace: string; channel: string | null; name: string; description: string; scope: string; body: string; author: ActorRef; packId?: string | null; enabled?: boolean }, event: NMEvent): Promise<{ id: string }>;
  updateSkill(skillId: string, patch: { description?: string; body?: string; scope?: string }, event: NMEvent): Promise<{ id: string }>;
  deprecateSkill(skillId: string, event: NMEvent): Promise<{ id: string }>;
  // agent self-learning: propose a draft (dedups onto an existing same-scope
  // draft); promote a draft to active (supersedes a same-name active skill).
  proposeSkill(input: { workspace: string; channel: string | null; name: string; description: string; scope: string; body: string; author: ActorRef }, event: NMEvent): Promise<{ id: string; updated: boolean }>;
  promoteSkill(skillId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; superseded: string | null }>;
  setSkillEnabled(skillId: string, enabled: boolean, event: NMEvent): Promise<{ id: string }>;
  // Skill packs: a versioned bundle of skills (bundled defaults or imported).
  createSkillPack(input: { workspace: string; channel: string; name: string; description: string; sourceUrl: string; sourceRef: string; origin: string; author: ActorRef }, event: NMEvent): Promise<{ id: string }>;
  commitSkillPack(packId: string, input: { version: string; skills: Array<{ name: string; description: string; body: string }> }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; count: number }>;
  updateSkillPack(packId: string, patch: { status?: string; step?: string; progress?: number; error?: string; description?: string }, event: NMEvent): Promise<{ id: string }>;
  setSkillPackEnabled(packId: string, enabled: boolean, event: NMEvent): Promise<{ id: string }>;
  removeSkillPack(packId: string, event: NMEvent): Promise<{ id: string }>;
  // idempotently seed the bundled default packs (gstack + addyosmani) into a
  // channel — used to backfill existing #dev channels (creation seeds inline).
  seedDefaultPacks(workspace: string, channel: string, event: NMEvent, kind?: 'build' | 'marketing'): Promise<{ added: number; refreshed: number }>;
  // Register a GitHub repo to the workspace so tasks can bind + push to it
  // (idempotent on workspace+provider+org+name); attaches to the channel's
  // default project. Metadata only — no tokens. Event persisted on first link.
  linkRepo(input: { workspace: string; channel: string | null; project: string | null; provider: string; orgName: string; name: string; defaultBranch: string; cloneUrl: string | null; localPath: string | null }, event: NMEvent): Promise<{ id: string; inserted: boolean }>;
  // Projects (the work axis): workspace-scoped, they OWN channels (1:N). create
  // resolves a workspace-unique slug, optionally moves `channels` (ids) into the
  // new project, and creates fresh `newChannels` (slugs) in it; assignChannel
  // moves one channel between projects.
  createProject(input: { workspace: string; name: string; slug: string; description: string; website?: string; logoUrl?: string; channels: string[]; newChannels?: string[] }, event: NMEvent): Promise<{ id: string; slug: string }>;
  // website/logoUrl: '' clears the stored value, undefined keeps it (per-column patch)
  updateProject(projectId: string, patch: { name?: string; description?: string; website?: string; logoUrl?: string; autoOpenPr?: boolean; runCiBeforeMerge?: boolean; shipGate?: boolean; modelPack?: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  assignChannel(channelId: string, projectId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  // archived=true cannot target the workspace default; its channels move back to the default.
  archiveProject(projectId: string, archived: boolean, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  // permanently delete an archived project + everything in it (irreversible)
  deleteProject(projectId: string, requestedBy: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  // Channels (rooms): CRUD within a project. slug is unique PER PROJECT; since a
  // channel is identified by its id (not slug), rename (slug/topic) is safe.
  // createdBy* is the room's papertrail attribution (0093) — optional so callers that
  // predate it still compile; a null actor renders the trail line without a name.
  createChannel(input: { workspace: string; projectId: string; slug: string; topic: string; createdByKind?: string; createdBy?: string }, event: NMEvent): Promise<{ id: string; slug: string }>;
  renameChannel(channelId: string, patch: { slug?: string; topic?: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; slug: string }>;
  // set a room's threads view mode ('on' | 'off') — a per-channel lens, not a reroute.
  setChannelThreadMode(channelId: string, mode: 'on' | 'off', makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  setChannelKind(channelId: string, kind: 'build' | 'marketing', makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  setChannelMarketing(channelId: string, profile: { website: string | null; focus: string[]; goal?: string; bootstrap_thread_id?: string; setup_by: string; setup_at: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; workspace: string }>;
  // one answered setup-flow step (setupflows.ts), merged into the profile as it lands — the
  // per-step write that makes an abandoned wizard a pause instead of a loss
  setChannelSetupStep(channelId: string, input: { flowId: string; stepId: string; patch: Record<string, unknown> }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; workspace: string }>;
  // release-day backfill: a setup task for every existing flow-bearing room left untouched
  backfillSetupTasks(workspace: string): Promise<number>;
  // flip one MCP integration toggle on the room's marketing profile (marketing.mcp.<provider>)
  setMarketingIntegration(channelId: string, provider: string, enabled: boolean, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  channelWorkspace(channelId: string): Promise<{ workspace: string }>;
  // schedules (marketing-channel plan §4.6) — the generic "run X at time T" primitive
  createSchedule(input: ScheduleInput, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  setScheduleStatus(scheduleId: string, status: 'active' | 'paused', makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  updateSchedule(scheduleId: string, patch: { title: string; prompt: string; cadence: string; atTime: string; tz: string; weekday: number | null; nextRunAt: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  deleteSchedule(scheduleId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  claimScheduleRun(scheduleId: string, runCount: number, nextRunAt: string | null, makeEvent: (workspace: string) => NMEvent): Promise<{ claimed: boolean }>;
  /** The fire's outcome, written by the daemon that ran (or could not run) it: a string lands in
   * `schedules.last_error` — the synced truth the attention bar renders — and `null` clears it.
   * The column existed since 0082 with no writer, which is why a failing routine was invisible. */
  markScheduleResult(scheduleId: string, error: string | null, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  /** The release routine's cursor and ledger line, merged into `payload.release` through the shared
   * `mergeReleaseCursor` (one derivation for both stores). INVALID_INPUT on a row that carries no
   * `release` payload: a plain routine has no cursor to move. */
  setScheduleCursor(scheduleId: string, cursor: { at: string; tag: string | null }, log: { at: string; key: string | null; note: string } | null, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  // content items (marketing-channel plan §4.7) — agents draft, humans publish
  createContentItem(input: { channelId: string; taskId?: string | null; threadId?: string | null; platform: string; body: string; scheduleId: string | null; slotAt?: string | null; mediaUrl?: string | null; imageBrief?: string | null; script?: string | null; thumb?: string | null; imageError?: string | null; createdByKind: string; createdBy: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  setContentStatus(itemId: string, patch: { status: 'draft' | 'scheduled'; scheduledAt: string | null; approvedBy: string | null; keepSlot?: boolean }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  updateContentBody(itemId: string, body: string, mediaUrl: string | null | undefined, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  /** the marketer revises its OWN unpublished draft (§4.5) — body/imageBrief/thumb; DRAFT status only */
  reviseDraft(itemId: string, patch: { body: string | null; imageBrief: string | null; script?: string | null; thumb: string | null; imageError?: string | null; videoError?: string | null }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  deleteContentItem(itemId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  /** host a draft's image bytes (0090) and point content_items.media.image_id at them — the
   *  only way a locally generated picture can ever reach a network that fetches URLs */
  attachContentMedia(itemId: string, mime: string, bytes: Buffer, actor: { kind: string; id: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  /** the public /media/:id route's read — bytes only, gated by mediaSig upstream */
  contentMediaBytes(mediaId: string): Promise<{ mime: string; bytes: Buffer; workspace: string } | null>;
  // a plain channel artifact (no task) — the conversational bootstrap's doc drops
  createChannelArtifact(input: { channelId: string; kind: string; name: string; inlineContent: string; mime: string | null; tags?: string[]; createdByKind: string; createdBy: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  // Whiteboards (docs/38). createWhiteboard is idempotent on id (the desktop's local-first PUT
  // replays; a replay returns the existing row's id and writes NO second event). The two update
  // paths differ on purpose: patchWhiteboardLww is the autosave lane — highest rev wins, stale
  // writes are ACKed as applied:false (a throwing autosave wedges the upload queue behind it);
  // updateWhiteboard is the command lane — stale baseRev throws WHITEBOARD_STALE so an agent
  // re-reads and reapplies instead of clobbering.
  createWhiteboard(input: WhiteboardCreate, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; workspace: string }>;
  patchWhiteboardLww(input: WhiteboardLwwPatch): Promise<{ applied: boolean }>;
  updateWhiteboard(input: WhiteboardUpdate, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; rev: number }>;
  getWhiteboard(id: string): Promise<WhiteboardRow | null>;
  listWhiteboards(q: { workspace?: string; channel?: string; includeArchived?: boolean; limit?: number }): Promise<WhiteboardMeta[]>;
  // connectors + the publish pass (marketing-channel plan §4.8) — secrets stay server-side
  upsertConnector(input: { workspace: string; channelId: string | null; provider: string; handle: string; connectedBy: string; scopes: string }): Promise<{ id: string }>;
  setConnectorSecret(connectorId: string, ciphertext: string): Promise<void>;
  connectorWithSecret(workspace: string, provider: string, channelId?: string | null): Promise<{ id: string; status: string; handle: string; ciphertext: string | null } | null>;
  /** The provider refused to renew the stored grant (refresh token revoked/expired/spent):
   * flip the synced status to 'revoked' so every surface says reconnect — but KEEP the sealed
   * secret, unlike the human's `revokeConnector`; a server-side verdict must not destroy data. */
  markConnectorReauth(connectorId: string): Promise<void>;
  revokeConnector(connectorId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  // imageIntended: the post was MEANT to carry an image (a brief was written, a preview was
  // generated, or generation errored) — so the publish pass can refuse to send it text-only if the
  // picture isn't attached yet, instead of quietly dropping the image.
  dueContentItems(nowIso: string, limit: number): Promise<Array<{ id: string; workspace: string; channel: string; platform: string; body: string; mediaUrl?: string | null; mediaId?: string | null; imageIntended: boolean }>>;
  /** scheduled items landing between two moments — the review reminder's read. Deliberately not
   *  dueContentItems: that one is "past due, publish it", this one is "coming, tell somebody". */
  upcomingContentItems(fromIso: string, toIso: string, limit: number): Promise<Array<{ id: string; workspace: string; channel: string; threadId: string | null; platform: string; body: string; scheduledAt: string }>>;
  /** the TikTok media proxy's lookup — platform + media only, nothing publishable leaks */
  contentItemMedia(itemId: string): Promise<{ platform: string; mediaUrl: string | null; mediaId?: string | null; workspace: string } | null>;
  markContentPublished(itemId: string, url: string, publishedAtIso: string): Promise<void>;
  markContentFailed(itemId: string, error: string): Promise<void>;
  // permanently delete a channel + everything in it (messages/tasks/history). irreversible.
  deleteChannel(channelId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }>;
  // add / remove an agent's membership in a channel. agent + channel accept id-or-name/slug.
  // add rebuilds the agent's A2A card so the new channel flows into discovery.
  // `by` stamps who brought the agent in (0093) — read back by the room's papertrail.
  addAgentToChannel(workspace: string, channel: string, agent: string, makeEvent: (workspace: string) => NMEvent, by?: { kind: string; id: string }): Promise<{ agentId: string; channelId: string }>;
  removeAgentFromChannel(workspace: string, channel: string, agent: string, makeEvent: (workspace: string) => NMEvent, by?: { kind: string; id: string }): Promise<{ agentId: string; channelId: string }>;
  // channel people roster (0094) — the human half of the same idea. `person` is an nm_users id.
  addPersonToChannel(workspace: string, channel: string, person: string, makeEvent: (workspace: string) => NMEvent, by?: string | null): Promise<{ userId: string; channelId: string }>;
  removePersonFromChannel(workspace: string, channel: string, person: string, makeEvent: (workspace: string) => NMEvent, by?: string | null): Promise<{ userId: string; channelId: string }>;
  // Tokens are server-side only: never synced, never returned unmasked to UIs.
  setCredential(input: {
    workspace: string;
    provider: string;
    scope: 'workspace' | 'agent';
    agentId: string | null;
    token: string | null;
    authMode: 'apikey' | 'subscription';
    setBy: string;
  }, event: NMEvent): Promise<void>;
  // Always resolves (so the daemon gets the workspace failover policy even when no credential
  // row exists): token/authMode are null when unset; autoFailover is the workspace policy.
  resolveCredential(workspace: string, provider: string, agentId: string | null): Promise<{ token: string | null; authMode: 'apikey' | 'subscription' | null; source: string; autoFailover: boolean }>;
  listCredentials(workspace: string): Promise<Array<{ provider: string; scope: string; agentId: string | null; authMode: 'apikey' | 'subscription'; last4: string | null; updatedAt: string }>>;
  // The providers configured at the workspace scope (presence-of-row, incl. tokenless subscriptions)
  // — the single predicate the pack-activation gate uses.
  enabledProviders(workspace: string): Promise<Set<string>>;
  // Desktop sign-in handoff (device-code style; fixes prod Clerk OAuth — the 127.0.0.1
  // loopback can't complete it). The desktop opens a pending rendezvous (start), the trusted
  // neuramesh.app page fills in the verified nm session (complete), and the desktop polls —
  // authenticated by poll_secret — to claim it (claim). control-api-only; never synced.
  startDesktopAuth(input: { nonce: string; pollSecretHash: string; ttlSeconds: number }): Promise<void>;
  completeDesktopAuth(nonce: string, result: DesktopAuthResult): Promise<{ ok: boolean }>;
  claimDesktopAuth(nonce: string, pollSecretHash: string): Promise<{ status: 'pending' | 'done' | 'gone'; result?: DesktopAuthResult }>;
}
