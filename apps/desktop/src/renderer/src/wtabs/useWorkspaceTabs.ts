// The workspace tab strip's state and its openers (docs/36).
//
// ONE global tab set, per-tab scope — settled by the code rather than by argument: `nm:dockTabs`
// was already one flat array shared across every project, room and task, with each tab bound to
// a worktree by taskNumber. That model was kept and promoted. Every RULE lives in wtabs.ts; this
// is only the wiring, which is exactly why it can leave App(). Split out of App.tsx (track A5).
import { useRef, useState } from 'react';

import { activateTab, closeTab, migrateDockTabs, openTab, reviveTabs, serializeTabs, setMode, type WTab, type WTabMode } from '../wtabs';
import type { WDoc } from './filetree';
import type { RepoUI } from '../bridge/rows-board';
import type { ReviewArtifact, ReviewComment, ReviewMode, ReviewRound } from '../review-types';



export function useWorkspaceTabs(meta: { repos: RepoUI[] }) {
// ── the workspace tab strip (docs/36) — ONE global tab set, per-tab scope ──
// Settled by the code, not by argument: `nm:dockTabs` was already one flat global array shared
// across every project, room and task, while each tab bound to a worktree via `taskNumber`.
// That model is kept and promoted. Every RULE lives in `wtabs.ts`; this is only the wiring.
const [wtabs, setWtabs] = useState<WTab[]>(() => {
  try {
    const stored = localStorage.getItem('nm:workspaceTabs');
    // first boot after the upgrade: the dock's open tabs walk through the migration door rather
    // than vanishing. `nm:dockTabs` is left in place, unread, for one release (docs/36 §12).
    return stored === null ? migrateDockTabs(localStorage.getItem('nm:dockTabs')) : reviveTabs(stored);
  } catch { return []; }
});
const [wactive, setWactive] = useState<string | null>(null);
// the global key handler is registered once and must not re-bind per tab change, so it reads
// the set through a ref rather than closing over a snapshot of it
const wactiveRef = useRef<string | null>(null);
const wtabsRef = useRef<WTab[]>([]);
wactiveRef.current = wactive;
wtabsRef.current = wtabs;
const [subIdToTab, setSubIdToTab] = useState<Record<string, string>>({}); // pty subId → tab id, so the process tracker can name + close each terminal by its tab
// bytes that came from the THREAD rather than from disk (an artifact, a plan, a brief). Neither
// these nor the tabs showing them persist: there is no address to re-read them from at boot.
const [wdocs, setWdocs] = useState<Record<string, WDoc>>({});
// ── review tabs (docs/36 §13) ──
// Keyed by ARTIFACT id rather than by tab id, and deliberately so: RULING 4 says an unsent
// comment batch lives on the tab, and the reuse rule says one artifact is one tab — so keying on
// the artifact makes a re-open land on the batch you were already writing, instead of on a fresh
// tab record that happens to point at the same bytes. The BINDING is not stored: it is derived
// at render from the live task row, so a round approved by someone else while you are reading it
// loses its buttons in front of you rather than offering a verdict the server would reject.
const [wrevs, setWrevs] = useState<Record<string, { artifact: ReviewArtifact; rounds: ReviewRound[]; taskId: string; channelId: string; taskNumber: number }>>({});
const [wrcomments, setWrcomments] = useState<Record<string, ReviewComment[]>>({});
const [wrmodes, setWrmodes] = useState<Record<string, ReviewMode>>({});
const [wrbusy, setWrbusy] = useState<string | null>(null);
const [wrerr, setWrerr] = useState<Record<string, string>>({});
const wstartup = useRef<Record<string, string>>({}); // a pty's spawn-time command, read once at mount and never stored
// a layout preference is machine-local and never synced (the theme / nav-fold precedent,
// docs/33 §2), and it starts DISMISSED: a new thing that seizes 200px on first launch is a
// thing people learn to close rather than to use (docs/36 §4)
const [wpane, setWpane] = useState(() => localStorage.getItem('nm:wtabsPane') === '1');
const openWPane = (open: boolean) => { setWpane(open); try { localStorage.setItem('nm:wtabsPane', open ? '1' : '0'); } catch { /* private */ } };
const [wfind, setWfind] = useState(0); // ⌘P — bumped to focus the pane's finder
// the SIDE DOCK's fold (rail-ink round 3, 2026-09-04) — the tab strip's own column beside the
// sheet. Machine-local like `wpane`. It also unfolds itself when a tab comes to the front and
// folds when the last one closes (shell/sidedock-state.ts), so the stored value is only ever
// what the human last chose while tabs were open. The unread count and the peek that lived
// here retired with it: the conversation is the sheet now and is never hidden behind a tab.
const [dockOpen, setDockOpen] = useState(() => localStorage.getItem('nm:sideDock') === '1');
const openDock = (open: boolean) => { setDockOpen(open); try { localStorage.setItem('nm:sideDock', open ? '1' : '0'); } catch { /* private */ } };
// serializeTabs decides which KINDS survive a relaunch. The artifact filter beside it is not a
// second copy of that rule — it is a fact about where the bytes live.
const persistW = (next: WTab[]) => { try { localStorage.setItem('nm:workspaceTabs', JSON.stringify(serializeTabs(next.filter((t) => !t.artifactId)))); } catch { /* private */ } };
const openWTab = (spec: WTab, doc?: WDoc) => setWtabs((prev) => {
  const r = openTab(prev, spec);
  setWactive(r.activeId);
  if (doc && r.activeId) setWdocs((d) => ({ ...d, [r.activeId!]: doc }));
  persistW(r.tabs);
  return r.tabs;
});
// closing a terminal tab unmounts its TerminalView, whose cleanup closes the pty in the SAME
// action — no orphan process can outlive its tab (docs/36 §7)
const closeWTab = (id: string) => {
  // an unsent batch survives a tab SWITCH (ruling 4) and dies with a tab CLOSE — the same trade
  // the overlay and the design studio both make: closing is the deliberate act of dropping it
  const art = wtabsRef.current.find((t) => t.id === id && t.kind === 'review')?.artifactId;
  if (art) {
    setWrevs((r) => { const n = { ...r }; delete n[art]; return n; });
    setWrcomments((c) => { const n = { ...c }; delete n[art]; return n; });
    setWrmodes((m) => { const n = { ...m }; delete n[art]; return n; });
    setWrerr((e) => { const n = { ...e }; delete n[art]; return n; });
  }
  setWtabs((prev) => { const r = closeTab(prev, wactiveRef.current, id); setWactive(r.activeId); persistW(r.tabs); return r.tabs; });
  setWdocs((d) => { if (!d[id]) return d; const n = { ...d }; delete n[id]; return n; });
  setSubIdToTab((m) => Object.fromEntries(Object.entries(m).filter(([, tabId]) => tabId !== id)));
  delete wstartup.current[id];
};
const activateWTab = (id: string) => setWtabs((prev) => { const r = activateTab(prev, wactiveRef.current, id); setWactive(r.activeId); return r.tabs; });
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
  const spec: WTab = { id, kind: 'terminal', title: uniqueTitle(t.title), subtitle: t.cwdRoot ?? null, root: t.cwdRoot ?? null, taskNumber: t.taskNumber ?? null };
  // a startup command wants a FRESH pty, so it deliberately skips the reuse door rather than
  // being handed the shell that is already running in this worktree
  if (t.startupCommand) { wstartup.current[id] = t.startupCommand; setWtabs((prev) => [...prev, spec]); setWactive(id); return; }
  openWTab(spec);
};
// a plain "new terminal" launches cleanly in the project's local repo, else the user's home dir
// (empty root → the pty handler falls back to $HOME) — never a native folder dialog
const openDefaultTerminal = () => { const repo = (meta.repos || []).find((r) => r.provider === 'local' && r.local_path); openTermTab({ cwdRoot: repo?.local_path ?? '', title: repo?.name ?? '~' }); };
  return { activateWTab, closeWTab, dockOpen, openDefaultTerminal, openDock, openTermTab, openWPane, openWTab, patchWTab, setTabPty, setWTabDirty, setWTabMode, setWactive, setWfind, setWrbusy, setWrcomments, setWrerr, setWrevs, setWrmodes, setWtabs, subIdToTab, uniqueTitle, wactive, wactiveRef, wdocs, wfind, wpane, wrbusy, wrcomments, wrerr, wrevs, wrmodes, wstartup, wtabs, wtabsRef };
}
