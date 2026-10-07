import { z } from 'zod';

// Runs (docs/29) — the durable, synced row behind a stretch of agent work.
//
// Every wake already minted a `run_id` (agent_logs, beats.run_id); it just had no row, so
// live status could only ever be (a) machine-local IPC and (b) alive for exactly as long as
// the wake. A run is that id, written down: it survives the turn, syncs to every machine,
// nests via `parent_run_id`, and settles into a terminal state. Descriptive, never gating —
// no FSM edge depends on a run, exactly like beats.
// `parked` (docs/harness/05 §3.8, migration 0102) is OPEN, not terminal: a turn that ended cleanly
// with a wake condition, so the human still sees a live ring rather than a stalled one. It is
// deliberately absent from RUN_TERMINAL_STATES below — which is what keeps every existing isRunOpen
// consumer (the rail's live row, the run dock, the phase ring) painting it with no change.
export const RUN_STATES = ['running', 'parked', 'done', 'failed', 'stopped'] as const;
export type RunState = (typeof RUN_STATES)[number];
// the states a run may be settled INTO — a tuple, because it is also the command's z.enum
export const RUN_TERMINAL_STATES = ['done', 'failed', 'stopped'] as const;
/**
 * The states `run.settle` accepts — the terminal three PLUS `parked` (docs/harness/05 §3.8).
 *
 * Parked is deliberately settleable-but-open: the turn genuinely ended (so the command that closes it
 * is `run.settle`), while the WORK has not (so `isRunOpen` stays true and every client keeps painting
 * a live ring). Kept separate from RUN_TERMINAL_STATES so nothing that reasons about "finished" —
 * reclaim, acceptance, the phase spectrum — quietly starts treating a waiting run as done.
 */
export const RUN_SETTLE_STATES = ['done', 'failed', 'stopped', 'parked'] as const;
export type RunSettleState = (typeof RUN_SETTLE_STATES)[number];
export type RunTerminalState = (typeof RUN_TERMINAL_STATES)[number];
export const isRunOpen = (state: RunState): boolean => state === 'running' || state === 'parked';

// what the run IS, which is also how it renders:
//   wake — one chat/thread reply turn (opens and settles inside the turn)
//   work — a stretch that OUTLIVES its turn (the orchestrator's deep work), posts when done
//   leg  — one child of a `work` run: the fan-out
export const RUN_KINDS = ['wake', 'work', 'leg'] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const RunSchema = z.object({
  id: z.string(),
  workspace: z.string(),
  channelId: z.string(),
  threadId: z.string().nullable(),
  taskId: z.string().nullable(),
  agentId: z.string(),
  parentRunId: z.string().nullable(),
  kind: z.enum(RUN_KINDS),
  title: z.string(),
  state: z.enum(RUN_STATES),
  /** the live "what am I doing" line — LWW, cheap to bump */
  step: z.string().nullable(),
  /**
   * Which CONFIG this run is seated on: `role·model` plus `·@name` when a room specialist's seat was
   * inherited (0103). Leg runs only; null everywhere else and on legs from before it shipped.
   *
   * It has to be stored because it cannot be derived: a subagent has no `agents` row, so a leg's
   * `agentId` is its PARENT's and a roster lookup returns the orchestrator's own role and model for
   * every leg of a fan-out. With rex owning tasks, the board card no longer answers "who is doing
   * this" either — this is where that moved.
   */
  seat: z.string().nullable().default(null),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** short close-out line: the result, or why it stopped */
  summary: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type Run = z.infer<typeof RunSchema>;

/** progress fraction 0..1 for the ring; indeterminate work reads as a slim arc, never 0 or full */
export function runFraction(run: Pick<Run, 'state' | 'done' | 'total'>): number {
  if (!isRunOpen(run.state)) return 1;
  if (run.total <= 0) return 0.08;
  return Math.max(0.08, Math.min(0.97, run.done / run.total));
}

/** the one-line status a rail row / dock shows. Never an identifier, never a bare verb. */
export function runLine(run: Pick<Run, 'state' | 'step' | 'title' | 'done' | 'total' | 'summary'>): string {
  if (run.state === 'running') return run.step?.trim() || run.title;
  if (run.state === 'done') return run.summary?.trim() || `${run.title} — done`;
  return run.summary?.trim() || `${run.title} — ${run.state}`;
}

/** elapsed, in the app's terse clock (0:07 · 4:02 · 1:12:40) */
export function runElapsed(run: Pick<Run, 'startedAt' | 'endedAt'>, now = Date.now()): string {
  const end = run.endedAt ? Date.parse(run.endedAt) : now;
  const secs = Math.max(0, Math.round((end - Date.parse(run.startedAt)) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// ── "what is this agent doing right now", in plain words ────────────────────────────────
// One humanizer, two readers: the renderer's ghost pill (docs/26, machine-local + sub-second)
// and the daemon's run `step` (docs/29, synced + cross-machine). They MUST agree — two maps
// would drift into two different answers for the same tool call, which is exactly the
// "two surfaces, two truths" bug runs exist to end.
export const TOOL_CATS = ['file', 'cmd', 'search', 'check'] as const;
export type ToolCat = (typeof TOOL_CATS)[number];

// the platform tools (mcp__nm__* → logged as "nm.{name}") in plain words — an identifier
// must never reach the pill; anything unmapped gets its underscores spoken instead. the words are
// the simple present with the agent as the subject ("rex checks the board", 2026-10-05): a person
// reads them on the run card, so they follow the house writing rules
export const NM_VERBS: Record<string, { verb: string; cat?: ToolCat }> = {
  task_status: { verb: 'checks the board', cat: 'check' },
  list_tasks: { verb: 'checks the board', cat: 'check' },
  list_backlog: { verb: 'checks the backlog', cat: 'check' },
  list_agents: { verb: 'checks the roster', cat: 'check' },
  list_repos: { verb: 'checks the repositories', cat: 'check' },
  list_projects: { verb: 'checks the projects', cat: 'check' },
  recall: { verb: 'recalls context', cat: 'search' },
  load_skill: { verb: 'reads a team skill', cat: 'check' },
  set_thread_title: { verb: 'names the conversation' },
  create_task: { verb: 'creates the task' },
  offer_task: { verb: 'offers the task' },
  add_subtask: { verb: 'adds a subtask' },
  add_backlog_item: { verb: 'adds an item to the backlog' },
  create_whiteboard: { verb: 'draws a whiteboard' },
  update_whiteboard: { verb: 'redraws the whiteboard' },
  list_whiteboards: { verb: 'checks the whiteboards', cat: 'check' },
  read_whiteboard: { verb: 'reads a whiteboard', cat: 'check' },
  promote_backlog_item: { verb: 'promotes a backlog item' },
  update_backlog_item: { verb: 'updates the backlog item' },
  request_plan: { verb: 'sends the task to the architect' },
  request_design: { verb: 'sends the task to the designer' },
  revise_design: { verb: 'sends notes on the design' },
  revise_plan: { verb: 'sends notes on the plan' },
  revise_ship_plan: { verb: 'sends notes on the release plan' },
  request_changes: { verb: 'asks for changes' },
  post_thread: { verb: 'posts to the thread' },
  register_repo: { verb: 'registers the repository' },
  create_project: { verb: 'creates the project' },
  create_agent: { verb: 'hires the agent' },
  add_agent_to_channel: { verb: 'adds a teammate to the room' },
  record_lesson: { verb: 'records a lesson' },
  propose_skill: { verb: 'proposes a skill' },
  screenshot: { verb: 'takes a screenshot' },
  start_deep_work: { verb: 'starts the deep work' },
  // the tools a lane logs by the bare name (the NeuraMesh brain's turn, the harness tools)
  read_repo_file: { verb: 'reads a repository file', cat: 'file' },
  list_repo_files: { verb: 'lists the repository files', cat: 'check' },
  list_repo_changes: { verb: 'reads the repository changes', cat: 'check' },
  read_workspace_file: { verb: 'reads a workspace file', cat: 'file' },
  list_library: { verb: 'checks the library', cat: 'check' },
  read_library_doc: { verb: 'reads a library document', cat: 'check' },
  propose_library_doc: { verb: 'proposes a library document' },
  list_playbooks: { verb: 'checks the playbooks', cat: 'check' },
  run_playbook: { verb: 'runs a playbook' },
  propose_design_round: { verb: 'proposes a design round' },
  take_task: { verb: 'takes the task' },
  declare_beats: { verb: 'plans the steps' },
  advance_beat: { verb: 'moves to the next step' },
  search_x: { verb: 'searches posts on X', cat: 'search' },
  draft_posts: { verb: 'drafts the posts' },
  revise_posts: { verb: 'revises the posts' },
  read_drafts: { verb: 'reads the drafts', cat: 'check' },
  draft_replies: { verb: 'drafts the replies' },
  revise_replies: { verb: 'revises the replies' },
  draft_article: { verb: 'drafts the article' },
  propose_angles: { verb: 'proposes the angles' },
  generate_image: { verb: 'draws an image' },
  make_product_image: { verb: 'makes a product image' }, // retired 2026-10-06; past runs still show the step
  shelve_repo_screenshot: { verb: 'takes a screenshot from the repository' },
  share_images: { verb: 'shares the images' },
  spawn: { verb: 'starts a subagent' },
  // the rest of the registries (2026-10-05, the review of round 2): a tool with no row here spoke its
  // underscores ("accept task"), so every name a registry hands a turn has words (the desktop's
  // registry test reads the built registries against this table)
  accept_task: { verb: 'accepts the task' },
  request_verdict: { verb: 'asks for a verdict' },
  propose_impl_plan: { verb: 'proposes a plan' },
  schedule_posts: { verb: 'proposes a schedule for the posts' },
  unschedule_posts: { verb: 'asks to remove posts from the schedule' },
  list_workspace: { verb: 'checks the conversation files', cat: 'check' },
  propose_routine: { verb: 'drafts the routine' },
  offer_routine_session: { verb: 'offers a routine session' },
  open_code_session: { verb: 'opens a code session' },
  file_conversation: { verb: 'moves the conversation to a room' },
  park: { verb: 'pauses the work' },
  // the NeuraMesh brain worker's own file tools (runtime/starter.ts)
  write_file: { verb: 'writes a file', cat: 'file' },
  read_file: { verb: 'reads a file', cat: 'file' },
  list_files: { verb: 'lists the files', cat: 'check' },
  // the agents' browser (harness.ts NM_TOOLS)
  web_open: { verb: 'opens a page', cat: 'search' },
  web_read: { verb: 'reads the page', cat: 'search' },
  web_click: { verb: 'clicks an item on the page', cat: 'search' },
  web_type: { verb: 'types text on the page', cat: 'search' },
  web_screenshot: { verb: 'takes a screenshot of the page', cat: 'search' },
};

// the Claude Code tools a summary names bare (host/turnkit.ts toolSummary). null = plumbing worth no words
const SDK_VERBS: Record<string, { verb: string; cat?: ToolCat } | null> = {
  Task: { verb: 'starts a subagent' },
  Agent: { verb: 'starts a subagent' },
  MultiEdit: { verb: 'edits a file', cat: 'file' },
  NotebookEdit: { verb: 'edits a notebook', cat: 'file' },
  ToolSearch: null,
};
/** a tool's own row, never a key the table inherits ("constructor") */
const nmVerb = (name: string): { verb: string; cat?: ToolCat } | null => (Object.hasOwn(NM_VERBS, name) ? NM_VERBS[name]! : null);

/** humanize one activity row into the live line. Returns null for rows worth no words. */
export function toolVerb(row: { kind: string; phase: string | null; summary: string }): { verb: string; cat?: ToolCat } | null {
  // the model's own words are the reply. a phased turn row (the context it was given, the architect's
  // rounds, the plan review) and the CLI's opening inventory ("tools: …", "claude: …") are no reply
  if (row.kind === 'turn') return row.phase || /^(?:tools|claude):/.test(row.summary ?? '') ? null : { verb: 'writes the reply' };
  if (row.kind !== 'tool' || row.phase !== 'call') return null;
  const s = row.summary ?? '';
  const base = (p: string) => p.split('/').pop() ?? p;
  let m = s.match(/^Read (.+)/);
  if (m) return { verb: `reads ${base(m[1]!)}`, cat: 'file' };
  m = s.match(/^(?:Write|Edit) (.+?)(?: \(|$)/);
  if (m) return { verb: `edits ${base(m[1]!)}`, cat: 'file' };
  // the Claude lane logs "Bash: cmd", the codex lane "bash cmd" (runtime/codexsdk.ts)
  m = s.match(/^(?:Bash: |bash )(.+)/);
  if (m) return { verb: `runs ${m[1]!.split(' ').slice(0, 3).join(' ')}`, cat: 'cmd' };
  if (/^(?:Grep|Glob) /.test(s)) return { verb: 'searches the repository', cat: 'search' };
  m = s.match(/^nm\.(\w+)/);
  if (m) return nmVerb(m[1]!) ?? { verb: m[1]!.replace(/_/g, ' ') };
  // the WHAT, not just the verb: the summary carries url/query since toolSummary learned to
  // include them — show "reads neuramesh.app/pricing", "searches “…”"
  m = s.match(/^WebSearch (.+)/);
  if (m) return { verb: `searches “${m[1]!.slice(0, 34)}${m[1]!.length > 34 ? '…' : ''}”`, cat: 'search' };
  if (/^WebSearch/.test(s)) return { verb: 'searches the web', cat: 'search' };
  m = s.match(/^WebFetch (\S+)/);
  if (m) {
    try {
      const u = new URL(m[1]!);
      const path = u.pathname !== '/' ? u.pathname : '';
      return { verb: `reads ${(u.hostname.replace(/^www\./, '') + path).slice(0, 40)}`, cat: 'search' };
    } catch { /* not a url — fall through */ }
  }
  if (/^WebFetch/.test(s)) return { verb: 'reads a page', cat: 'search' };
  m = s.match(/^mcp__(\w+?)__(\w+)/);
  if (m) return { verb: `${m[1]}: ${m[2]!.replace(/[._-]+/g, ' ')}`.slice(0, 40), cat: 'search' };
  if (/^TodoWrite/.test(s)) return { verb: 'updates the plan' };
  // a subagent's start line (host/legs.ts, which named the model there until 2026-10-05): the words only
  if (/^leg "/.test(s)) return { verb: 'starts a subagent' };
  // a tool logged by its bare name, with its arguments or its raw JSON after it (the NeuraMesh
  // brain's turn logs `create_task {…}`): the tool's words, never its name or its JSON
  m = s.match(/^([a-z][a-z0-9_]*)(?=[\s({[]|$)/);
  if (m && (nmVerb(m[1]!) || m[1]!.includes('_'))) return nmVerb(m[1]!) ?? { verb: m[1]!.replace(/_/g, ' ') };
  m = s.match(/^([A-Z]\w*)(?=[\s({[]|$)/);
  if (m && Object.hasOwn(SDK_VERBS, m[1]!)) return SDK_VERBS[m[1]!] ?? null;
  if (/recall/i.test(s)) return { verb: 'recalls context', cat: 'search' };
  // identifier-shaped leftovers (mcp__x__y and friends) get spoken, never shown raw
  if (/^[\w.]+$/.test(s)) return { verb: s.replace(/^mcp__/, '').replace(/[._]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim() };
  // a line that ends in raw arguments keeps its words and drops the JSON
  const words = s.replace(/\s+[{[][\s\S]*$/, '');
  return { verb: words.length > 46 ? `${words.slice(0, 46)}…` : words };
}

// A run that stops moving is the failure the docs/19 watchdog exists to catch — a host that
// dies mid-run leaves `running` behind with no process to settle it. Anything older than this
// with no update is swept to `stopped` (never silently deleted: partial work still counts).
export const RUN_STALE_MS = 30 * 60_000;
export function isRunStale(run: Pick<Run, 'state' | 'updatedAt'>, now = Date.now()): boolean {
  return run.state === 'running' && now - Date.parse(run.updatedAt) > RUN_STALE_MS;
}

// ── Recursive run trees (docs/harness/04 · docs/harness/10) ────────────────────────────────────
// Subagents go unbounded in depth (founder ruling 2026-07-31), and the renderer's grouping was ONE
// level: it collected direct children only, and filtered any row with a parent out of the root list —
// so a GRANDCHILD rendered nowhere at all. It was orphaned, not flattened. This builds the real tree.

/** The minimum a row needs to be placed in a tree. */
export interface RunNodeLike {
  id: string;
  parent_run_id?: string | null;
  started_at: string;
}

export interface RunTreeOf<T extends RunNodeLike> {
  run: T;
  legs: Array<RunTreeOf<T>>;
  /** 0 for a root; the render indent (`.leg.d1/.d2/.d3`) reads this */
  depth: number;
}

/**
 * Group flat run rows into full trees.
 *
 * `isRoot` decides which rows anchor a surface (a thread's runs, a task's runs, a room's own). A row
 * whose parent is NOT present in `rows` is treated as a root rather than dropped — otherwise a leg
 * whose parent has already been pruned by retention would vanish silently.
 */
export function buildRunTrees<T extends RunNodeLike>(rows: readonly T[], isRoot: (r: T) => boolean): Array<RunTreeOf<T>> {
  const byId = new Map<string, T>(rows.map((r) => [r.id, r]));
  const kids = new Map<string, T[]>();
  for (const r of rows) {
    const p = r.parent_run_id;
    if (!p || !byId.has(p)) continue;
    const list = kids.get(p) ?? [];
    list.push(r);
    kids.set(p, list);
  }
  const byStart = (a: RunNodeLike, b: RunNodeLike) => a.started_at.localeCompare(b.started_at);
  // depth is bounded while building, so a cyclic parent chain (a corrupt row) cannot hang the render
  const build = (run: T, depth: number, seen: ReadonlySet<string>): RunTreeOf<T> => {
    const next = new Set(seen).add(run.id);
    const legs = depth >= 12
      ? []
      : (kids.get(run.id) ?? []).filter((c) => !next.has(c.id)).sort(byStart).map((c) => build(c, depth + 1, next));
    return { run, legs, depth };
  };
  return rows
    .filter((r) => {
      const p = r.parent_run_id;
      const orphaned = !!p && !byId.has(p);
      return (!p || orphaned) && isRoot(r);
    })
    .sort(byStart)
    .map((r) => build(r, 0, new Set()));
}

/** Every node in a tree, depth-first — the flat list a recursive renderer emits. */
export function flattenRunTree<T extends RunNodeLike>(t: RunTreeOf<T>): Array<RunTreeOf<T>> {
  return [t, ...t.legs.flatMap(flattenRunTree)];
}

/** How many nodes hang below this one, at any depth — the collapse affordance's count. */
export function subtreeSize<T extends RunNodeLike>(t: RunTreeOf<T>): number {
  return t.legs.reduce((n, l) => n + 1 + subtreeSize(l), 0);
}

/** The deepest still-running node — what the run dock names when the card has scrolled away. */
export function deepestActive<T extends RunNodeLike & { state: string }>(t: RunTreeOf<T>): { node: RunTreeOf<T>; path: string[] } | null {
  let best: { node: RunTreeOf<T>; path: string[] } | null = null;
  const walk = (n: RunTreeOf<T>, path: string[]) => {
    if (n.run.state === 'running' && (!best || n.depth > best.node.depth)) best = { node: n, path };
    for (const l of n.legs) walk(l, [...path, (l.run as unknown as { title?: string }).title ?? '']);
  };
  walk(t, []);
  return best;
}
