// Row + input shapes the Store speaks — extracted from store.ts (track C-store).
// Pure types: no behaviour, so both implementations and every caller share ONE
// definition instead of three that drift.
import { type BrainOverride, type ActorRef, type NMEvent, type RunKind, type Task, type ThreadMode } from '@neuramesh/shared';

export interface MutationResult {
  task: Task;
  events: NMEvent[];
  // set on submit — persisted as artifact rows alongside the transition
  artifacts?: Array<{ kind: string; name: string; content?: string }>;
  // set on approve_design — the store promotes the task's latest design round
  // (design-mockup-v{R}-*) into the channel library in the same transaction
  promoteLatestDesignRound?: boolean;
  // set on approve_ship_plan — the approved release plan (ship-plan-v{R}.md)
  // joins the channel library exactly like an approved design round
  promoteLatestShipRound?: boolean;
  // set on a terminal transition (accepted/closed) — the store dismisses the task's
  // still-open nmq decision cards in the same transaction, so a question can never
  // outlive the task it was asked about (docs/12 slice 2)
  dismissOpenDecisions?: boolean;
  // where the artifacts land — a finishing SUBTASK attaches its deliverables to
  // the PARENT task (docs/24) so review/ship see one evidence set. Defaults to
  // the mutated task's own id.
  artifactTaskId?: string;
}

export interface ArtifactRow {
  id: string;
  taskId: string;
  kind: string;
  name: string;
  content: string | null;
  createdAt: string;
  messageId?: string | null; // chat attachments link to their message
  promoted?: boolean;
  channel?: string; // the shelf it sits on (the frame lookup, store/frames.ts)
  mime?: string | null;
}

// A chat attachment (image/file) added to a message. Persisted as an artifact row so it shows
// in the channel artifact screen; the full bytes live on the host, only the thumbnail is inline.
export interface AttachmentInput {
  id: string;
  workspace: string;
  channel: string;
  taskId: string | null;
  messageId: string;
  kind: string;
  name: string;
  mime: string | null;
  inlineContent: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  author: ActorRef;
}

// schedule arm-time input (marketing-channel plan §4.6); nextRunAt is precomputed by the
// handler via the shared cadence brain so every store stays dumb about calendars.
export interface ScheduleInput {
  channelId: string;
  title: string;
  prompt: string;
  cadence: string;
  atTime: string;
  tz: string;
  weekday: number | null;
  nextRunAt: string;
  agentName: string | null;
  createdByKind: string;
  createdBy: string;
  /** extra keys merged into the payload jsonb beside `prompt` (e.g. the marketing
   * bootstrap's { bootstrap: true, threadId }) — server-internal callers only */
  payloadExtra?: Record<string, unknown> | null;
}

export interface NMMessage {
  id: string;
  workspace: string;
  channel: string;
  taskId: string | null;
  author: ActorRef;
  body: string;
  createdAt: string;
  /** the message this one ANSWERS (agent wake replies only) — the server enforces one
   * reply per (agent, trigger), so concurrent daemons can't double-reply (0060). */
  replyTo?: string | null;
  /** the conversation thread this message belongs to. The FIRST message carrying an
   * unknown thread id births the thread row (title = heuristic over the body) in the
   * same transaction — idempotent, so agent replies just carry the id along. */
  threadId?: string | null;
  /** docs/31: the room message this thread hangs off, when this send births one */
  rootMessageId?: string | null;
  /** docs/34: the composer's Tasks toggle, applied only when this send BIRTHS the thread
   * (a later message carrying it is ignored — the mode is the thread's, and it moves only
   * through thread.set_mode). Absent reads as 'tasks', so every existing caller is correct. */
  threadMode?: ThreadMode | null;
  /** docs/10 §15: the composer's brain draft, applied only when this send BIRTHS the thread.
   * Parsed through the same gate the daemon reads with, so a stale client cannot seat an agent
   * on a model the runtime would refuse. */
  brainOverride?: BrainOverride | Record<string, string> | null;
  /** 0119: the automation whose slot fired this send, applied only when it BIRTHS the thread —
   * the run-history link the Automations card reads. Birth-only for the same reason as the two
   * above: a later reply into the conversation must not re-attribute who started it. */
  scheduleId?: string | null;
  /** 0134, rule D9 — birth-only, like scheduleId: the session's designated machine and the client that bore it */
  threadMachineId?: string | null;
  threadOrigin?: 'desktop' | 'web' | 'routine' | null;
}

// A decision seed: one ```nmq card extracted from an agent message's body at POST
// /v1/messages — inserted transactionally WITH the message so a card without its
// decision row is impossible (docs/12 slice 2). Everything else (workspace, channel,
// task, asker) comes from the message itself.
export interface DecisionSeed {
  id: string;
  question: string;
  options: Array<{ label: string; description?: string; icon?: 'iris' | 'claude-design'; provider?: 'iris' | 'claude-design' }>;
  allowOther: boolean;
}

export interface DecisionRow {
  id: string;
  workspace: string;
  channel: string;
  taskId: string | null;
  messageId: string;
  asker: ActorRef;
  question: string;
  options: Array<{ label: string; description?: string; icon?: 'iris' | 'claude-design'; provider?: 'iris' | 'claude-design' }>;
  allowOther: boolean;
  status: 'open' | 'answered' | 'dismissed';
  answer: string | null;
  answeredBy: ActorRef | null;
  createdAt: string;
  answeredAt: string | null;
}

// A persisted permission-policy rule (agent policy engine, Phase 1). Maps to a PolicyRule
// in @neuramesh/shared plus its scope binding (which workspace/project/channel/agent it attaches to).
export interface PolicyRow {
  id: string;
  workspace: string;
  scope: string;
  projectId: string | null;
  channelId: string | null;
  agentId: string | null;
  capability: string;
  selector: unknown;
  verdict: string;
  rationale: string;
  locked: boolean;
  createdBy: ActorRef;
  createdAt: string;
  updatedAt: string;
}
export interface PolicyInput {
  id?: string;
  workspace: string;
  scope: string;
  projectId?: string | null;
  channelId?: string | null;
  agentId?: string | null;
  capability: string;
  selector: unknown;
  verdict: string;
  rationale?: string;
  locked?: boolean;
  author: ActorRef;
}

// The verified nm identity the desktop sign-in handoff carries back from the trusted
// web page to the polling desktop (mirrors the /auth/clerk response shape).
export interface DesktopAuthResult {
  userId: string;
  email: string | null;
  sessionId: string | null;
}

// Title normalization for the duplicate-create guard: case- and whitespace-insensitive.
// The memory store applies it in JS; the postgres store mirrors it in SQL
// (lower(regexp_replace(btrim(title), '\s+', ' ', 'g'))) — keep the two in lockstep
// or the guard silently diverges between dev and prod.
export const normalizeTaskTitle = (title: string): string => title.trim().replace(/\s+/g, ' ').toLowerCase();

/** what `run.open` needs — the agent comes from the actor, so it's never client-supplied */
export interface RunInput {
  id?: string;
  workspace: string;
  channelId: string;
  threadId?: string | null;
  /** docs/31: the room message this thread hangs off, when this send births one */
  rootMessageId?: string | null;
  taskId?: string | null;
  parentRunId?: string | null;
  agentId: string;
  kind: RunKind;
  title: string;
  total?: number;
  step?: string | null;
  /** `role·model[·@specialist]` — which config a leg runs on (0103). Null on non-leg runs. */
  seat?: string | null;
}

// ── Whiteboards (docs/38) ─────────────────────────────────────────────────────────────────────
// scene/source travel as JSON TEXT through this interface (pg casts ::jsonb at the write);
// validation of their shape is the handler's job, storage never re-parses.
export interface WhiteboardRow {
  id: string;
  workspace: string;
  channelId: string;
  threadId: string | null;
  taskId: string | null;
  title: string;
  scene: string | null;
  source: string | null;
  snapshotSvg: string | null;
  snapshotRev: number;
  rev: number;
  archivedAt: string | null;
  createdByKind: 'human' | 'agent';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** the list projection — everything BUT the heavy scene/source/snapshot columns */
export type WhiteboardMeta = Omit<WhiteboardRow, 'scene' | 'source' | 'snapshotSvg'> & { hasScene: boolean; hasSource: boolean };

export interface WhiteboardCreate {
  id?: string | null;
  channelId: string;
  threadId?: string | null;
  taskId?: string | null;
  title: string;
  scene?: string | null;
  source?: string | null;
  snapshotSvg?: string | null;
  snapshotRev?: number;
  rev?: number;
  createdByKind: 'human' | 'agent';
  createdBy: string;
}

/** the autosave path: applies only when `rev` is HIGHER than the stored row's — never throws on stale */
export interface WhiteboardLwwPatch {
  id: string;
  rev: number;
  title?: string;
  scene?: string;
  snapshotSvg?: string;
  snapshotRev?: number;
  /** tri-state: undefined = untouched, string = archived, null = un-archived */
  archivedAt?: string | null;
  updatedByKind: 'human' | 'agent';
  updatedBy: string;
}

/** the strict command path: baseRev must equal the stored rev, else WHITEBOARD_STALE */
export interface WhiteboardUpdate {
  id: string;
  baseRev: number;
  title?: string;
  source?: string | null;
  scene?: string;
  snapshotSvg?: string;
  clearSource?: boolean;
  updatedByKind: 'human' | 'agent';
  updatedBy: string;
}
