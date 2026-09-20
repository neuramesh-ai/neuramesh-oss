import { z } from 'zod';
import { TASK_KINDS } from './states';
import { WORK_PLAN_LEGS } from './task';
import { DESIGN_PROVIDERS } from './design';
import { SHIP_ITEM_OWNERS, SHIP_ITEM_STATES } from './task';
import { CODE_SESSION_COMMANDS } from './commands-code';
import { AGENT_ROLES } from './states';

// The human-sendable board commands. These live in @neuramesh/shared (not in the
// server package) so every human client — desktop, and now mobile/web — types its
// command payloads against the SAME schemas the control-api validates. The server
// composes these into its full CommandSchema alongside its agent/daemon/admin-only
// commands (packages/control-api/src/commands.ts); a mobile client builds
// HumanCommandSchema from exactly this set. Agent/daemon commands (claim, submit,
// propose_plan/design, register, memory, skills, project/channel admin) stay
// server-side — a phone never sends them.

const taskId = z.string().min(1);

// Create a task — the ONE creation path (backlog:true parks an idea; otherwise it
// lands in todo). Open to every actor, so it's shared, not human-only.
export const taskCreateCommand = z.object({
  type: z.literal('task.create'),
  workspace: z.string().min(1),
  channel: z.string().min(1),
  project: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().default(''),
  repo: z.object({ id: z.string().min(1), baseRef: z.string().min(1).default('main') }).optional(),
  offerTo: z.string().min(1).optional(),
  // parked idea: lands in the backlog column instead of todo (docs/15). Promotion
  // into todo stays human/orchestrator-only; a backlog item can't be born offered.
  backlog: z.boolean().default(false),
  checklist: z.array(z.string().min(1)).optional(),
  definitionOfDone: z.string().max(20_000).optional(),
  // a marketing playbook run (docs/design/marketing-os-2026-08, round 3 — George): the plan is
  // a CANNED registry template the human's own ask selected, not an architect's reviewed
  // markdown, so a non-repo playbook unit is born APPROVED (the routine stamps) and starts
  // immediately. Repo-backed work ignores this — code keeps every gate.
  playbook: z.string().min(1).max(40).optional(),
  // work-type label (docs/16). The handler requires it only when creating an already-offered
  // task (offerTo present = routing); a bare/backlog task may omit it. Never a route gate.
  kind: z.enum(TASK_KINDS).optional(),
  // subtask (docs/24): create this as companion work UNDER that parent task —
  // same channel, one level deep, ≤8 per parent, no repo of its own (it rides
  // the parent's), no kind required. Open to every actor, like task.create itself.
  parent: z.string().min(1).optional(),
  // the conversation this task was fanned out OF: links threads.task_id so the chat
  // thread upgrades into the task's thread in place (conversation-first shell).
  thread: z.string().uuid().optional(),
  // ── Plan-first units (2026-08-17) ──
  // The implementation plan proposed WITH the create: the unit is born in plan_review carrying
  // it, and the HUMAN approves in the unit's thread before any work starts. legs = the declared
  // journey (validateWorkPlanLegs floors review for repo-backed work); subtasks = proposed
  // companion work, minted as real subtask rows on approval; approach = the plan prose the
  // human reads. Ignored for backlog parks and subtasks (their parent's gates cover them).
  plan: z
    .object({
      legs: z.array(z.enum(WORK_PLAN_LEGS)).min(1).max(3),
      subtasks: z.array(z.string().min(1).max(200)).max(8).default([]),
      approach: z.string().min(1).max(60_000),
    })
    .optional(),
  // Thread-owned work (2026-08-17): the conversation that OWNS this unit — sets
  // tasks.origin_thread_id and posts the ‹task:id› unit card into that thread. Unlike `thread`
  // (the legacy 1:1 upgrade that CONSUMES the conversation), many units share one origin.
  originThread: z.string().uuid().optional(),
});

// The human gates + edits (the whole point of the mobile companion).
export const taskAcceptCommand = z.object({ type: z.literal('task.accept'), taskId });
export const taskApproveCommand = z.object({ type: z.literal('task.approve'), taskId });
export const taskRequestChangesCommand = z.object({ type: z.literal('task.request_changes'), taskId, feedback: z.string().min(1) });
export const taskCancelCommand = z.object({ type: z.literal('task.cancel'), taskId });
export const taskBlockCommand = z.object({ type: z.literal('task.block'), taskId, reason: z.string().min(1) });
export const taskUnblockCommand = z.object({ type: z.literal('task.unblock'), taskId });
export const taskArchiveCommand = z.object({ type: z.literal('task.archive'), taskId });
// Backlog: promote releases a parked idea into todo (human/orchestrator only, enforced by the FSM).
export const taskPromoteCommand = z.object({ type: z.literal('task.promote'), taskId });
// Reopen: the one edge out of `closed` (2026-08-11). HUMAN ONLY in the FSM — an agent that could
// reopen its own cancelled work would make "closed" a suggestion — and it lands in `todo`.
export const taskReopenCommand = z.object({ type: z.literal('task.reopen'), taskId });
// Pre-work scratch edit: title/description mutable while backlog/todo.
export const taskUpdateDetailsCommand = z.object({
  type: z.literal('task.update_details'),
  taskId,
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(20_000).optional(),
  // work-type label (docs/16) — a pre-work scratch edit may (re)categorize the task.
  kind: z.enum(TASK_KINDS).optional(),
});
// The editable acceptance contract the reviewer gates on.
export const taskSetDefinitionOfDoneCommand = z.object({ type: z.literal('task.set_definition_of_done'), taskId, dod: z.string().max(20_000) });
// Plan gate: request routes into planning; revise bounces plan_review back. (propose_plan is the architect's — server-side.)
export const taskRequestPlanCommand = z.object({ type: z.literal('task.request_plan'), taskId, architect: z.string().min(1).optional(), kind: z.enum(TASK_KINDS).optional() });
export const taskRevisePlanCommand = z.object({ type: z.literal('task.revise_plan'), taskId, feedback: z.string().min(1) });
// Design gate: request routes user-facing work to the designer; revise bounces design_review;
// approve_design is the HUMAN sign-off (enforced) that releases into planning. (propose_design is the designer's.)
export const taskRequestDesignCommand = z.object({
  type: z.literal('task.request_design'),
  taskId,
  designer: z.string().min(1).optional(),
  kind: z.enum(TASK_KINDS).optional(),
  // Iris always owns the workflow. Omit this unless the human already chose a
  // mockup engine; Iris asks after pickup when it is absent.
  provider: z.enum(DESIGN_PROVIDERS).optional(),
});
export const taskSelectDesignProviderCommand = z.object({
  type: z.literal('task.select_design_provider'),
  taskId,
  provider: z.enum(DESIGN_PROVIDERS),
});
export const taskReviseDesignCommand = z.object({ type: z.literal('task.revise_design'), taskId, feedback: z.string().min(1) });
export const taskApproveDesignCommand = z.object({ type: z.literal('task.approve_design'), taskId });
// approve_plan is the HUMAN sign-off on a plan-first unit (docs/41) — not a transition: it unlocks
// the edge out of plan_review. Mirrored for the phone's needs-you card (the mobile-cloud round, S3).
export const taskApprovePlanCommand = z.object({ type: z.literal('task.approve_plan'), taskId });
/** the human sign-offs that are NOT transitions, so the FSM table cannot say who may fire them: the
 *  handler refuses every other actor (HUMAN_ONLY), and a surface that wears a human-only badge reads
 *  this list beside the table (renderer review.ts humanOnly) */
export const HUMAN_ONLY_SIGN_OFFS: readonly string[] = ['task.approve_plan'];
// Ship gate (docs/23): approve_ship_plan is the HUMAN sign-off that releases the
// checklist for execution; revise bounces the plan back to the shipper with
// feedback; check ticks a checklist item (the handler enforces who may tick
// what — an agent can never tick a human item); add appends a late-found step.
// (claim_ship / propose_ship_plan / execute_ship are the shipper's — server-side.)
export const taskApproveShipPlanCommand = z.object({ type: z.literal('task.approve_ship_plan'), taskId });
export const taskReviseShipPlanCommand = z.object({ type: z.literal('task.revise_ship_plan'), taskId, feedback: z.string().min(1) });
export const taskCheckShipItemCommand = z.object({
  type: z.literal('task.check_ship_item'),
  taskId,
  itemId: z.string().min(1).max(40),
  state: z.enum(SHIP_ITEM_STATES),
  note: z.string().max(500).optional(),
});
// Subtasks (docs/24): finish closes a subtask as DONE — the assignee when its
// work lands (artifacts attach to the PARENT so review/ship see one evidence
// set), or any human as the boss check-off (works straight from todo; no
// subtask can become a blocker). Parents never finish — they pass review.
export const taskFinishSubtaskCommand = z.object({
  type: z.literal('task.finish_subtask'),
  taskId,
  note: z.string().max(2000).optional(),
  artifacts: z
    .array(z.object({ kind: z.string().min(1).max(20), name: z.string().min(1).max(160), content: z.string().max(400_000).optional() }))
    .max(12)
    .optional(),
});

export const taskAddShipItemCommand = z.object({
  type: z.literal('task.add_ship_item'),
  taskId,
  title: z.string().min(1).max(300),
  detail: z.string().max(2000).optional(),
  owner: z.enum(SHIP_ITEM_OWNERS).default('human'),
  agentId: z.string().min(1).optional(),
});
// Pin/unpin a message.
export const messagePinCommand = z.object({ type: z.literal('message.pin'), message: z.string().min(1), pinned: z.boolean() });
// Decisions (docs/12 slice 2): flip an agent's nmq question card to answered/dismissed —
// the authoritative state Mission Control renders. Human-only (enforced in the handler):
// you're the tiebreaker. Answering a card ALSO posts the `**question** → answer` reply
// (the behavioral consumer agents actually watch); this command is the bookkeeping flip,
// exactly-once — a second answer from another machine gets CONFLICT and stands down.
export const decisionAnswerCommand = z.object({ type: z.literal('decision.answer'), decisionId: z.string().min(1), answer: z.string().min(1).max(2000) });
export const decisionDismissCommand = z.object({ type: z.literal('decision.dismiss'), decisionId: z.string().min(1) });

// ── The commands a PHONE sends beyond the board (the mobile-cloud round, S1.4) — onboarding,
// compute, routines, the session's machine. Each is a MIRROR of the server's schema in
// packages/control-api/src/commands.ts (a subset of its fields is fine; a field it lacks is not),
// and packages/control-api/test/human-commands-drift.test.ts fails the build if they drift.
export const workspaceCreateCommand = z.object({
  type: z.literal('workspace.create'),
  name: z.string().min(1).max(60),
  slug: z.string().min(2).max(40).regex(/^[a-z0-9][a-z0-9-]*$/),
});
export const workspaceUpdateCommand = z.object({ type: z.literal('workspace.update'), workspace: z.string().min(1), activeModelPack: z.string().min(1).optional() });
// agent.update — re-seat one agent's brain. It mirrors the control-api schema (a subset: the phone
// only ever changes the brain), and it is HERE for the same reason repo.link is: a typed client
// needs the declaration or the call will not compile. The phone sends it from the credential card,
// where re-seating the blocked agent on the house model is the "run on NeuraMesh credits" choice —
// the workspace pack setting alone materializes nothing, so it is the model that has to move.
export const agentUpdateCommand = z.object({
  type: z.literal('agent.update'),
  // NO `workspace` here: the server resolves it from the agent id, and the drift test pins that a
  // client may not send a field the server does not accept.
  agent: z.string().min(1),
  model: z.string().min(1).optional(),
  runtime: z.enum(['claude-code', 'codex', 'gemini']).optional(),
});
// repo.link — register a repo to the workspace and attach it to a project. Metadata only: the
// platform holds no repo token, and the executing machine's own git credentials authenticate at
// clone and push. It mirrors the control-api's own schema (commands.ts), and it is HERE because a
// typed client needs it: the phone attaches a repo from the Code composer when a project has none
// (the mobile fix round, 2026-09-06). A local folder is a computer's, so `localPath` stays for the
// desktop and a phone sends a url.
export const repoLinkCommand = z.object({
  type: z.literal('repo.link'),
  workspace: z.string().min(1),
  channel: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  localPath: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  defaultBranch: z.string().min(1).default('main'),
});
// The calendar's two human moves, mirroring packages/control-api/src/commands.ts. Agents draft and
// humans publish, so both are HUMAN_ONLY in the handler and belong in this set (the mobile fix
// round, 2026-09-06 — the phone's calendar could show a post and do nothing about it). `scheduledAt`
// omitted keeps a draft's own future slot; the server defaults to an hour out.
export const contentApproveCommand = z.object({
  type: z.literal('content.approve'),
  item: z.string().min(1),
  scheduledAt: z.string().datetime().optional(),
});
export const contentUnscheduleCommand = z.object({ type: z.literal('content.unschedule'), item: z.string().min(1) });
// Editing a draft's copy in place. HUMAN_ONLY in the handler ("calendar edits are a human move"),
// which is why it belongs in this set: the phone could open a draft and read it but never change a
// word, while the web could (George, 2026-09-06). Mirrors the server schema.
export const contentUpdateCommand = z.object({
  type: z.literal('content.update'),
  item: z.string().min(1),
  body: z.string().trim().min(1).max(10_000),
  mediaUrl: z.union([z.string().url().max(2000), z.literal('')]).optional(),
});
export const workspaceInviteCommand = z.object({ type: z.literal('workspace.invite'), workspace: z.string().min(1), email: z.string().email() });
export const workspaceAcceptInviteCommand = z.object({ type: z.literal('workspace.accept_invite'), invite: z.string().uuid() });
export const workspaceDeclineInviteCommand = z.object({ type: z.literal('workspace.decline_invite'), invite: z.string().uuid() });
export const credentialSetCommand = z.object({
  type: z.literal('credential.set'),
  workspace: z.string().min(1),
  provider: z.string().min(1),
  scope: z.enum(['workspace', 'agent']),
  token: z.string().min(8).optional(),
  authMode: z.enum(['apikey', 'subscription']),
});
export const agentRegisterCommand = z.object({
  type: z.literal('agent.register'),
  workspace: z.string().min(1),
  machineId: z.string().min(1),
  name: z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/),
  role: z.enum(AGENT_ROLES),
  model: z.string().min(1),
  runtime: z.enum(['claude-code', 'codex', 'gemini']).optional(),
  emoji: z.string().min(1).max(8).optional(),
  description: z.string().min(1).max(280).optional(),
  channels: z.array(z.string().min(1)).min(1),
});
export const memberShareComputeCommand = z.object({ type: z.literal('member.share_compute'), workspace: z.string().min(1), member: z.string().uuid(), on: z.boolean() });
// the master switch: `shares: ['*']` lends to the whole workspace, `[]` to nobody (0119; the
// per-member switch above is member.share_compute). Self-only by construction: the handler
// writes the actor's row.
export const memberSetComputeCommand = z.object({ type: z.literal('member.set_compute'), workspace: z.string().min(1), machine: z.string().uuid().nullable().optional(), shares: z.array(z.string()).optional() });
export const threadSetMachineCommand = z.object({ type: z.literal('thread.set_machine'), workspace: z.string().min(1), threadId: z.string().uuid(), machineId: z.string().uuid().nullable() });
// THE CONVERSATION'S BRAIN, AFTER BIRTH (docs/10 §15). The command has existed on the server since
// the brain round — HUMAN_ONLY, with the role and model allow-list enforced in its handler. It was
// only ever declared in the control-api's own union, so a client typed against HumanCommandInput
// could not name it, and the phone's composer had no way to re-seat a conversation it had already
// started. Same literal, same `override` field: this exposes the command, it does not add one.
// `override: null` is Reset, the WHOLE override rather than a per-role clear (ruling 7).
export const threadSetBrainCommand = z.object({ type: z.literal('thread.set_brain'), workspace: z.string().min(1), threadId: z.string().uuid(), override: z.record(z.string(), z.string()).nullable() });
// SETTLE (0137): the human's one act on a thread's status. It stamps threads.settled_at and nothing
// else: no approve, no accept, no dismiss. A gate or card newer than the stamp brings the thread
// back to Needs you (shared/threadstatus.ts). Unsettle is the undo pill's command.
export const threadSettleCommand = z.object({ type: z.literal('thread.settle'), workspace: z.string().min(1), threadId: z.string().uuid() });
export const threadUnsettleCommand = z.object({ type: z.literal('thread.unsettle'), workspace: z.string().min(1), threadId: z.string().uuid() });
// schedule.create — arming is human-only (the server gates the plan); the phone's New routine sheet sends
// it with `routine: true`, the launcher's flag (a routine, not a marketing drafting schedule)
export const scheduleCreateCommand = z.object({
  type: z.literal('schedule.create'),
  channel: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(4000),
  cadence: z.enum(['once', 'daily', 'weekdays', 'weekly']),
  runAt: z.string().datetime().optional(),
  atTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  tz: z.string().max(64).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  agent: z.string().min(1).optional(),
  routine: z.boolean().optional(),
});
export const scheduleSetStatusCommand = z.object({ type: z.literal('schedule.set_status'), schedule: z.string().min(1), status: z.enum(['active', 'paused']) });
export const scheduleDeleteCommand = z.object({ type: z.literal('schedule.delete'), schedule: z.string().min(1) });
export const scheduleUpdateCommand = z.object({
  type: z.literal('schedule.update'),
  schedule: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(4000),
  cadence: z.enum(['once', 'daily', 'weekdays', 'weekly']),
  runAt: z.string().datetime().optional(),
  atTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  tz: z.string().max(64).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
});
export const machineWakeCommand = z.object({ type: z.literal('machine.wake'), workspace: z.string().min(1), machineId: z.string().uuid() });

// The discriminated union of human commands — mobile/web validate + type against this.
// (Inlined as a literal so zod keeps precise per-member inference.)
export const HumanCommandSchema = z.discriminatedUnion('type', [
  taskCreateCommand,
  taskAcceptCommand,
  taskApproveCommand,
  taskRequestChangesCommand,
  taskCancelCommand,
  taskBlockCommand,
  taskUnblockCommand,
  taskArchiveCommand,
  taskPromoteCommand,
  taskReopenCommand,
  taskUpdateDetailsCommand,
  taskSetDefinitionOfDoneCommand,
  taskRequestPlanCommand,
  taskRevisePlanCommand,
  taskRequestDesignCommand,
  taskSelectDesignProviderCommand,
  taskReviseDesignCommand,
  taskApproveDesignCommand,
  taskApprovePlanCommand,
  taskApproveShipPlanCommand,
  taskReviseShipPlanCommand,
  taskCheckShipItemCommand,
  taskAddShipItemCommand,
  taskFinishSubtaskCommand,
  messagePinCommand,
  decisionAnswerCommand,
  decisionDismissCommand,
  repoLinkCommand,
  contentApproveCommand,
  contentUnscheduleCommand,
  contentUpdateCommand,
  workspaceCreateCommand,
  workspaceUpdateCommand,
  agentUpdateCommand,
  workspaceInviteCommand,
  workspaceAcceptInviteCommand,
  workspaceDeclineInviteCommand,
  credentialSetCommand,
  agentRegisterCommand,
  memberShareComputeCommand,
  memberSetComputeCommand,
  threadSetMachineCommand,
  threadSettleCommand,
  threadUnsettleCommand,
  threadSetBrainCommand,
  scheduleCreateCommand,
  scheduleSetStatusCommand,
  scheduleDeleteCommand,
  scheduleUpdateCommand,
  machineWakeCommand,
  ...CODE_SESSION_COMMANDS,
]);

export type HumanCommand = z.infer<typeof HumanCommandSchema>;
export type HumanCommandType = HumanCommand['type'];
// The shape a CLIENT constructs to SEND (defaults still optional — z.input, not z.infer).
export type HumanCommandInput = z.input<typeof HumanCommandSchema>;
