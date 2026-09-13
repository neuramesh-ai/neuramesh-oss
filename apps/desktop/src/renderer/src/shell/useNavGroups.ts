// THE GROUPED RAIL's state (rail-ink round, 2026-09-04): which folders the human folded (persisted,
// `nm:navGroupFold`) and which they asked to show fully this session, plus the grouped list itself
// (navtree.navGrouped, pure + tested). A hook rather than shell state so App.tsx's ratchet holds.
import { useCallback, useMemo, useState } from 'react';
import { navGrouped, type NavGroupedResult, type NavTreeRowMeta } from '../navtree';

const FOLD_KEY = 'nm:navGroupFold';
function loadFold(): Set<string> {
  try { const v = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]'); return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []); } catch { return new Set(); }
}

export function useNavGroups<R extends NavTreeRowMeta & { engineeringSessionId?: string | null; task?: { id: string } | null; threadId?: string | null }>(opts: {
  /** the mode's predicate (navtree.isChatRow / isCodeRow) — BOTH modes fold by project */
  filter: (r: R) => boolean;
  rows: R[];
  channels: Array<{ id: string; project_id: string | null; slug?: string; msg_count?: number }>;
  projects: Array<{ id: string; name: string; logo_url?: string | null }>;
  /** task + thread ids holding an ask / an open run — keyed onto rows here */
  askIds: Set<string>;
  liveIds: Set<string>;
}): { groups: NavGroupedResult<R>; toggleFold: (pid: string) => void; showMore: (pid: string) => void; projectRooms: Map<string, string[]>;
  /** the folders' memory, so a band on another connection (shell/useNavBands.ts) folds with the same one */
  folded: Set<string>; expanded: Set<string> } {
  const [folded, setFolded] = useState<Set<string>>(loadFold);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleFold = useCallback((pid: string) => {
    setFolded((prev) => { const next = new Set(prev); if (next.has(pid)) next.delete(pid); else next.add(pid); try { localStorage.setItem(FOLD_KEY, JSON.stringify([...next])); } catch { /* private mode */ } return next; });
  }, []);
  const showMore = useCallback((pid: string) => setExpanded((prev) => new Set(prev).add(pid)), []);
  const keyed = (pick: Set<string>) => new Set(opts.rows.filter((r) => (r.task && pick.has(r.task.id)) || (r.threadId && pick.has(r.threadId))).map((r) => r.key));
  const groups = useMemo(() => navGrouped({ rows: opts.rows, filter: opts.filter, channels: opts.channels, projects: opts.projects, askKeys: keyed(opts.askIds), liveKeys: keyed(opts.liveIds), folded, expanded }),
    [opts.filter, opts.rows, opts.channels, opts.projects, opts.askIds, opts.liveIds, folded, expanded]); // eslint-disable-line react-hooks/exhaustive-deps
  // the folder's hover card names the project's rooms
  const projectRooms = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of opts.channels) if (c.project_id) (m.get(c.project_id) ?? m.set(c.project_id, []).get(c.project_id)!).push(c.slug ?? '');
    return m;
  }, [opts.channels]);
  return { groups, toggleFold, showMore, projectRooms, folded, expanded };
}
