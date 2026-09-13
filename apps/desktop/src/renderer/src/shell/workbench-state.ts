// THE WORKBENCH's subject (2026-08-16 faces → ONE FACE, rail-ink round 3, 2026-09-04, George on
// the built card: "I don't think we need the Details/Code tabs any more, just one tab").
//
// The panel is the open session's DETAILS — description · requirements · Definition of Done ·
// artifacts · subtasks · the review loop, portalled in by the thread that owns them — and nothing
// else. It used to carry faces: Details · Code · Artifacts, then a repos face. Artifacts folded
// into Details (2026-08-17: the same list twice), repos retired with Code mode (2026-09-04,
// morning: New session is where you pick a repo), and Code retired the same evening: Code mode
// owns code and the Engineering floor never shows this panel, so a Code face had nowhere left to
// be. What survives of it is a FILES DRAWER under the details (shell/Workbench.tsx), shut by
// default and drawn only when the SESSION has a worktree — the branch switcher, the finder ⌘P
// opens, the tree. No faces means no segment, no "wanted" face, no stale pick to guard against.
//
// What is left to decide is the SUBJECT, and it is decided by context, never by a setting:
//   a task in front of you             → the task (its details, its worktree in the drawer)
//   a chat thread in front of you      → the thread (its artifacts + the room's sections)
//   a room home with nothing open      → the room (brand docs, the queue, connections) — no drawer:
//                                        a room does not browse a repo, a session does
//   nothing at all                     → no panel (the 2026-08-19 destination ruling)
export type WorkbenchSubject = 'task' | 'thread' | 'room';

export interface WorkbenchState {
  /** what the panel is about; null means it does not render */
  subject: WorkbenchSubject | null;
  /** the worktree the Files drawer browses — a session's, never a room's */
  files: string | null;
  /** the header's scope chip — what this panel is pointed at, said out loud */
  scopeLabel: string;
}

export interface WorkbenchInput {
  /** the worktree/repo root the session resolves to, if any */
  root: string | null;
  /** the task whose details this session owns, if any */
  taskId: string | null;
  taskNumber: number | null;
  /** the conversation in front of you, if any — a chat thread has details too (2026-08-17) */
  threadId?: string | null;
  /** the room whose sections back the panel when nothing else does (a room home) */
  channelId?: string | null;
  /** the root's human name (repo or worktree) — used when there is no task number to quote */
  label: string;
  /** a task, a thread or a file tab is in front of you (as opposed to the landing or a destination) */
  sessionScoped: boolean;
}

export function workbenchState({ root, taskId, taskNumber, threadId, channelId, label, sessionScoped }: WorkbenchInput): WorkbenchState {
  // a session outranks the room behind it — one Details, never two
  const subject: WorkbenchSubject | null = sessionScoped && taskId ? 'task' : sessionScoped && threadId ? 'thread' : channelId ? 'room' : null;
  return {
    subject,
    files: subject === 'task' || subject === 'thread' ? root : null,
    scopeLabel: scopeLabelOf({ root, taskNumber, label, sessionScoped }),
  };
}

/** `⎇ nm-1057` · `#1058 · no repo` · the repo's name · the machine — in that order of specificity */
export function scopeLabelOf({ root, taskNumber, label, sessionScoped }: Pick<WorkbenchInput, 'root' | 'taskNumber' | 'label' | 'sessionScoped'>): string {
  if (!sessionScoped) return 'nothing open';
  if (root && taskNumber != null) return `⎇ nm-${taskNumber}`;
  if (root) return label;
  if (taskNumber != null) return `#${taskNumber} · no repo`;
  return label;
}

/**
 * WHERE THE WORKBENCH APPLIES AT ALL (2026-08-19, George).
 *
 * It is the panel for what a SESSION is making — a thread's or task's details, its worktree, its
 * artifacts. A workspace DESTINATION has none of those: Calendar, Routines, Files, Whiteboards,
 * Tasks, Skills, Memory, Activity and Footprint are each a full-width surface with their own
 * scope bar, and the panel sat beside them showing `nothing open` and an empty state. That is
 * ~214px of window spent saying "not here", on the screens where the content most wants the room.
 *
 * It HIDES rather than closes: `nm:wtabsPane` is the human's preference, and a destination has no
 * business editing it. Walk to Calendar and the panel steps aside; come back to a conversation
 * and it is open exactly as you left it.
 *
 * `code` counts because a file tab IS the thing the panel browses. `chat` covers every session
 * surface plus the room home, which is where the room's own sections belong.
 */
export const WORKBENCH_VIEWS: readonly string[] = ['chat', 'code'];

/**
 * `sessionOpen` is not redundant with `view`, and getting that wrong hid the panel everywhere for
 * one build: **opening a session does not change `view`**. `openConversation` sets `openThreadId`
 * and leaves the destination where it was, because a session OVERLAYS the main surface with a back
 * crumb (docs/35) rather than navigating to a different one. So a thread opened from Files still
 * reads `view === 'library'`, and gating on `view` alone hid the panel on the very surface it
 * belongs to.
 *
 * The honest rule is therefore two-part: a session in front of you always earns the panel, and
 * beyond that only the surfaces that are themselves session-shaped (`chat`, `code`) do.
 */
export function workbenchApplies(view: string, sessionOpen: boolean): boolean {
  // the Engineering floor (#391) carries its own split — session, editor, changes — and Code mode
  // is where it lives (rail-ink round, 2026-09-04); a Workbench beside it would be a third column
  if (view === 'engineering') return false;
  return sessionOpen || WORKBENCH_VIEWS.includes(view);
}
