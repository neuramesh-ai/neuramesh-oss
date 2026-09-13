// THE CONNECTION BANDS' state (U3b, the source-release round — artboards B0 to B2).
//
// The shell stands in ONE connection; its rows reach App through the four workspace-wide watches
// every surface reads. Every OTHER live connection streams through the rail's union
// (`nm:watch-rail-rows`, main/sync/ipc/rail-rows.ts): threads, tasks, runs, decisions, channels,
// projects and agents, each row tagged. This hook turns that union into rail rows with the SAME
// derivations the foreground's rows go through — `historyRows` for the row, `isAskTask` /
// `isAskDecision` for the ask, the open runs for the pulse, `makeRowMarks` for the status word,
// `navGrouped` for the folders — then `navBands` groups foreground and background rows under
// LOCAL and CLOUD. One connection: the union is empty, `bands` is null, the rail is today's.
//
// Fold state persists per machine as `nm:navBandFold`, beside the folders' `nm:navGroupFold`.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { historyRows, liveKinOf } from '@neuramesh/shared';
import { nm, type ConnectionSummary, type RailRowsPayload } from '../bridge/nm';
import type { TaskAllRow } from '../bridge/rows-board';
import { navGrouped, type NavFlatRowMeta, type NavGroupedResult, type NavTreeRowMeta } from '../navtree';
import { navBands, type NavBand, type NavConnTag, type NavConnection } from '../navbands';
export type { NavConnTag } from '../navbands';
import { isAskDecision, isAskTask } from './asks';
import { makeRowMarks, type RowMarks } from './rowstatus';

const FOLD_KEY = 'nm:navBandFold';
function loadFold(): Set<string> {
  try { const v = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]'); return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []); } catch { return new Set(); }
}

const EMPTY: RailRowsPayload = { threads: [], tasks: [], runs: [], decisions: [], channels: [], projects: [], agents: [] };

/** a band as the rail draws it: navBands' band, its rows decorated like the flat list's (project name ·
 *  logo for the hover card), plus its folders for the Projects view */
export type RailBand<R> = Omit<NavBand<R>, 'rows'> & { rows: Array<R & NavFlatRowMeta>; groups: NavGroupedResult<R> };

type RowLike = NavTreeRowMeta & NavConnTag & { task?: { id: string } | null; threadId?: string | null; engineeringSessionId?: string | null };

export function useNavBands<R extends RowLike>(opts: {
  authed: boolean;
  /** the connections this launch holds, and the one the shell stands in */
  connections: ConnectionSummary[];
  foregroundId: string | null;
  /** the FOREGROUND's rows (App's histTreeRows) and the mode's predicate */
  rows: R[];
  filter: (r: R) => boolean;
  /** the foreground's rooms and projects — the union carries the others' */
  channels: Array<{ id: string; project_id: string | null; slug?: string; msg_count?: number }>;
  projects: Array<{ id: string; name: string; logo_url?: string | null }>;
  /** the foreground's ask and live ids — the union's are derived here the same way */
  askIds: Set<string>;
  liveIds: Set<string>;
  /** the folders' memory (shell/useNavGroups.ts), so a band's folders fold with it */
  groupFold: { folded: Set<string>; expanded: Set<string> };
}): {
  bands: Array<RailBand<R>> | null;
  toggleFold: (connectionId: string) => void;
  /** the status word for a row on another connection, from that connection's own rows */
  marksOf: (r: { task: TaskAllRow | null; threadId: string | null } & NavConnTag) => RowMarks | null;
  /** the rows of every other connection, tagged — the rail's list is the union of both lanes */
  background: R[];
  /** the connections a band is drawn for, in the rail's order */
  live: boolean;
} {
  const [folded, setFolded] = useState<Set<string>>(loadFold);
  const toggleFold = useCallback((id: string) => {
    setFolded((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); try { localStorage.setItem(FOLD_KEY, JSON.stringify([...next])); } catch { /* private mode */ } return next; });
  }, []);

  // the union: every other live connection's row-sets, one subscription
  const [union, setUnion] = useState<RailRowsPayload>(EMPTY);
  useEffect(() => {
    if (!opts.authed || !nm?.watchRailRows) return;
    return nm.watchRailRows((p) => setUnion({ ...EMPTY, ...p }));
  }, [opts.authed]);

  // per connection: the rows, and the ask / live ids that connection's own runs and cards produce
  const derived = useMemo(() => {
    const ids = [...new Set(union.threads.map((t) => t.connectionId).concat(union.tasks.map((t) => t.connectionId)))];
    const rows: R[] = [];
    const askIds = new Set<string>();
    const liveIds = new Set<string>();
    const marks = new Map<string, (r: { task: TaskAllRow | null; threadId: string | null }) => RowMarks>();
    for (const id of ids) {
      const kind = union.threads.find((t) => t.connectionId === id)?.connectionKind ?? union.tasks.find((t) => t.connectionId === id)!.connectionKind;
      const threads = union.threads.filter((t) => t.connectionId === id);
      const tasks = union.tasks.filter((t) => t.connectionId === id);
      const runs = union.runs.filter((r) => r.connectionId === id);
      const decisions = union.decisions.filter((d) => d.connectionId === id);
      const agents = union.agents.filter((a) => a.connectionId === id);
      const kin = liveKinOf(tasks);
      const live = new Set(runs.filter((r) => r.state === 'running').flatMap((r) => [...(r.task_id ? [r.task_id, ...kin(r.task_id)] : []), ...(r.thread_id ? [r.thread_id] : [])]));
      for (const x of live) liveIds.add(x);
      for (const t of tasks) if (isAskTask(t, agents)) askIds.add(t.id);
      for (const d of decisions) if (isAskDecision(d)) { if (d.task_id) askIds.add(d.task_id); else if (d.thread_id) askIds.add(d.thread_id); }
      marks.set(id, makeRowMarks({ decisions, liveIds: live, threads, tasks }));
      // the SAME builder the foreground's rows go through (shared/sessions.ts) — one row shape, two lanes
      for (const r of historyRows({ threads, tasks, channelId: null, channelSlug: '', query: '' })) rows.push({ ...r, connectionId: id, connectionKind: kind, foreign: true } as unknown as R);
    }
    return { rows, askIds, liveIds, marks };
  }, [union]);

  const marksOf = useCallback((r: { task: TaskAllRow | null; threadId: string | null } & NavConnTag): RowMarks | null => {
    const m = r.connectionId ? derived.marks.get(r.connectionId) : undefined;
    return m ? m(r) : null;
  }, [derived]);

  const bands = useMemo((): Array<RailBand<R>> | null => {
    if (!opts.foregroundId || opts.connections.length < 2) return null;
    // one recency across both lanes — a band lists newest first whichever backend the rows came from
    const all = [...opts.rows, ...derived.rows].filter(opts.filter).sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
    const askIds = new Set([...opts.askIds, ...derived.askIds]);
    const liveIds = new Set([...opts.liveIds, ...derived.liveIds]);
    const keyed = (pick: Set<string>) => new Set(all.filter((r) => (r.task && pick.has(r.task.id)) || (r.threadId && pick.has(r.threadId))).map((r) => r.key));
    const askKeys = keyed(askIds);
    const liveKeys = keyed(liveIds);
    const conns: NavConnection[] = opts.connections.map((c) => ({ id: c.id, kind: c.kind, host: c.host, workspaceId: c.workspaceId }));
    const grouped = navBands({ rows: all, connections: conns, foregroundId: opts.foregroundId, askKeys, liveKeys, folded });
    if (!grouped) return null;
    return grouped.map((b) => {
      // a band's folders come from ITS connection's rooms and projects — the foreground's from
      // App's lists, another connection's from the union
      const own = b.id === opts.foregroundId;
      const channels = own ? opts.channels : union.channels.filter((c) => c.connectionId === b.id);
      const projects = own ? opts.projects : union.projects.filter((p) => p.connectionId === b.id && p.status !== 'archived');
      // the FULL set of the band's rows, not the folded-away empty list: a folded band's folders
      // still count so the head's folder tally tells the truth
      const rows = all.filter((r) => (r.connectionId && conns.some((c) => c.id === r.connectionId) ? r.connectionId : opts.foregroundId) === b.id);
      const projectOf = new Map(channels.map((c) => [c.id, c.project_id]));
      const byId = new Map(projects.map((p) => [p.id, p]));
      const decorate = (r: R): R & NavFlatRowMeta => {
        const pid = r.channelId ? projectOf.get(r.channelId) ?? null : null;
        const p = pid ? byId.get(pid) : null;
        return { ...r, projectId: pid, projectName: p?.name ?? null, projectLogo: p?.logo_url ?? null };
      };
      return { ...b, rows: b.rows.map(decorate), groups: navGrouped({ rows, channels, projects, askKeys, liveKeys, folded: opts.groupFold.folded, expanded: opts.groupFold.expanded }) };
    });
  }, [opts.foregroundId, opts.connections, opts.rows, derived, opts.filter, opts.askIds, opts.liveIds, opts.channels, opts.projects, opts.groupFold.folded, opts.groupFold.expanded, folded, union.channels, union.projects]);

  return { bands, toggleFold, marksOf, background: derived.rows, live: opts.connections.length > 1 };
}
