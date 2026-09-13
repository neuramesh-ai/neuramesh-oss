// Staffing math for Mission Control (docs/12 §6): a todo task in a room where no
// registered agent could EVER take it is a "needs you" item — the board says todo,
// but nothing will happen until a human staffs the room. Pure + structural (no
// timers, no heuristics): the trigger is "zero eligible agents registered to the
// task's channel", which is exactly the state the orchestrator reports as
// "no agents are registered to this channel, so #N can't be routed or worked."
export interface StaffingTask {
  state: string;
  /** work-type label; 'setup' rows are the HUMAN's checklist — no staffing can route one */
  kind?: string | null;
  assignee_id?: string | null;
  offered_agent_id?: string | null;
  channel_id: string;
}
export interface StaffingAgent {
  role: string;
  /** comma-joined channel ids (the roster's membership key) */
  channel_ids?: string | null;
  /** soft retirement (0054, PR #77) — absent/null = active */
  retired_at?: string | null;
}

// An agent that can take work in a channel: registered there, not retired, and not
// the orchestrator (it routes work, it never claims it — a room whose only member
// is the orchestrator is unstaffed, which is precisely the #marketing case).
function eligibleIn(channelId: string, agents: StaffingAgent[]): boolean {
  return agents.some(
    (a) =>
      a.role !== 'orchestrator' &&
      !a.retired_at &&
      (a.channel_ids ?? '').split(',').map((s) => s.trim()).includes(channelId),
  );
}

/** True when this task is stuck by construction: open on the board (todo), nobody
 * assigned or offered, and its channel has no agent that could take it. Backlog is
 * deliberately parked (not stuck) and later states have an actor — only todo counts. */
export function isUnroutableTodo(t: StaffingTask, agents: StaffingAgent[]): boolean {
  // a setup task is unassigned todo by DESIGN — the human walks it; staffing the room
  // changes nothing about it, so it must never raise the "hire someone" card
  if (t.kind === 'setup') return false;
  return t.state === 'todo' && !t.assignee_id && !t.offered_agent_id && !eligibleIn(t.channel_id, agents);
}

export function unroutableTodos<T extends StaffingTask>(tasks: T[], agents: StaffingAgent[]): T[] {
  return tasks.filter((t) => isUnroutableTodo(t, agents));
}

// ── A task's project is its CHANNEL's project (CLAUDE.md, docs/06) ────────────────────
//
// The model is derivation, not storage: "a task's project is its channel's project". The
// column exists as a denormalized convenience, and it can be null — older rows, and any path
// that created a task without stamping it. Every surface that scoped with a bare
// `t.project_id === active.id` therefore dropped those rows out of EVERY project at once:
// invisible on the board, in the room counts, and in Home's needs-you queue, while unscoped
// consumers (the Home nav badge) still counted them. A count you can see but never reach.
//
// Resolve through the channel instead, so a null column reads as "whatever room it lives in".
export interface ProjectScopedTask {
  channel_id: string;
  project_id?: string | null;
}
export interface ProjectScopedChannel {
  id: string;
  project_id?: string | null;
}

/** the project this task belongs to — its own stamp, else the one its channel belongs to */
export function taskProjectId(task: ProjectScopedTask, channels: ProjectScopedChannel[]): string | null {
  return task.project_id ?? channels.find((c) => c.id === task.channel_id)?.project_id ?? null;
}

/** the tasks in one project, resolved the same way everywhere */
export function tasksInProject<T extends ProjectScopedTask>(tasks: T[], channels: ProjectScopedChannel[], projectId: string | null): T[] {
  if (!projectId) return tasks;
  return tasks.filter((t) => taskProjectId(t, channels) === projectId);
}

/**
 * The same scope for rows that are NOT tasks — threads, conversations, runs. They carry no
 * project column at all (nothing denormalized to fall back on), so their project is purely
 * their channel's, and a row whose channel has not replicated yet is out of scope rather than
 * in every scope: an unknown room cannot be claimed by the project you happen to be standing in.
 *
 * This is the work axis applied to the CONVERSATION surfaces — the Recents rail, the ⌘Y
 * overlay, a room's session list, Home's In flight. Home's needs-you queue is the one written
 * exception (docs/12 §6) and deliberately does not come through here.
 */
export function rowsInProject<T extends { channel_id: string }>(
  rows: T[],
  channels: ProjectScopedChannel[],
  projectId: string | null,
): T[] {
  if (!projectId) return rows;
  const ids = new Set(channels.filter((c) => c.project_id === projectId).map((c) => c.id));
  return rows.filter((r) => ids.has(r.channel_id));
}
