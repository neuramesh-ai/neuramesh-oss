// THE SIDE PANEL's rules (the side-panel round, 2026-10-03, docs/design/side-panel-2026-10) — pure,
// so they are tested, not eyeballed.
//
// The panel is the frame's right tenant: everything beside the conversation lives in it, and the
// Workbench card that floated inside the sheet retired into it. It belongs to the SESSION in front
// of you. A session owns the tabs it opened (`WTab.owner`), and it has tabs of its own that are not
// records at all: Overview for a task, a conversation or a room home, Files for a task this client
// can browse, and the code face for a coding thread. Those derive from the kind of the session, so
// they can never close, persist or leak into another session by mistake.
import type { WTab } from '../wtabs';

export type PanelSessionKind = 'task' | 'thread' | 'coding' | 'room';
export type SessionTabKey = 'overview' | 'files' | 'drafts' | 'changes' | 'plan' | 'checkpoints' | 'terminal';

export interface PanelSession {
  /** the owner key of the tabs it opens: `task:<id>` · `thread:<id>` · `room:<id>` · null = the workspace set */
  key: string | null;
  kind: PanelSessionKind | null;
  /** a task with a worktree this client can browse */
  files?: boolean;
  /** a room home whose room has sections of its own (a marketing room's brand docs, queue, connections) */
  roomSections?: boolean;
  /** the session drafted posts (thread-posts round): they read in a Drafts tab of their own */
  drafts?: boolean;
}

/** what is in front of the sheet decides the session: a task outranks its thread, a thread its room */
export function panelSessionOf(i: { taskId?: string | null; threadId?: string | null; coding?: boolean; roomId?: string | null; roomSections?: boolean; files?: boolean; drafts?: boolean }): PanelSession {
  if (i.taskId) return { key: `task:${i.taskId}`, kind: 'task', files: !!i.files, drafts: !!i.drafts };
  if (i.threadId) return i.coding ? { key: `thread:${i.threadId}`, kind: 'coding' } : { key: `thread:${i.threadId}`, kind: 'thread', drafts: !!i.drafts };
  if (i.roomId) return { key: `room:${i.roomId}`, kind: 'room', roomSections: !!i.roomSections };
  return { key: null, kind: null };
}

/** the session's own tabs, in strip order */
export function sessionTabsOf(s: PanelSession): SessionTabKey[] {
  switch (s.kind) {
    case 'task': return ['overview', ...(s.files ? ['files' as const] : []), ...(s.drafts ? ['drafts' as const] : [])];
    case 'thread': return s.drafts ? ['overview', 'drafts'] : ['overview'];
    case 'room': return s.roomSections ? ['overview'] : [];
    case 'coding': return ['changes', 'files', 'plan', 'checkpoints', 'terminal'];
    default: return [];
  }
}

export const SESSION_TAB_LABEL: Record<SessionTabKey, string> = {
  overview: 'Overview', files: 'Files', drafts: 'Drafts', changes: 'Changes', plan: 'Work Plan', checkpoints: 'Checkpoints', terminal: 'Terminal',
};

/** a session tab's id in the strip: never a UUID, so it can never collide with a record's id */
export const sessionTabId = (k: SessionTabKey): string => `s:${k}`;
export const sessionTabKeyOf = (id: string | null | undefined): SessionTabKey | null =>
  id && id.startsWith('s:') ? (id.slice(2) as SessionTabKey) : null;

/** the per-session front is stored under this slot ('' is the workspace set) */
export const ownerSlot = (key: string | null | undefined): string => key ?? '';

/** the tabs a session opened, in strip order. The conversation record is never a guest. */
export function panelGuests(tabs: WTab[], owner: string | null): WTab[] {
  return tabs.filter((t) => t.kind !== 'conversation' && (t.owner ?? null) === owner);
}

/**
 * The tab in front: the session's own pick when it still exists, else its first own tab (Overview,
 * or Changes on a coding thread), else the last tab it opened. A pick that names a closed tab or a
 * session tab this session does not have (Files after the worktree went away) falls through.
 */
export function panelFront(stored: string | null | undefined, sessionTabs: SessionTabKey[], guests: WTab[]): string | null {
  if (stored) {
    const k = sessionTabKeyOf(stored);
    if (k ? sessionTabs.includes(k) : guests.some((g) => g.id === stored)) return stored;
  }
  if (sessionTabs.length) return sessionTabId(sessionTabs[0]!);
  return guests.length ? guests[guests.length - 1]!.id : null;
}

/** ⌘1 is the composer (the conversation never leaves the screen); ⌘2 onwards are the strip's tabs in order */
export function panelKeyTarget(sessionTabs: SessionTabKey[], guests: WTab[], digit: number): { kind: 'composer' } | { kind: 'tab'; id: string } | null {
  if (digit === 1) return { kind: 'composer' };
  const ids = [...sessionTabs.map(sessionTabId), ...guests.map((g) => g.id)];
  const id = ids[digit - 2];
  return id ? { kind: 'tab', id } : null;
}

/**
 * What a change inside ONE session does to the fold: a tab that comes to the front unfolds the panel
 * (a file you just opened must be visible), and the last tab leaving folds it when the session has
 * no tab of its own to show. A move to another session never moves the fold: `openWithSession`
 * decides that. A switch between the session's own tabs is a click, and a click means the panel is open.
 */
export function panelFoldAfter(
  prev: { owner: string | null; front: string | null; guests: number },
  next: { owner: string | null; front: string | null; guests: number; sessionTabs: number },
): 'open' | 'close' | null {
  if (prev.owner !== next.owner) return null;
  if (next.guests === 0 && prev.guests > 0 && next.sessionTabs === 0) return 'close';
  if (next.front && next.front !== prev.front && !sessionTabKeyOf(next.front)) return 'open';
  return null;
}

/**
 * What opening a session does to the fold (George, 2026-08-26, kept by the side-panel round): a task
 * brings the panel out, so its progress is in view, and so does a coding thread, whose code lives
 * there. A conversation leaves the panel where your toggle put it, unless something in it waits for
 * your verdict.
 */
export function openWithSession(kind: PanelSessionKind | null, waitsForYou: boolean): boolean {
  return kind === 'task' || kind === 'coding' || waitsForYou;
}
