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
// must never reach the pill; anything unmapped gets its underscores spoken instead
export const NM_VERBS: Record<string, { verb: string; cat?: ToolCat }> = {
  task_status: { verb: 'checking the board', cat: 'check' },
  list_tasks: { verb: 'checking the board', cat: 'check' },
  list_backlog: { verb: 'checking the backlog', cat: 'check' },
  list_agents: { verb: 'checking the roster', cat: 'check' },
  list_repos: { verb: 'checking the repos', cat: 'check' },
  list_projects: { verb: 'checking the projects', cat: 'check' },
  recall: { verb: 'recalling context', cat: 'search' },
  load_skill: { verb: 'reading a team skill', cat: 'check' },
  set_thread_title: { verb: 'naming the conversation' },
  create_task: { verb: 'creating the task' },
  offer_task: { verb: 'handing off the task' },
  add_subtask: { verb: 'adding a subtask' },
  add_backlog_item: { verb: 'parking it on the backlog' },
  create_whiteboard: { verb: 'drawing a whiteboard' },
  update_whiteboard: { verb: 'redrawing the whiteboard' },
  list_whiteboards: { verb: 'checking the whiteboards', cat: 'check' },
  read_whiteboard: { verb: 'reading a whiteboard', cat: 'check' },
  promote_backlog_item: { verb: 'promoting from the backlog' },
  update_backlog_item: { verb: 'updating the backlog item' },
  request_plan: { verb: 'routing to the architect' },
  request_design: { verb: 'routing to the designer' },
  revise_design: { verb: 'sending design feedback' },
  revise_plan: { verb: 'sending plan feedback' },
  revise_ship_plan: { verb: 'sending ship-plan feedback' },
  request_changes: { verb: 'sending it back with notes' },
  post_thread: { verb: 'posting to the thread' },
  register_repo: { verb: 'registering the repo' },
  create_project: { verb: 'creating the project' },
  create_agent: { verb: 'hiring the agent' },
  add_agent_to_channel: { verb: 'adding a teammate to the room' },
  record_lesson: { verb: 'writing down a lesson' },
  propose_skill: { verb: 'proposing a skill' },
  screenshot: { verb: 'taking a screenshot' },
  start_deep_work: { verb: 'starting the deep work' },
};

/** humanize one activity row into the live line. Returns null for rows worth no words. */
export function toolVerb(row: { kind: string; phase: string | null; summary: string }): { verb: string; cat?: ToolCat } | null {
  if (row.kind === 'turn') return { verb: 'composing…' };
  if (row.kind !== 'tool' || row.phase !== 'call') return null;
  const s = row.summary ?? '';
  const base = (p: string) => p.split('/').pop() ?? p;
  let m = s.match(/^Read (.+)/);
  if (m) return { verb: `reading ${base(m[1]!)}`, cat: 'file' };
  m = s.match(/^(?:Write|Edit) (.+?)(?: \(|$)/);
  if (m) return { verb: `editing ${base(m[1]!)}`, cat: 'file' };
  m = s.match(/^Bash: (.+)/);
  if (m) return { verb: `running ${m[1]!.split(' ').slice(0, 3).join(' ')}`, cat: 'cmd' };
  if (/^(?:Grep|Glob) /.test(s)) return { verb: 'searching the repo', cat: 'search' };
  m = s.match(/^nm\.(\w+)/);
  if (m) return NM_VERBS[m[1]!] ?? { verb: m[1]!.replace(/_/g, ' ') };
  // the WHAT, not just the verb: the summary carries url/query since toolSummary learned to
  // include them — show "reading neuramesh.app/pricing", "searching “…”"
  m = s.match(/^WebSearch (.+)/);
  if (m) return { verb: `searching “${m[1]!.slice(0, 34)}${m[1]!.length > 34 ? '…' : ''}”`, cat: 'search' };
  if (/^WebSearch/.test(s)) return { verb: 'searching the web', cat: 'search' };
  m = s.match(/^WebFetch (\S+)/);
  if (m) {
    try {
      const u = new URL(m[1]!);
      const path = u.pathname !== '/' ? u.pathname : '';
      return { verb: `reading ${(u.hostname.replace(/^www\./, '') + path).slice(0, 40)}`, cat: 'search' };
    } catch { /* not a url — fall through */ }
  }
  if (/^WebFetch/.test(s)) return { verb: 'reading a page', cat: 'search' };
  m = s.match(/^mcp__(\w+?)__(\w+)/);
  if (m) return { verb: `${m[1]}: ${m[2]!.replace(/[._-]+/g, ' ')}`.slice(0, 40), cat: 'search' };
  if (/^TodoWrite/.test(s)) return { verb: 'updating the plan' };
  if (/recall/i.test(s)) return { verb: 'recalling context', cat: 'search' };
  // identifier-shaped leftovers (mcp__x__y and friends) get spoken, never shown raw
  if (/^[\w.]+$/.test(s)) return { verb: s.replace(/^mcp__/, '').replace(/[._]+/g, ' ').trim() };
  return { verb: s.length > 46 ? `${s.slice(0, 46)}…` : s };
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
