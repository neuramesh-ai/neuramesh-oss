// The session list's derivations (docs/35) — SHARED, because the phone draws the same list
// (the mobile-cloud round, S1.1): historyRows is the list (chats, tasks and the loose room
// messages that predate them), sessionGroups dates it, roomBriefs keeps the digests as the cards
// pinned above it, and the brief voice helpers dress them. Pure: no renderer, no clock read
// inside (`now` is injected), so every boundary is assertable — apps/desktop/src/main/room-tabs.test.ts
// asserts them through the desktop's re-export, and the phone's screens call these directly.
//
// Moved verbatim from apps/desktop/src/renderer/src/room-tabs.ts; that file keeps the room's
// surface lens (roomTabsFor / resolveRoomSurface) and re-exports everything here.
import { stripMarkdownInline } from './threads';
import { parseCard } from './cards';

export interface HistoryThread {
  id: string;
  task_id: string | null;
  title: string | null;
  last_body?: string | null;
  updated_at: string;
  /** present on the workspace-wide watch; absent on the per-channel one */
  channel_id?: string | null;
  channel_slug?: string | null;
  /** 0119: a scheduled automation opened this thread */
  schedule_id?: string | null;
}

export interface HistoryTask {
  /** the task's git branch (repo-backed work) — the rail's second line */
  branch?: string | null;
  id: string;
  number: number;
  title: string;
  description: string | null;
  channel_id: string;
  channel_slug?: string | null;
  parent_task_id: string | null;
  /** thread-owned work (2026-08-17): set = the unit rides its conversation, never a row here */
  origin_thread_id?: string | null;
  updated_at: string;
  /** board FSM state — optional so a caller that only has the identity columns still fits */
  state?: string;
}

/** A room message as the brief rule and the legacy pass need it — the room watch's row. */
export interface RoomMessage {
  id: string;
  author_kind: string;
  author_id: string;
  body: string;
  /** the conversation this message belongs to — a brief and a loose room message have none */
  thread_id?: string | null;
  task_id?: string | null;
  /** a thread ROOTED here: this message opens a session, so the session's row already carries it */
  root_thread_id?: string | null;
  created_at: string;
}

export interface HistoryRow<T extends HistoryTask> {
  branch: string | null;
  key: string;
  threadId: string | null;
  /** which room this row belongs to — the rail groups by it on Home, and every row names it */
  channelId: string | null;
  channelSlug: string;
  task: T | null;
  title: string;
  snip: string;
  when: string;
  /** a session's dial: the task's FSM state, or null for a chat (a chat has no state) */
  state: string | null;
  /**
   * A loose room message with no session of its own (the legacy pass) — the id to root a
   * reply at. Set only on `msg:` rows; every other row opens a thread or a task.
   */
  rootMessageId?: string;
  /** 0119: this session is a routine's run — the rows wear the clock marker */
  scheduleId?: string | null;
  /** A workspace Engineering session shown in the global All threads rail. It has no room or
   * board task, so the rail uses this identity to route back into the Engineering surface. */
  engineeringSessionId?: string;
  engineeringRepo?: string;
  engineeringMode?: 'plan' | 'act';
  engineeringState?: 'idle' | 'streaming' | 'awaiting_approval' | 'resumable' | 'completed' | 'error';
}


/** A run on a CHILD is live work in the PARENT's session too (2026-08-22, George): a subtask's
 *  run registers under its parent task, and an anchored unit's under its origin thread — else
 *  the parent row (the one with the nav presence) sits dark while its child works. */
export function liveKinOf(tasks: Array<{ id: string; parent_task_id: string | null; origin_thread_id?: string | null }>): (taskId: string) => string[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return (taskId: string): string[] => {
    const out: string[] = [];
    const t = byId.get(taskId);
    if (!t) return out;
    if (t.origin_thread_id) out.push(t.origin_thread_id);
    if (t.parent_task_id) {
      out.push(t.parent_task_id);
      const p = byId.get(t.parent_task_id);
      if (p?.origin_thread_id) out.push(p.origin_thread_id);
    }
    return out;
  };
}

/** one line for the row's title, the remainder for its snippet — a body clipped, not summarized */
function clip(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Every thread a room has had, newest first, plus its tasks that never grew a thread. A
 * task-linked thread carries its task (so the row opens the task, not the thread), which is
 * also why the bare-task pass skips anything already linked — one row per subject.
 *
 * `channelId: null` widens it to the whole workspace — what Home shows, where a row's own
 * room is the only thing telling you where it lives. Callers pass workspace-wide threads for
 * that; the per-channel watch simply has no other rooms in it.
 *
 * `messages` runs the LEGACY PASS (docs/35 §10): a human room message that predates the rule
 * that every send births a session has no thread and no task, so it is in neither of the two
 * passes above — and with the feed retired it would be unreachable in the app. One row each,
 * keyed `msg:<id>`, opening the docs/31 reply flow rooted at the message. New sends can never
 * make one, so the pass shrinks forever. Excluded, in order: an AGENT's room message (that is
 * a brief — roomBriefs owns it), a task note, a message inside a conversation, and a message a
 * thread is already rooted at (its session's row is the row for it).
 */
export function historyRows<T extends HistoryTask>(input: {
  threads: HistoryThread[];
  tasks: T[];
  channelId: string | null;
  channelSlug: string;
  query: string;
  limit?: number;
  /** this room's channel-root messages — omit to skip the legacy pass (Home has no such watch) */
  messages?: RoomMessage[];
}): Array<HistoryRow<T>> {
  const { threads, tasks, channelId, channelSlug, query, messages } = input;
  const needle = query.trim().toLowerCase();
  const inScope = <R extends { channel_id?: string | null }>(r: R) => channelId === null || r.channel_id === channelId;
  const scopedThreads = threads.filter((t) => t.channel_id === undefined || inScope(t));
  const linked = new Set(scopedThreads.map((t) => t.task_id).filter(Boolean));
  // Thread-owned work (2026-08-17): a unit anchored to a conversation (origin_thread_id) is
  // NEVER a session row — its ‹task:id› card lives in the owning conversation, its surface is
  // the peek, and the Tasks destination stays the cross-room ledger. Only legacy bare tasks
  // (board-born, pre-anchor) still earn a row here.
  const bare = tasks.filter((t) => inScope(t) && !linked.has(t.id) && !t.parent_task_id && !t.origin_thread_id);
  /**
   * The same ruling the `bare` filter enforces, applied to the THREAD pass (George, 2026-08-26:
   * "rex created a subtask, but somehow it became a new task and now shows on the left nav").
   *
   * A unit anchored to a conversation, and a subtask, live as CARDS in the session that owns
   * them. But every task can grow its own thread, and this pass mapped every thread — so the
   * moment one did, the work earned a nav row after all and appeared twice: once as the card
   * in its owning session, once as a row of its own. `bare` knew the rule; this pass did not.
   *
   * The anchor must be a DIFFERENT thread: a conversation that upgraded into its own task's
   * thread is that task's session, and hiding it would hide the conversation itself.
   */
  const ownedElsewhere = (t: HistoryThread, task: T | null): boolean =>
    !!task && (!!task.parent_task_id || (!!task.origin_thread_id && task.origin_thread_id !== t.id));
  const loose = (messages ?? []).filter((m) => m.author_kind === 'human' && !m.thread_id && !m.task_id && !m.root_thread_id);
  const slugOf = (id: string | null | undefined) =>
    tasks.find((t) => t.channel_id === id)?.channel_slug ?? channelSlug;
  return [
    ...scopedThreads.flatMap((t) => {
      const task = t.task_id ? tasks.find((x) => x.id === t.task_id) ?? null : null;
      if (ownedElsewhere(t, task)) return [];
      return [{
        key: `th:${t.id}`,
        threadId: t.id as string | null,
        channelId: t.channel_id ?? task?.channel_id ?? channelId,
        channelSlug: t.channel_slug ?? task?.channel_slug ?? slugOf(t.channel_id),
        task,
        branch: task?.branch ?? null,
        title: plainTitle(t.title || 'New thread'),
        snip: (t.last_body ?? '').replace(/‹task:[0-9a-fA-F-]{36}›/g, '▸ filed a task — card in the thread').trim(),
        when: t.updated_at,
        state: task?.state ?? null,
        scheduleId: t.schedule_id ?? null,
      }];
    }),
    ...bare.map((t) => ({
      key: `tk:${t.id}`,
      threadId: null as string | null,
      channelId: t.channel_id,
      channelSlug: t.channel_slug ?? channelSlug,
      task: t,
      branch: t.branch ?? null,
      title: `#${t.number} · ${plainTitle(t.title)}`,
      snip: t.description || `#${t.channel_slug ?? channelSlug}`,
      when: t.updated_at,
      state: t.state ?? null,
    })),
    ...loose.map((m) => {
      const [head = '', ...rest] = m.body.split('\n');
      return {
        key: `msg:${m.id}`,
        branch: null,
        threadId: null as string | null,
        channelId,
        channelSlug,
        task: null as T | null,
        title: plainTitle(clip(head, 96)) || 'Room message',
        snip: clip(rest.join(' '), 160),
        when: m.created_at,
        state: null as string | null,
        rootMessageId: m.id,
      };
    }),
  ]
    .filter((r) => !needle || `${r.title} ${r.snip} ${r.channelSlug}`.toLowerCase().includes(needle))
    .sort((a, b) => (a.when < b.when ? 1 : -1))
    .slice(0, input.limit ?? 200);
}

export type SessionBucket = 'Today' | 'Yesterday' | 'This week' | 'Earlier';

export interface SessionGroup<T extends HistoryTask> {
  label: SessionBucket;
  rows: Array<HistoryRow<T>>;
}

const BUCKETS: SessionBucket[] = ['Today', 'Yesterday', 'This week', 'Earlier'];

/** Local midnight `back` days before `ms` — via setDate so month ends and DST shifts land right. */
function dayStart(ms: number, back: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - back);
  return d.getTime();
}

/**
 * The session list's date grouping. Boundaries are LOCAL days, not elapsed hours: 00:01 today
 * is Today and 23:59 yesterday is Yesterday even though a minute separates them — the reading
 * "what did I do today" is calendar, not stopwatch. `This week` is the six local days before
 * yesterday (today + 6 back = a week of rows), everything older is `Earlier`.
 *
 * `now` is injected so the boundaries are assertable; the clock is never read in here. Row order
 * carries through untouched (historyRows already sorted newest-first), and an empty bucket is
 * omitted rather than rendering a header with nothing under it. A `when` that won't parse sorts
 * into Earlier — the row still shows, which beats vanishing over a bad timestamp.
 */
export function sessionGroups<T extends HistoryTask>(rows: Array<HistoryRow<T>>, nowMs: number): Array<SessionGroup<T>> {
  const today = dayStart(nowMs, 0);
  const yesterday = dayStart(nowMs, 1);
  const week = dayStart(nowMs, 6);
  const held = new Map<SessionBucket, Array<HistoryRow<T>>>();
  for (const r of rows) {
    const at = Date.parse(r.when);
    // no upper bound on Today: a row stamped slightly ahead of this machine's clock (the
    // cost of cloud truth across machines) belongs at the top, not in Earlier.
    const label: SessionBucket = at >= today ? 'Today' : at >= yesterday ? 'Yesterday' : at >= week ? 'This week' : 'Earlier';
    const bucket = held.get(label);
    if (bucket) bucket.push(r);
    else held.set(label, [r]);
  }
  return BUCKETS.filter((label) => held.has(label)).map((label) => ({ label, rows: held.get(label) as Array<HistoryRow<T>> }));
}

export interface RoomBrief {
  messageId: string;
  body: string;
  at: string;
}

/**
 * The pinned room briefs: the orchestrator's digests and announcements, kept without keeping
 * the feed they lived on. Newest first — the top card is the current state of the room, and the
 * ones under it are why an earlier digest is no longer the only thing you can see (docs/35 §10:
 * eviction from a one-card slot was disappearance, because a brief has no thread and so appears
 * in neither the session list nor the ⌘Y overlay).
 *
 * The shape is the selector because the daemon has no digest flag to read. Verified in
 * apps/desktop/src/main/agents.ts: `orchestratorSweep` posts every scheduled summary, stall-triage
 * note and monitor note with `post('/v1/messages', actor, { workspace, channel, body })` — no
 * taskId, no threadId — and the control-api writes `thread_id` only when the client names one
 * (packages/control-api/src/app.ts) and births a thread only for a named id
 * (pgstore.postMessage). So a digest is exactly: authored by an agent, task_id null, thread_id
 * null.
 *
 * Authorship is checked twice — `author_kind` AND the id resolving inside the room's roster, the
 * same pairing the feed and suggestionTarget use — since `author_kind` is untyped replica text.
 * The cost is deliberate: an author who can't be resolved (roster not synced yet, agent retired)
 * yields no brief rather than a brief signed by nobody.
 *
 * A card-carrying body is NOT a brief: an `nmq` question or an `nmauth` permission gate posted
 * to the room is needs-you material, and the queue is where it is answered. Summarizing it into
 * a one-line brief would strip the buttons off the one message that exists to be clicked.
 */
export function roomBriefs(messages: RoomMessage[], agentIds: Set<string>, limit = 5): RoomBrief[] {
  return messages
    .filter((m) => m.author_kind === 'agent' && agentIds.has(m.author_id))
    .filter((m) => !m.task_id && !m.thread_id) // a task's or a conversation's message, not the room's
    .filter((m) => !parseCard(m.body))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, limit)
    .map((m) => ({ messageId: m.id, body: m.body, at: m.created_at }));
}

/** The newest brief — the one the slot rests on. */
export function roomBrief(messages: RoomMessage[], agentIds: Set<string>): RoomBrief | null {
  return roomBriefs(messages, agentIds, 1)[0] ?? null;
}

/**
 * The brief's display voice (2026-07-30, George: the raw digest "reads as AI slop"). A digest
 * is LLM prose aimed at a channel; the pinned card is a human's morning glance. This strips the
 * machine framing rather than rewriting content:
 *  - the leading emoji + "Morning/Midday/Evening status — <room>" boilerplate (the card's own
 *    ROOM BRIEF label already says what it is; the room is the one you are standing in)
 *  - em/en dashes become "·" separators (the founder's no-em-dash rule for briefs)
 *  - " - " list glue collapses to sentence flow
 * Pure and conservative: content words are never rewritten, only frame + separators.
 */
export function briefPretty(body: string): string {
  let t = stripBriefFrame(body);
  t = t.replace(/^[-·]\s+/, ''); // the one-liner reads as a sentence, not a stray bullet
  // each match begins at the line start or a non-blank, so a run of blanks is scanned once (CodeQL, 2026-09-18)
  t = t.replace(/(^|\S)\s+[—–]\s+/g, '$1 · ');
  t = t.replace(/(^|\S)\s+-\s+/g, '$1 · ');
  t = t.replace(/\s{2,}/g, ' ');
  return t.trim();
}

/** the shared frame-strip: the leading emoji + the "status — <room>" heading line */
function stripBriefFrame(body: string): string {
  let t = body.trim();
  t = t.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]+\s*/u, '');
  // the trailing separator is same-line only ([ \t]) — \s crossed the newline and ate the
  // first BULLET's dash, which is how the full view lost its opening list item
  t = t.replace(/^(morning|midday|evening|daily|nightly)?[ \t]*status[ \t]*[—–-][ \t]*[\w#-]+[ \t]*[—–:]?[ \t]*\n*/i, '');
  return t;
}

/**
 * The EXPANDED brief: same frame-strip, but structure survives — the digest's markdown
 * bullets, numbering and paragraphs are the point of the full view (2026-07-30 round 2).
 * Only within-line em/en dashes become separators; list markers at line starts are sacred.
 */
export function briefPrettyFull(body: string): string {
  const t = stripBriefFrame(body);
  return t
    .split('\n')
    .map((line) => line.replace(/(\S)\s+[—–]\s+(\S)/g, '$1 · $2'))
    .join('\n')
    .trim();
}

/**
 * The collapsed brief's ONE line. The digest prompt asks the orchestrator for a plain
 * summary sentence on its own line right after the heading (2026-07-30 round 4 — a real
 * summary, not a truncation); when a digest carries one, that line IS the summary. A legacy
 * digest (or a model that ignored the instruction) opens straight with bullets, and then the
 * flattened-truncation floor keeps the card honest rather than empty.
 */
export function briefSummary(body: string, max = 160): string {
  const stripped = briefPrettyFull(body);
  const first = stripped.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
  const isProse = first.length > 0 && !/^[-*•#\d]/.test(first) && !/^\*\*/.test(first);
  const line = plainTitle(isProse ? first : briefPretty(body));
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** titles arrive as message first-lines — presentation markdown (**bold**, `code`) is noise in a row */
export function plainTitle(t: string): string {
  // the same strip the birth heuristic runs (threads.ts), so a title stored before 2026-09-12 with a
  // `**` its 60-character cut left unbalanced still reads clean everywhere it is drawn
  return stripMarkdownInline(t).trim();
}
