// The harness contract (docs/harness) — the pure, shared half.
//
// Everything here answers ONE question: what is a turn allowed to do? It lives in shared (not the
// daemon) because the answer must be identical on the machine that runs the turn and the server that
// authorizes its commands — the docs/34 double-enforcement shape, generalized from chat mode to every
// turn kind. Pure: no I/O, no model, no Electron, so the whole availability matrix is unit-testable.
import { z } from 'zod';

// ── Turn kinds: what a stretch of agent execution IS ───────────────────────────────────────────
// One kind per distinct contract. `leg` is a subagent (docs/harness/04): it inherits its parent's
// world MINUS every board command, which is why it is a kind rather than a flag.
export const TURN_KINDS = [
  'chat',    // a conversation reply (docs/34)
  'triage',  // an orchestrator turn
  'own',     // an orchestrator ADVANCING a task it owns (docs/29 §4d)
  'design',  // a mockup round (docs/14)
  'plan',    // architect + Definition of Done
  'work',    // the coding / deliverable loop
  'review',  // a reviewer verdict
  'ship',    // a release plan (docs/23)
  'sweep',   // digest / watchdog triage
  'deep',    // researched long-form work (docs/29 `work` run)
  'leg',     // a spawned subagent
] as const;
export type TurnKind = (typeof TURN_KINDS)[number];

/**
 * `own` is separate from `triage`, and the separation is the point.
 *
 * A triage turn DECIDES — it reads the board, asks its questions, and routes. An owning turn
 * EXECUTES: it holds the task, spawns the subagents that do the phase, and answers for what they
 * produce. They differ in every dimension that matters. A triage turn is cheap and should stay
 * cheap (it runs on every room message); an owning turn funds a fan-out, and a fan-out cannot be
 * funded from 4 minutes and 24k tokens because `sliceBudget` gives each child half the REMAINDER.
 * Folding them into one kind would either starve the fan-out or make every routing decision cost
 * what a build costs.
 */
export const OWNING_KINDS: readonly TurnKind[] = ['own'];

/** The kinds that own a workspace on disk and can therefore produce deliverables. */
export const WORKING_KINDS: readonly TurnKind[] = ['own', 'design', 'work', 'review', 'ship', 'deep', 'leg'];

// ── The tool catalogue ────────────────────────────────────────────────────────────────────────
// Availability is (kind × role). The RUNTIME IS DELIBERATELY NOT AN INPUT — that it ever was is the
// defect docs/harness/03 §2.2 exists to end: `record_lesson` shipped as a Claude-only tool, so a
// Codex-seated worker silently could not record one.
export const NM_TOOLS = [
  'screenshot',
  'load_skill',
  'propose_skill',
  'record_lesson',
  'add_backlog_item',
  'add_subtask',
  'declare_beats',
  'advance_beat',
  'spawn',
  'park',
  'create_whiteboard',
  'update_whiteboard',
  'list_whiteboards',
  'read_whiteboard',
  'search_x',
  'draft_replies',
  'list_repo_changes',
  'read_repo_file',
  'list_repo_files',
] as const;
export type NmTool = (typeof NM_TOOLS)[number];

/**
 * Which turn kinds may call each nm tool.
 *
 * Read this as the contract, not as configuration: a tool absent for a kind is never handed to the
 * model, so there is nothing to refuse at runtime. Two rulings are encoded here and worth naming:
 *
 *  - **`design` and `plan` cannot park backlog items or subtasks.** Those turns are proposing, not
 *    executing; a designer that files board rows mid-round is scope creep with a tool.
 *  - **`leg` (a subagent) gets the working tools but NOT `add_subtask`.** A subagent's work belongs
 *    to its parent (docs/harness/04 §3.4), and a subtask is a board row — the parent's to create.
 */
export const TOOL_KINDS: Record<NmTool, readonly TurnKind[]> = {
  screenshot: ['own', 'design', 'work', 'review', 'deep', 'leg'],
  load_skill: [...TURN_KINDS],
  propose_skill: ['work', 'review', 'deep'],
  record_lesson: ['own', 'work', 'review', 'leg'],
  add_backlog_item: ['own', 'work', 'review', 'chat', 'triage'],
  add_subtask: ['own', 'work', 'triage'],
  // An owning turn DECLARES its plan like any other working turn — it is the surface the human reads
  // to know where a multi-phase task has got to, and rex is the one that knows.
  declare_beats: ['own', 'design', 'work', 'review', 'ship', 'deep'],
  advance_beat: ['own', 'design', 'work', 'review', 'ship', 'deep'],
  // Fan-out is available to a `leg` TOO — depth is unbounded by founder ruling (docs/harness/04), and
  // it is `sliceBudget` that terminates the recursion, not an availability rule. A `chat` turn is the
  // one exclusion: a conversation answers, and a chat that silently spawns a fleet is not a chat.
  spawn: ['own', 'triage', 'design', 'plan', 'work', 'review', 'deep', 'leg'],
  // Park matches PARKABLE_KINDS: only a turn that OWNS real work may wait. A `leg` may not — a parked
  // child holding its parent's turn open is a new failure shape (docs/harness/04 OQ2) — and a chat or
  // triage turn should answer, not wait. `own` may: waiting on CI for a PR its subagents pushed is
  // the canonical park, and it is the owner that has to be there when the checks land.
  park: ['own', 'work', 'review', 'ship', 'deep'],
  // Whiteboards (docs/38). READS are broad — George's ruling: an agent may read any board, so a
  // triage or leg turn can look at the diagram everyone is discussing. WRITES belong to turns
  // that produce content: `chat` included by design (the "sol, sketch the pipeline" ask IS a
  // conversation), `leg` excluded (a subagent's diagram is its parent's to file — same stance as
  // add_subtask).
  //
  // `triage` WAS excluded on "rex routes, it does not draw" — reversed 2026-08-08, reported live.
  // Asked in a Tasks-on room to "draft a whiteboard diagram of the platform architecture", rex had
  // no create_whiteboard, so it wrote a markdown file with a mermaid fence and proposed it to the
  // library. The exclusion assumed drawing is somebody else's job, but there is nobody to route a
  // sketch to: a diagram is a DELIVERABLE rex produces (docs/29 — "a deliverable you can produce
  // is not a task"), and the only routes left were a board row for a two-minute sketch or a
  // document that is not a board. Same shape as draft_posts (0115): the prompt already told rex to
  // use this tool, and a prompt rule always loses to the tool inventory.
  create_whiteboard: ['chat', 'triage', 'own', 'design', 'plan', 'work', 'review', 'deep'],
  update_whiteboard: ['chat', 'triage', 'own', 'design', 'plan', 'work', 'review', 'deep'],
  list_whiteboards: ['chat', 'triage', 'own', 'design', 'plan', 'work', 'review', 'deep', 'leg'],
  read_whiteboard: ['chat', 'triage', 'own', 'design', 'plan', 'work', 'review', 'deep', 'leg'],
  // X reads on the LEG — the marketing-os round: playbook research legs (audit/teardown/GEO)
  // are exactly where "what is being said on X" gets asked, and the documented registry gap
  // (integrations plan P2 claimed workers had this; they never did) bit there first. `work`
  // stays out until a working turn demonstrates the need — a smaller grant is easy to widen.
  // The chat/triage/own surfaces carry their own copies in the host registries, not this bus.
  // `work` joined `leg` (triage-preflight round, 2026-08-26): a research unit that needs
  // conversations should READ them. Denied the tool, a worker did the only thing left — it
  // wrote a Python package that would read them if it ever had a credential, and shipped that
  // as the deliverable. The budget saved by withholding one tool description is not worth a
  // unit inventing a software project.
  search_x: ['leg', 'work'],
  // Reply opportunities (reply-radar round) — the radar's own worker hands the card over, on
  // `work` AND `leg`: the turn that FOUND the conversation is the one that can say what it was
  // and why it is worth joining, and routing that back through the orchestrator would make rex
  // retype facts it did not gather. `chat`/`triage` carry their own copy in the host registry
  // (host/tools-replies.ts), exactly as the content tools do.
  draft_replies: ['work', 'leg'],
  // The repository reads (docs/design/github-connector-2026-09): the room's project's repository through
  // the GitHub connector (or the machine's own gh). Broad by design, like the whiteboard reads: a
  // triage turn deciding whether a feature shipped, a chat turn asked what changed, a marketer's
  // leg reading the CHANGELOG. Read only, so nothing here can move the board or the repository.
  list_repo_changes: ['chat', 'triage', 'own', 'design', 'plan', 'work', 'review', 'ship', 'deep', 'leg'],
  read_repo_file: ['chat', 'triage', 'own', 'design', 'plan', 'work', 'review', 'ship', 'deep', 'leg'],
  list_repo_files: ['chat', 'triage', 'own', 'design', 'plan', 'work', 'review', 'ship', 'deep', 'leg'],
};

/** Is this tool available to this turn kind? The single reader every surface agrees through. */
export function toolAvailable(tool: NmTool, kind: TurnKind): boolean {
  return TOOL_KINDS[tool].includes(kind);
}

/** Every nm tool a turn kind may call, in catalogue order (stable for prompts + tests). */
export function toolsForKind(kind: TurnKind): NmTool[] {
  return NM_TOOLS.filter((t) => toolAvailable(t, kind));
}

// ── Runtime capabilities ──────────────────────────────────────────────────────────────────────
/**
 * What a runtime can actually do — declared, so the harness branches on a property instead of on
 * `if (agent.runtime === 'codex')` scattered across the daemon.
 *
 * `gatesNativeTools` is the one that carries weight, and it is a hard limit of the vendor SDKs
 * rather than a gap in our code (verified 2026-07-31):
 *
 *  - **claude-code** exposes a `PreToolUse` hook that fires for EVERY tool even under
 *    `bypassPermissions`, so each native Read/Write/Bash call is evaluated and can be denied.
 *  - **codex** (`@openai/codex-sdk@0.141`) offers `approvalPolicy` — a policy *string*
 *    (`never | on-request | on-failure | untrusted`) — and its `ThreadEvent` union carries **no
 *    approval event**, so a host cannot answer a per-call approval. Its floor is its own Seatbelt
 *    `workspace-write` mode.
 *  - **gemini** drives `agy --print`, whose argv must stay exactly `--print <prompt>` (any extra flag
 *    derails the run), so there is no hook and no toolset restriction available at all. Its floor is
 *    our L1b Seatbelt jail.
 *
 * The harness therefore gates every tool IT mediates on every runtime, and reports honestly that
 * per-call policy over NATIVE tools exists only where `gatesNativeTools` is true. A workspace that
 * needs per-call enforcement over shell and filesystem access must seat its agents on a runtime that
 * has it — and because this is a declared capability rather than an undocumented difference, the
 * product can say so instead of quietly behaving differently.
 */
export interface RuntimeCapabilities {
  /** can it drive a multi-turn file/bash loop? */
  agenticLoop: boolean;
  /** can it see an image? */
  inlineImages: boolean;
  /** does it self-sandbox, so wrapping it in ours would fight its own profile? */
  nativeSandbox: boolean;
  /** can a per-call policy verdict be enforced on the runtime's OWN tools? (see above) */
  gatesNativeTools: boolean;
  /** how bus tools reach the model */
  toolTransport: 'in-process' | 'mcp-loopback';
  /** can a thread be resumed (warm pools, mid-turn swap)? */
  resumable: boolean;
}

export const RUNTIME_CAPABILITIES: Record<string, RuntimeCapabilities> = {
  'claude-code': { agenticLoop: true, inlineImages: true, nativeSandbox: false, gatesNativeTools: true, toolTransport: 'in-process', resumable: false },
  codex: { agenticLoop: true, inlineImages: true, nativeSandbox: true, gatesNativeTools: false, toolTransport: 'mcp-loopback', resumable: true },
  gemini: { agenticLoop: true, inlineImages: false, nativeSandbox: false, gatesNativeTools: false, toolTransport: 'mcp-loopback', resumable: false },
};

export function capabilitiesFor(runtime: string): RuntimeCapabilities {
  return RUNTIME_CAPABILITIES[runtime] ?? RUNTIME_CAPABILITIES['claude-code']!;
}

// ── The message envelope (docs/harness/02) ────────────────────────────────────────────────────
// Structured inter-agent + subagent communication, replacing the six ad-hoc text protocols. The
// human-readable thread message is a PROJECTION of this (`body.text`); the harness reads `body.data`.
export const MESSAGE_KINDS = ['request', 'result', 'progress', 'question', 'answer', 'handoff', 'failure'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const AgentMessageSchema = z.object({
  id: z.string().min(1),
  v: z.literal(1),
  from: z.object({ kind: z.enum(['agent', 'subagent', 'human', 'harness']), id: z.string(), turnId: z.string().optional() }),
  to: z.object({ kind: z.enum(['agent', 'subagent', 'parent', 'thread']), id: z.string().optional() }),
  kind: z.enum(MESSAGE_KINDS),
  subject: z.object({
    workspaceId: z.string(),
    channelId: z.string(),
    threadId: z.string().optional(),
    taskId: z.string().optional(),
  }),
  body: z.object({ text: z.string().optional(), data: z.unknown().optional() }),
  // brain-RELATIVE paths only: an absolute path here would leak a host filesystem layout into a
  // record that is designed to be exported to another machine (docs/harness/01 §4).
  refs: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('artifact'), id: z.string() }),
    z.object({ kind: z.literal('file'), path: z.string().refine((p) => !p.startsWith('/'), 'refs.file.path must be brain-relative, never absolute') }),
    z.object({ kind: z.literal('turn'), id: z.string() }),
    z.object({ kind: z.literal('task'), number: z.number().int() }),
  ])).optional(),
  causedBy: z.string().optional(),
  at: z.string(),
}).refine(
  // a human-visible kind with no prose would render as a blank thread message; fail at validation
  // rather than at render time, which is where a blank message is merely confusing.
  (m) => !(['result', 'question', 'answer', 'failure'] as string[]).includes(m.kind) || !!m.body.text?.trim(),
  { message: 'a human-visible message kind requires body.text' },
);
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

// ── Turn budgets (docs/harness/05 §3.6) ───────────────────────────────────────────────────────
// One table, replacing eleven wall-clock literals scattered across call sites. `slice()` is what
// terminates subagent recursion: depth is bounded by resource, never by a depth cap (docs/harness/04).
export interface BudgetSpec { wallMs: number; contextTokens: number }

export const TURN_BUDGETS: Record<TurnKind, BudgetSpec> = {
  chat: { wallMs: 12 * 60_000, contextTokens: 40_000 },
  triage: { wallMs: 4 * 60_000, contextTokens: 24_000 },
  // An owning turn funds a FAN-OUT, and `sliceBudget` gives each child half the remainder — so the
  // budget has to survive being halved two or three times and still clear BUDGET_FLOOR. From
  // 25 minutes: a three-way design round leaves each child ~6m/16k and the owner ~3m to synthesise,
  // which is the smallest number that does not refuse the third child outright.
  own: { wallMs: 25 * 60_000, contextTokens: 72_000 },
  design: { wallMs: 20 * 60_000, contextTokens: 32_000 },
  plan: { wallMs: 15 * 60_000, contextTokens: 48_000 },
  work: { wallMs: 15 * 60_000, contextTokens: 64_000 },
  review: { wallMs: 10 * 60_000, contextTokens: 48_000 },
  ship: { wallMs: 10 * 60_000, contextTokens: 32_000 },
  sweep: { wallMs: 4 * 60_000, contextTokens: 16_000 },
  deep: { wallMs: 30 * 60_000, contextTokens: 64_000 },
  leg: { wallMs: 8 * 60_000, contextTokens: 24_000 },
};

/** The floor a child must clear to be worth spawning — below it, `sliceBudget` refuses. */
export const BUDGET_FLOOR: BudgetSpec = { wallMs: 60_000, contextTokens: 4_000 };

/**
 * Carve a child budget out of a parent's REMAINING allowance.
 *
 * Returns null when the remainder cannot fund a viable child — which is the whole recursion
 * terminator: a subtree cannot exceed its root, so an unbounded-depth fan-out still halts, on
 * physics rather than on a permission a model could argue with.
 *
 * `share` is the fraction of the remainder one child may take. Concurrency is NOT decided here —
 * that is the dispatcher's slot pool (docs/harness/05 §3.4).
 */
export function sliceBudget(remaining: BudgetSpec, share = 0.5): BudgetSpec | null {
  const wallMs = Math.floor(remaining.wallMs * share);
  const contextTokens = Math.floor(remaining.contextTokens * share);
  if (wallMs < BUDGET_FLOOR.wallMs || contextTokens < BUDGET_FLOOR.contextTokens) return null;
  return { wallMs, contextTokens };
}
