// The workspace tab set's state and its openers (docs/36), scoped by session since the side-panel
// round (2026-10-03).
//
// ONE tab array, per-tab scope — settled by the code rather than by argument: `nm:dockTabs` was
// already one flat array shared across every project, room and task, with each tab bound to a
// worktree by taskNumber. That model was kept and promoted, and each tab now also names the
// SESSION that opened it (`owner`). The side panel shows one session's tabs, and each session
// remembers its own front tab. Every RULE lives in wtabs.ts and shell/panel-state.ts; this is only
// the wiring, which is exactly why it can leave App(). Split out of App.tsx (track A5).
import { useRef, useState } from 'react';

import { activateTab, closeTab, migrateDockTabs, openTab, reviveTabs, serializeTabs, setMode, type WTab, type WTabMode } from '../wtabs';
import { ownerSlot } from '../shell/panel-state';
import type { WDoc } from './filetree';
import type { RepoUI } from '../bridge/rows-board';
import type { ReviewComment, ReviewMode } from '../review-types';
import type { ReviewEntry } from '../review-round';

/** how a tab opens: in front (a click, the default), or BEHIND the front tab with a dot (an arrival that must not take the panel from you) */
/**
 * How an open lands. `behind`: the session keeps its front and the tab wears a dot. `auto`: the
 * panel opened it by itself (shell/arrivals.ts), not your click. `retitle`: a tab that is already
 * open takes the new title (a review family's tab names the version on stage).
 */
export type OpenHow = { behind?: boolean; auto?: boolean; retitle?: boolean };

export function useWorkspaceTabs(meta: { repos: RepoUI[] }, ownerRef: { readonly current: string | null }) {
  const [wtabs, setWtabs] = useState<WTab[]>(() => {
    try {
      const stored = localStorage.getItem('nm:workspaceTabs');
      // first boot after the docs/36 upgrade: the dock's open tabs walk through the migration door
      // rather than vanishing. `nm:dockTabs` is left in place, unread (docs/36 §12).
      return stored === null ? migrateDockTabs(localStorage.getItem('nm:dockTabs')) : reviveTabs(stored);
    } catch { return []; }
  });
  // `ownerRef` names the session in front: openers tag their tab with it, so a plan opened from a
  // task's thread belongs to that task's panel. A ref, because App derives the session further down
  // its render, and the key handler and async openers must read the session in front NOW.
  // each session's own front pick: a tab id, or `s:<key>` for one of the session's own tabs
  // (shell/panel-state.ts). The effective front is decided in App by `panelFront`, which also knows
  // the session's own tabs; this only remembers what was picked.
  const [fronts, setFronts] = useState<Record<string, string | null>>({});
  const frontsRef = useRef(fronts);
  frontsRef.current = fronts;
  const wtabsRef = useRef<WTab[]>([]);
  wtabsRef.current = wtabs;
  const setFront = (who: string | null, id: string | null) => setFronts((f) => (f[ownerSlot(who)] === id ? f : { ...f, [ownerSlot(who)]: id }));
  const frontOf = (who: string | null) => frontsRef.current[ownerSlot(who)] ?? null;
  const [subIdToTab, setSubIdToTab] = useState<Record<string, string>>({}); // pty subId → tab id, so the process tracker can name + close each terminal by its tab
  // bytes that came from the THREAD rather than from disk (an artifact, a plan, a brief). Neither
  // these nor the tabs showing them persist: there is no address to re-read them from at boot.
  const [wdocs, setWdocs] = useState<Record<string, WDoc>>({});
  // ── review tabs (docs/36 §13) ──
  // Keyed by ARTIFACT id rather than by tab id, and deliberately so: RULING 4 says an unsent
  // comment batch lives on the tab, and the reuse rule says one artifact is one tab in a session —
  // so keying on the artifact makes a re-open land on the batch you were already writing. The
  // BINDING is not stored: it is derived at render from the live task row, so a round approved by
  // someone else while you read it loses its buttons in front of you.
  //
  // A DESIGN ROUND is the one exception to "one artifact is one tab": its mockups share one tab,
  // keyed by the round (review-round.ts).
  const [wrevs, setWrevs] = useState<Record<string, ReviewEntry>>({});
  const [wrcomments, setWrcomments] = useState<Record<string, ReviewComment[]>>({});
  const [wrmodes, setWrmodes] = useState<Record<string, ReviewMode>>({});
  const [wrbusy, setWrbusy] = useState<string | null>(null);
  const [wrerr, setWrerr] = useState<Record<string, string>>({});
  const wstartup = useRef<Record<string, string>>({}); // a pty's spawn-time command, read once at mount and never stored
  const [wfind, setWfind] = useState(0); // ⌘P — bumped to focus the Files tab's finder
  // the SIDE PANEL's fold (rail-ink round 3, 2026-09-04; the one right panel since 2026-10-03).
  // Every load starts FOLDED, and the fold is never stored (George, 2026-10-05: the panel opens by
  // itself only for a new artifact in a conversation). A stored fold reopened the panel on every
  // load once anything had opened it, empty, over Home. `nm:sideDock` is left in place, unread.
  const [dockOpen, setDockOpen] = useState(false);
  const openDock = (open: boolean) => setDockOpen(open);
  // serializeTabs decides which KINDS survive a relaunch. The artifact filter beside it is not a
  // second copy of that rule — it is a fact about where the bytes live.
  const persistW = (next: WTab[]) => { try { localStorage.setItem('nm:workspaceTabs', JSON.stringify(serializeTabs(next.filter((t) => !t.artifactId)))); } catch { /* private */ } };
  const openWTab = (spec: WTab, doc?: WDoc, how: OpenHow = {}) => setWtabs((prev) => {
    const tagged: WTab = { ...spec, owner: spec.owner !== undefined ? spec.owner : ownerRef.current, ...(how.behind ? { fresh: true } : {}) };
    const r = openTab(prev, tagged);
    if (doc && r.activeId) setWdocs((d) => ({ ...d, [r.activeId!]: doc }));
    // in front, unless it arrived behind: then the session keeps its front and the tab wears a dot
    if (!how.behind) setFront(tagged.owner ?? null, r.activeId);
    // a re-open of a tab the session already has, arriving behind, re-earns its dot, and a retitle
    // renames it to what it shows now
    const next = r.tabs === prev && r.activeId && (how.behind || how.retitle)
      ? prev.map((t) => (t.id !== r.activeId ? t : {
        ...t,
        ...(how.behind && frontOf(t.owner ?? null) !== t.id ? { fresh: true } : {}),
        ...(how.retitle && t.title !== spec.title ? { title: spec.title } : {}),
      }))
      : r.tabs;
    persistW(next);
    return next;
  });
  // closing a terminal tab unmounts its TerminalView, whose cleanup closes the pty in the SAME
  // action — no orphan process can outlive its tab (docs/36 §7)
  const closeWTab = (id: string) => {
    const closing = wtabsRef.current.find((t) => t.id === id);
    if (!closing) return;
    const who = closing.owner ?? null;
    // an unsent batch survives a tab SWITCH (ruling 4) and dies with a tab CLOSE — unless the same
    // artifact is still open as a review in another session's panel, which keeps reading it
    const art = closing.kind === 'review' ? closing.artifactId : null;
    if (art && !wtabsRef.current.some((t) => t.id !== id && t.kind === 'review' && t.artifactId === art)) {
      setWrevs((r) => { const n = { ...r }; delete n[art]; return n; });
      setWrcomments((c) => { const n = { ...c }; delete n[art]; return n; });
      setWrmodes((m) => { const n = { ...m }; delete n[art]; return n; });
      setWrerr((e) => { const n = { ...e }; delete n[art]; return n; });
    }
    setWtabs((prev) => {
      const r = closeTab(prev, frontOf(who), id);
      // only the front's own session can lose its front; a session tab pick is never `id`
      if (frontOf(who) === id) setFront(who, r.activeId);
      persistW(r.tabs);
      return r.tabs;
    });
    setWdocs((d) => { if (!d[id]) return d; const n = { ...d }; delete n[id]; return n; });
    setSubIdToTab((m) => Object.fromEntries(Object.entries(m).filter(([, tabId]) => tabId !== id)));
    delete wstartup.current[id];
  };
  /** front a tab in its own session's panel, and drop its dot: you looked at it */
  const activateWTab = (id: string) => setWtabs((prev) => {
    const t = prev.find((x) => x.id === id);
    if (!t) return prev;
    const r = activateTab(prev, frontOf(t.owner ?? null), id);
    setFront(t.owner ?? null, r.activeId);
    return t.fresh ? prev.map((x) => (x.id === id ? { ...x, fresh: false } : x)) : prev;
  });
  const setWTabMode = (id: string, m: WTabMode) => setWtabs((prev) => setMode(prev, id, m));
  // `dirty` is never persisted — an unsaved buffer does not survive a restart, so a dot claiming
  // pending edits after one would point at nothing (docs/36 §3.6)
  const setWTabDirty = (id: string, dirty: boolean) => setWtabs((prev) => {
    const t = prev.find((x) => x.id === id);
    return !t || !!t.dirty === dirty ? prev : prev.map((x) => (x.id === id ? { ...x, dirty } : x));
  });
  // url + title land in the same tick when a page commits — patch functionally so the second
  // write can't clobber the first from a stale closure
  const patchWTab = (id: string, patch: (t: WTab) => Partial<WTab> | null) => setWtabs((prev) => {
    const t = prev.find((x) => x.id === id);
    const p = t && patch(t);
    if (!p) return prev;
    const next = prev.map((x) => (x.id === id ? { ...x, ...p } : x));
    persistW(next);
    return next;
  });
  const setTabPty = (tabId: string, subId: string) => setSubIdToTab((m) => (m[subId] === tabId ? m : { ...m, [subId]: tabId }));
  const uniqueTitle = (base: string) => { const taken = new Set(wtabs.map((x) => x.title)); if (!taken.has(base)) return base; let i = 2; while (taken.has(`${base} ${i}`)) i++; return `${base} ${i}`; };
  const openTermTab = (t: { taskNumber?: number; hasRepo?: boolean; cwdRoot?: string; title: string; startupCommand?: string }) => {
    const id = crypto.randomUUID();
    const spec: WTab = { id, kind: 'terminal', title: uniqueTitle(t.title), subtitle: t.cwdRoot ?? null, root: t.cwdRoot ?? null, taskNumber: t.taskNumber ?? null, owner: ownerRef.current };
    // a startup command wants a FRESH pty, so it deliberately skips the reuse door rather than
    // being handed the shell that is already running in this worktree
    if (t.startupCommand) { wstartup.current[id] = t.startupCommand; setWtabs((prev) => [...prev, spec]); setFront(spec.owner ?? null, id); return; }
    openWTab(spec);
  };
  // a plain "new terminal" launches cleanly in the project's local repo, else the user's home dir
  // (empty root → the pty handler falls back to $HOME) — never a native folder dialog
  const openDefaultTerminal = () => { const repo = (meta.repos || []).find((r) => r.provider === 'local' && r.local_path); openTermTab({ cwdRoot: repo?.local_path ?? '', title: repo?.name ?? '~' }); };
  return { activateWTab, closeWTab, dockOpen, frontOf, fronts, openDefaultTerminal, openDock, openTermTab, openWTab, patchWTab, setFront, setTabPty, setWTabDirty, setWTabMode, setWfind, setWrbusy, setWrcomments, setWrerr, setWrevs, setWrmodes, setWtabs, subIdToTab, uniqueTitle, wdocs, wfind, wrbusy, wrcomments, wrerr, wrevs, wrmodes, wstartup, wtabs, wtabsRef };
}
