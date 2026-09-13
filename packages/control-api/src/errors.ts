export type DomainErrorCode =
  | 'ILLEGAL_TRANSITION'
  | 'NOT_PERMITTED'
  | 'EVIDENCE_REQUIRED'
  // a file a gate resolves against — refused, by construction (@neuramesh/shared isGateArtifact)
  | 'GATE_ARTIFACT'
  | 'PUSH_REQUIRED'
  | 'SELF_REVIEW_BLOCKED'
  | 'HUMAN_ONLY'
  | 'SHIP_ITEMS_PENDING'
  | 'SUBTASKS_PENDING'
  | 'MAKE_IT_A_SUBTASK'
  | 'CHAT_THREAD'
  // a TASK thread was asked to do something only a chat thread may do (archiving 0108; filing 0109)
  | 'TASK_THREAD'
  // titled-once (0124): the conversation is already named — an agent asked to rename it; only a human may
  | 'THREAD_ALREADY_TITLED'
  // auto-filing (0109, packages/shared/filing.ts). SAME_CHANNEL is not a failure so much as an
  // answer — rex reads it to tell "already in the right room" from "moved"; PROJECT_BOUNDARY is
  // the invariant that a conversation never leaves the project that can see it.
  | 'SAME_CHANNEL'
  | 'PROJECT_BOUNDARY'
  | 'ALREADY_FILED'
  | 'ALREADY_CLAIMED'
  | 'REQUIREMENTS_NOT_CONFIRMED'
  | 'PLAN_NOT_APPROVED'
  | 'INVITE_FAILED'
  | 'INVALID_INPUT'
  | 'AUTH_FAILED'
  | 'SESSION_EXPIRED'
  | 'AUTH_UNAVAILABLE'
  | 'CONFLICT'
  // whiteboard.update carried a baseRev the board has moved past (docs/38) — the caller
  // re-reads the board and reapplies; LWW with no silent clobber.
  | 'WHITEBOARD_STALE'
  | 'DUPLICATE_TASK'
  | 'PLAN_LIMIT'
  | 'MACHINE_LIMIT'
  // an agent-issued create that must never happen silently (project.create, agent.register)
  // arrived with no recent confirmation card naming it — guards.ts requireConfirmCard (2026-08-18)
  | 'CONFIRM_CARD_REQUIRED'
  // the import lane (import.ts, docs/export-format.md "Import"): a bad body or an unknown
  // table, a row for another workspace, a child before its parent, a body over the cap
  | 'IMPORT_FORMAT'
  | 'IMPORT_WORKSPACE'
  | 'IMPORT_ORDER'
  | 'IMPORT_TOO_LARGE'
  | 'NOT_FOUND';

const STATUS: Record<DomainErrorCode, number> = {
  ILLEGAL_TRANSITION: 409,
  ALREADY_CLAIMED: 409,
  NOT_PERMITTED: 403,
  SELF_REVIEW_BLOCKED: 403,
  HUMAN_ONLY: 403,
  EVIDENCE_REQUIRED: 422,
  // 403 — not a bad request; the caller is simply not allowed to remove a gate's evidence
  GATE_ARTIFACT: 403,
  PUSH_REQUIRED: 422,
  REQUIREMENTS_NOT_CONFIRMED: 422,
  // 422 — a claim out of plan_review before a human approved the plan. Like the ship gate, this
  // clears on a state change the caller can wait for, so it is unprocessable rather than forbidden.
  PLAN_NOT_APPROVED: 422,
  // 422 — execute_ship with an unapproved plan or unchecked checklist items; the
  // ship fires itself once the list clears, so callers retry on state change
  SHIP_ITEMS_PENDING: 422,
  // 422 — a parent tried to pass submit/accept/ship with open subtasks (docs/24)
  SUBTASKS_PENDING: 422,
  // 409 — an agent created a peer task whose subject is an open task in the same
  // channel; companion work must ride the parent as a subtask (docs/24)
  MAKE_IT_A_SUBTASK: 409,
  // 409 — task.create named a thread whose Tasks toggle is off (docs/34). The chat turn has no
  // create_task tool at all; this is the floor under that, for any caller that reaches the
  // command anyway. The human turns Tasks on in the thread to unblock it.
  CHAT_THREAD: 409,
  TASK_THREAD: 409,
  // 409 — the name is already set; the state is what it is, and only a human moves it
  THREAD_ALREADY_TITLED: 409,
  // 409 — the move would be a no-op, or has already happened once. Both are "the state is
  // already what you are asking for", which is what 409 says.
  SAME_CHANNEL: 409,
  ALREADY_FILED: 409,
  // 422 — a move across projects. Never legal for anyone, so it is the input that is wrong.
  PROJECT_BOUNDARY: 422,
  INVITE_FAILED: 502,
  INVALID_INPUT: 422,
  AUTH_FAILED: 401,
  // 401 — the Clerk session is VERIFIED dead (expired/revoked/removed). Clients treat this,
  // and only this, as "sign out": desktops drop the stored session and land on sign-in.
  SESSION_EXPIRED: 401,
  // 503 — auth infrastructure (Clerk / network / config) failed transiently. Clients must
  // retry and keep the user signed in; a Clerk outage may never force a re-login.
  AUTH_UNAVAILABLE: 503,
  CONFLICT: 409,
  // 409 — same family as CONFLICT: the state is already past what you built on
  WHITEBOARD_STALE: 409,
  // 409 — an agent tried to create a task an open same-title sibling already covers
  // (the double-triage class). The message names the existing task so the caller's
  // turn can act on it instead of retrying the create.
  DUPLICATE_TASK: 409,
  // 402 Payment Required — a Free-plan entitlement gate. The desktop maps this code to the
  // contextual upgrade flow (never a dead-end failure); the message is the human-facing reason.
  PLAN_LIMIT: 402,
  // 402 too — a Free single-machine limit; the desktop routes it to a transfer-or-upgrade card.
  MACHINE_LIMIT: 402,
  // a precondition the agent can satisfy (post the card) — same family as EVIDENCE_REQUIRED
  CONFIRM_CARD_REQUIRED: 422,
  IMPORT_FORMAT: 400,
  IMPORT_WORKSPACE: 400,
  // 409: the parent is not in the target yet. The client sends the earlier table, then this one again.
  IMPORT_ORDER: 409,
  IMPORT_TOO_LARGE: 413,
  NOT_FOUND: 404,
};

export class DomainError extends Error {
  readonly status: number;

  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}
