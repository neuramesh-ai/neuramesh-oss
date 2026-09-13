// Auto-filing: the orchestrator puts a conversation in the right room so the human never has to
// pick one (2026-08-03, George). This is the pure gate — who may move a thread between channels,
// and when — so every rule below is assertable without a database, a daemon or a model.
//
// The problem it closes is written down in docs/35 §1: "a send that lands in #general looks
// exactly like a send that lands in #dev". Today the human has to guess the room correctly AND
// gets no feedback on the guess. Auto-filing removes the guess; the receipt (the row's room chip,
// rex's one-clause reason, Undo) removes the blindness.
//
// It rides the wake rex ALREADY runs on every human channel message — there is no pre-pass
// classifier turn, because a label is not worth a second round-trip against the <10% agent
// overhead budget (CLAUDE.md).

/** The thread being filed, reduced to the four facts the rules actually read. */
export interface FilingSubject {
  /** the task this thread carries, if it has grown one */
  taskId: string | null;
  /** when an agent last filed it (null = never) */
  filedAt: string | null;
  channelId: string;
  /** the project the thread's CURRENT channel belongs to */
  projectId: string | null;
}

/** Where it is being moved to. */
export interface FilingTarget {
  channelId: string;
  /** the project the target channel belongs to */
  projectId: string | null;
}

export type FilingActor = 'human' | 'orchestrator' | 'agent';

export type FilingVerdict =
  | { ok: true }
  | { ok: false; code: FilingRefusal; message: string };

export type FilingRefusal =
  | 'NOT_PERMITTED'
  | 'SAME_CHANNEL'
  | 'PROJECT_BOUNDARY'
  | 'TASK_THREAD'
  | 'ALREADY_FILED';

/**
 * May this actor move this thread to this channel?
 *
 * The rules, and why each one exists:
 *
 * 1. **Only a human or the orchestrator.** Triage is the orchestrator's job and filing is triage;
 *    a worker that could re-home the conversation it is answering in could walk it into a room
 *    with a friendlier reviewer. Same shape as `task.create`'s gate.
 *
 * 2. **Never across projects — for anybody.** This is an INVARIANT, not a permission: exactly one
 *    project is active at a time and it scopes every list, so a thread that changed project would
 *    vanish from the surface that created it. The human is not exempt, because the disappearance
 *    is the same either way.
 *
 * 3. **Never once the thread carries a task.** The task's channel binds its board, its branch and
 *    the roster that can claim it (an agent sees a task through its channel, CLAUDE.md). Moving
 *    the thread alone would split the conversation from the work; moving both is a different,
 *    larger operation than filing. Applies to the human too — Undo stays open until work starts.
 *
 * 4. **An agent files ONCE.** A second agent move is not a correction, it is two triage turns
 *    disagreeing — and with a wake on every message, a thread could walk between rooms all day.
 *    A human may move it as often as they like: a human changing their mind is the correction.
 *
 * `SAME_CHANNEL` is deliberately a refusal rather than a silent success: it is the answer to
 * "did anything happen?", and rex needs to be able to tell "already right" from "moved".
 */
export function canFileConversation(
  actor: FilingActor,
  subject: FilingSubject,
  target: FilingTarget,
): FilingVerdict {
  if (actor === 'agent') {
    return { ok: false, code: 'NOT_PERMITTED', message: 'conversations are filed by a human or the channel orchestrator' };
  }
  if (target.channelId === subject.channelId) {
    return { ok: false, code: 'SAME_CHANNEL', message: 'this conversation is already in that room' };
  }
  // null projects (a channel that predates the work axis) are treated as the SAME project only
  // when both sides are null — an unowned channel and an owned one are not interchangeable.
  if (target.projectId !== subject.projectId) {
    return {
      ok: false,
      code: 'PROJECT_BOUNDARY',
      message: 'a conversation cannot move to another project — only one project is active at a time, so it would vanish from view',
    };
  }
  if (subject.taskId) {
    return {
      ok: false,
      code: 'TASK_THREAD',
      message: 'this conversation already has a task — its room binds the board, the branch and who can claim it',
    };
  }
  if (actor === 'orchestrator' && subject.filedAt) {
    return {
      ok: false,
      code: 'ALREADY_FILED',
      message: 'this conversation has already been filed once — a human can still move it',
    };
  }
  return { ok: true };
}

/**
 * The room a conversation lands in when triage cannot decide. `general` by convention, and the
 * FIRST such channel in the project, so a workspace whose rooms were renamed still resolves.
 *
 * Worth watching rather than trusting (the mockup's Stop 7): if most filings end up here, the
 * ROOMS are wrong, not the triage — which is why `thread.move` records a reason even for a
 * fallback, and why "no move" is a legal answer rather than a failure.
 */
export function fallbackChannel<T extends { id: string; slug: string }>(channels: T[]): T | null {
  return channels.find((c) => c.slug === 'general') ?? channels[0] ?? null;
}
