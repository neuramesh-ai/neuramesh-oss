// The workspace tab strip (mockups/workspace-tabs.html, slice 1): the main content area becomes
// tabbed — the conversation is tab one, and files, terminals and browsers open beside it as
// closable siblings. This is the model behind it, kept pure so the invariants the strip promises
// (one file is one tab · the conversation cannot be closed or dragged out of slot 0 · a
// read-only artifact can never reach Edit) live in one place and are provable without a
// renderer, instead of resting on the UI's willingness to hide a button.
//
// Little of this is new machinery. The bottom dock already kept ONE flat global array of tabs
// carrying a per-tab kind, cwd, url and pty (localStorage['nm:dockTabs'], shared across every
// project, room and task) — global tab set, per-tab scope. That model is promoted upward here,
// and migrateDockTabs is the door a user's open dock tabs walk through, so the upgrade that
// retires the dock does not silently empty them.

export type WTabKind = 'conversation' | 'file' | 'terminal' | 'browser' | 'review' | 'whiteboard';

/**
 * How a file renders itself — per FILE, not per app: the same tab flips its own mode.
 *
 * `source` and `edit` are deliberately DIFFERENT modes over the same bytes. Collapsing them
 * (the first cut of this module) made an artifact unable to show its own raw text, because
 * refusing `edit` to a read-only tab also refused it the source view — and the approved mockup
 * gives every artifact a `Source · Preview` toggle. Reading raw bytes is not a write capability.
 */
export type WTabMode = 'source' | 'edit' | 'preview' | 'diff';

export interface WTab {
  id: string;
  kind: WTabKind;
  title: string;
  subtitle?: string | null;
  /** absolute path — a file tab's IDENTITY, which is what makes one file one tab */
  path?: string | null;
  /** the worktree/folder this tab is scoped to; a file tab with no path is a pane on this root */
  root?: string | null;
  /** the task whose worktree this tab belongs to — a terminal's jail, and its reuse key */
  taskNumber?: number | null;
  url?: string | null;
  artifactId?: string | null;
  /** a whiteboard tab's IDENTITY (docs/38) — its own field, because persistW drops artifactId tabs */
  whiteboardId?: string | null;
  /** an artifact: a record of what an agent produced, never an editing surface */
  readOnly?: boolean;
  mode?: WTabMode;
  dirty?: boolean;
}

/** the strip's whole state — the tab set plus which one the content area is showing */
export interface WTabState {
  tabs: WTab[];
  activeId: string | null;
}

export interface WTabCaps {
  canEdit: boolean;
  canClose: boolean;
  canSplit: boolean;
}

const conversationOf = (tabs: WTab[]): WTab | null => tabs.find((t) => t.kind === 'conversation') ?? null;

/**
 * Open `spec`, or activate the tab that already answers it.
 *
 * Reuse differs per kind because identity does:
 *  - a FILE is its absolute path. Opening drawer.tsx twice gives you the tab you already have,
 *    so "did I open this already?" never needs asking and a dirty buffer cannot fork in two. A
 *    file tab with no path is a pane on a root (what a dock editor tab was), and reuses on it.
 *  - a TERMINAL is its worktree: one live shell per task, which is also what keeps a task's
 *    pty single. A terminal with neither task nor root has nothing to collide on, so it opens
 *    fresh — the dock's own rule, inherited unchanged.
 *  - a BROWSER never reuses. URLs are cheap and two browsers is a legitimate want (a dev server
 *    beside the PR that fixes it); deduping would take a window away rather than save one.
 *  - a REVIEW is the artifact it decides on. Several review tabs may be open at once — they are
 *    ordinary tabs — but one artifact is one tab, so the same plan cannot be opened twice and a
 *    half-written comment batch (docs/36 §13, ruling 4) can never be stranded on a duplicate.
 *
 * The conversation is not openable here: it belongs to the room, and setConversation is the one
 * door that moves it. Asking for one lands on the one that already exists.
 */
export function openTab(tabs: WTab[], spec: WTab): WTabState {
  if (spec.kind === 'conversation') return { tabs, activeId: conversationOf(tabs)?.id ?? null };
  const open = tabs.find((t) => reuses(t, spec));
  if (open) return { tabs, activeId: open.id };
  return { tabs: [...tabs, spec], activeId: spec.id };
}

function reuses(open: WTab, spec: WTab): boolean {
  if (open.kind !== spec.kind) return false;
  switch (spec.kind) {
    case 'file':
      // artifact-backed file tabs (a doc, an article) key on the ARTIFACT — one artifact is one
      // tab, exactly as one path is; without this every Open article minted a sibling tab
      if (spec.artifactId) return open.artifactId === spec.artifactId;
      return spec.path ? open.path === spec.path : !open.path && !!spec.root && open.root === spec.root;
    case 'terminal':
      return spec.taskNumber != null
        ? open.taskNumber === spec.taskNumber
        : open.taskNumber == null && !!spec.root && open.root === spec.root;
    case 'review':
      return !!spec.artifactId && open.artifactId === spec.artifactId;
    case 'whiteboard':
      // one board is one tab — the same reason one file is: a canvas mid-edit cannot fork in two
      return !!spec.whiteboardId && open.whiteboardId === spec.whiteboardId;
    default:
      return false;
  }
}

/**
 * Close a tab and hand the surface to its heir.
 *
 * The conversation is the room you are standing in; there is no state in which closing it is
 * the answer, so the model refuses rather than the strip merely omitting the ✕.
 */
export function closeTab(tabs: WTab[], activeId: string | null, id: string): WTabState {
  const i = tabs.findIndex((t) => t.id === id);
  const tab = i < 0 ? null : tabs[i];
  if (!tab || tab.kind === 'conversation') return { tabs, activeId };
  const next = [...tabs.slice(0, i), ...tabs.slice(i + 1)];
  if (activeId !== id) return { tabs: next, activeId };
  // the RIGHT neighbour takes over — you keep moving forward through what you opened — else the
  // left, else slot 0, which holds the conversation whenever there is one (see setConversation).
  const heir = next[i] ?? next[i - 1] ?? next[0];
  return { tabs: next, activeId: heir?.id ?? null };
}

/** A stale id (⌘3 for a tab that just closed) leaves the surface where it is. */
export function activateTab(tabs: WTab[], activeId: string | null, id: string): WTabState {
  return { tabs, activeId: tabs.some((t) => t.id === id) ? id : activeId };
}

/**
 * Reorder the strip. Slot 0 belongs to the conversation: it cannot be dragged out of it, and
 * nothing can be dropped into it. A drag aimed at slot 0 lands at 1 rather than being refused —
 * "as far left as legal" is what the gesture asks for, and a no-op reads as a broken drag.
 */
export function moveTab(tabs: WTab[], id: string, toIndex: number): WTab[] {
  const from = tabs.findIndex((t) => t.id === id);
  const moving = from < 0 ? null : tabs[from];
  if (!moving) return tabs;
  const floor = tabs[0]?.kind === 'conversation' ? 1 : 0;
  if (from < floor) return tabs;
  const want = Number.isFinite(toIndex) ? Math.trunc(toIndex) : from;
  const to = Math.min(Math.max(want, floor), tabs.length - 1);
  if (to === from) return tabs;
  const rest = [...tabs.slice(0, from), ...tabs.slice(from + 1)];
  return [...rest.slice(0, to), moving, ...rest.slice(to)];
}

/**
 * Point tab one at a room or session. George's ruling: the conversation tab FOLLOWS the room —
 * switching rooms replaces tab one in place and never spawns a second conversation tab, which is
 * what keeps the strip conversation-first instead of a pile of rooms.
 *
 * Every other tab survives the swap: the file you are reading and the terminal you are running
 * belong to your work, not to the room you happened to be standing in. `activeId` carries
 * through for the same reason — unless you were ON the conversation, where staying put means
 * following it to the new room rather than being dropped onto a sibling.
 *
 * A set whose slot 0 is not a conversation (what reviveTabs hands back at boot, since the
 * conversation is derived from the room rather than stored) has one INSERTED there instead of
 * losing its first tab.
 */
export function setConversation(tabs: WTab[], spec: Omit<WTab, 'kind'>, activeId: string | null): WTabState {
  const conv: WTab = { ...spec, kind: 'conversation' };
  const head = tabs[0];
  if (head?.kind === 'conversation') {
    return { tabs: [conv, ...tabs.slice(1)], activeId: activeId === head.id ? conv.id : activeId };
  }
  return { tabs: [conv, ...tabs], activeId };
}

/**
 * What a tab may do — the record answers, never the chrome. A read-only artifact reports canEdit
 * false whatever mode it is carrying, so a hidden button is not the only thing standing between
 * an agent's deliverable and an edit to it. The conversation reports canClose and canSplit false
 * for one reason: slot 0 of the primary group is where it lives, and both acts would move it.
 */
export function tabCapabilities(tab: WTab): WTabCaps {
  return {
    canEdit: tab.kind === 'file' && !tab.readOnly,
    canClose: tab.kind !== 'conversation',
    canSplit: tab.kind !== 'conversation',
  };
}

/**
 * Edit is legal exactly where tabCapabilities says it is — one rule, so the two cannot drift.
 * ONLY `edit` is gated: `source` is a read, and a read-only tab may always read itself.
 */
export function setMode(tabs: WTab[], id: string, mode: WTabMode): WTab[] {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return tabs;
  if (mode === 'edit' && !tabCapabilities(tab).canEdit) return tabs;
  return tabs.map((t) => (t.id === id ? { ...t, mode } : t));
}

/**
 * What survives a relaunch: FILES, BROWSERS and WHITEBOARDS, and nothing else.
 *
 * A terminal is not persisted because a pty dies with the process that owned it — a revived
 * terminal tab is a prompt with no shell behind it, a lie the user only discovers by typing into
 * it. `dirty` goes for the same reason: an unsaved buffer does not survive either, so a dot
 * claiming pending edits after a restart would point at nothing. The conversation is not
 * persisted because it is derived — the room you open at boot IS tab one.
 *
 * A REVIEW is not persisted for the sharper version of the same reason: its bytes came from the
 * thread, and its GATE moves. A tab restored a day later would offer a verdict on a round that was
 * approved overnight — the one failure the model exists to prevent (docs/36 §13).
 *
 * A WHITEBOARD persists because its scene is a synced row, not process state — the tab record
 * carries only the board id and rehydrates from the replica, so a revived board is never a lie
 * the way a revived pty is (docs/38).
 */
export function serializeTabs(tabs: WTab[]): WTab[] {
  return tabs.filter((t) => t.kind === 'file' || t.kind === 'browser' || t.kind === 'whiteboard').map(({ dirty, ...kept }) => kept);
}

/**
 * Read a persisted tab set back. Anything that is not a file or a browser is dropped on the way
 * IN as well as out, so a record left by an older or newer build cannot resurrect a dead pty.
 * A stored `readOnly` tab in edit mode lands on preview: the invariant belongs to the model, and
 * a hand-edited store is its third door.
 *
 * Nothing here throws — a store that cannot be read costs you your tabs, never your boot.
 */
export function reviveTabs(raw: unknown): WTab[] {
  const out: WTab[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  const boards = new Set<string>();
  for (const row of rows(raw)) {
    const id = str(row.id);
    const kind = row.kind;
    if (!id || ids.has(id)) continue;
    if (kind !== 'file' && kind !== 'browser' && kind !== 'whiteboard') continue;
    const path = str(row.path);
    if (path && paths.has(path)) continue; // one file is one tab, at boot too
    const whiteboardId = str(row.whiteboardId);
    if (kind === 'whiteboard') {
      if (!whiteboardId) continue; // a board tab with no board is a blank pane — drop it
      if (boards.has(whiteboardId)) continue; // one board is one tab, at boot too
      boards.add(whiteboardId);
    }
    const readOnly = row.readOnly === true;
    const mode = MODES.find((m) => m === row.mode);
    ids.add(id);
    if (path) paths.add(path);
    out.push({
      id,
      kind,
      title: titleFor(str(row.title), path, str(row.url)),
      subtitle: str(row.subtitle),
      path,
      root: str(row.root),
      taskNumber: num(row.taskNumber),
      url: str(row.url),
      artifactId: str(row.artifactId),
      whiteboardId,
      readOnly,
      // clamp to `source`, not `preview`: the nearest legal view of the same bytes
      mode: readOnly && mode === 'edit' ? 'source' : mode,
    });
  }
  return out;
}

/**
 * The bottom dock's tabs, promoted upward: localStorage['nm:dockTabs'] read exactly as App.tsx
 * reads it — including the legacy `kind`→`mode` and `rootPath`→`cwdRoot` renames, and its
 * fallback that an unrecognized record is a terminal — so a user's open tabs survive the upgrade
 * instead of vanishing on first launch.
 *
 * A dock EDITOR tab was bound to a folder rather than a file (its tree lived inside the tab), so
 * it becomes a file tab with no path: a pane opened on that root. `startupCommand` is
 * deliberately not carried — it always meant "spawn a fresh pty running this", so keeping it
 * would re-run, on upgrade, a command the user ran once.
 *
 * This is a translation, not a policy: it maps every dock tab it is given, terminals included.
 * What is worth persisting from here on is serializeTabs' business.
 */
export function migrateDockTabs(raw: unknown): WTab[] {
  const out: WTab[] = [];
  for (const row of rows(raw)) {
    const id = str(row.id);
    if (!id) continue;
    const mode = DOCK_MODES.find((m) => m === row.mode) ?? (row.kind === 'editor' ? 'editor' : 'terminal');
    const root = str(row.cwdRoot) ?? str(row.rootPath);
    const url = str(row.url);
    const title = titleFor(str(row.title), null, url);
    const subtitle = str(row.rootLabel);
    if (mode === 'browser') out.push({ id, kind: 'browser', title, subtitle, url });
    else if (mode === 'editor') out.push({ id, kind: 'file', title, subtitle, path: null, root, taskNumber: num(row.taskNumber) });
    else out.push({ id, kind: 'terminal', title, subtitle, root, taskNumber: num(row.taskNumber) });
  }
  return out;
}

const MODES: WTabMode[] = ['source', 'edit', 'preview', 'diff'];
const DOCK_MODES = ['terminal', 'editor', 'browser'] as const;

/** the raw store, whether it arrives as the localStorage string or already parsed */
function rows(raw: unknown): Array<Record<string, unknown>> {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : [];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** a titleless record still opens as something nameable rather than a blank tab */
const titleFor = (title: string | null, path: string | null, url: string | null): string =>
  title ?? (path ? path.split(/[\\/]/).pop() ?? path : null) ?? url ?? 'Untitled';
