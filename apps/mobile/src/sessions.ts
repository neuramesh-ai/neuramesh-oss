// THE SESSION LIST, DERIVED (docs/35; the mobile-cloud round S3): every conversation and every
// bare task in the workspace, through the SHARED historyRows/sessionGroups — the same derivation
// the desktop's rail runs, so a row that exists on the Mac exists on the phone. Liveness is the
// ONE signal, open `runs` (docs/29 §10), registered under a child's parent and origin thread by
// liveKinOf; the ask pulse is an open decision card in that session. Home and History both call
// this; neither owns a row rule of its own.
import { AGENTS_FOR_WORKSPACE, OPEN_DECISIONS_FOR_WORKSPACE, OPEN_RUNS_FOR_WORKSPACE, SESSION_TASKS_FOR_WORKSPACE, SESSION_THREADS_FOR_WORKSPACE, type QueueDecision } from '@neuramesh/client-core';
import { historyRows, liveKinOf, plainTitle, sessionGroups, type HistoryRow, type HistoryTask, type HistoryThread, type SessionBucket, type ThreadStatus } from '@neuramesh/shared';
import { useQuery } from '@powersync/react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hasMoreSessions, SESSION_MAX_PAGES, SESSION_PAGE } from './session-page';
import { cardIndex, countStatuses, ownedIndex, rowStatus, type ThreadMeta } from './session-status';

export interface SessionThreadRow extends HistoryThread {
  channel_id: string;
  channel_slug: string;
  machine_id: string | null;
  origin: string | null;
  mode: string | null;
  /** the status inputs (shared/threadstatus.ts): the settle stamp, who spoke last and when */
  settled_at: string | null;
  last_author_kind: string | null;
  last_at: string | null;
}
export interface SessionTaskRow extends HistoryTask {
  state: string;
  kind: string | null;
  pr_number: number | null;
  plan_approved_at: string | null;
  last_human_msg_at: string | null;
}
export interface OpenRun { id: string; thread_id: string | null; task_id: string | null; agent_id: string | null; kind: string; step: string | null; done: number | null; total: number | null; machine_id: string | null; started_at: string | null }
export interface AgentLite { id: string; name: string; role: string; emoji: string | null; status: string; machine_id: string | null }

export type SessionRowData = HistoryRow<SessionTaskRow> & {
  live: OpenRun | null;
  /** the agent working the live run, for the snippet */
  liveAgent: AgentLite | null;
  ask: boolean;
  /** the three words a thread can wear (shared/threadstatus.ts), and why it needs you when it does */
  status: ThreadStatus;
  why: string | null;
  settledAt: string | null;
};

export interface Sessions {
  rows: SessionRowData[];
  groups: Array<{ label: SessionBucket; rows: SessionRowData[] }>;
  agents: AgentLite[];
  decisions: QueueDecision[];
  ready: boolean;
  /** another page waits behind this one */
  hasMore: boolean;
  /** how many rows this list holds now — the footer says it out loud */
  shown: number;
  /** every loaded row by status, before the status filter — the filter's counts */
  counts: Record<ThreadStatus, number>;
  /** ask for the next page; safe to call again while one is in flight */
  loadMore: () => void;
}

/** Hold the last answer a watched query gave, so a re-run never shows an empty list on the way to
 *  a fuller one. `undefined` means "no answer yet", which is true only before the first one. */
function useKeep<T>(data: T[] | undefined): T[] | undefined {
  const kept = useRef<T[] | undefined>(undefined);
  if (data !== undefined) kept.current = data;
  return kept.current;
}

// the page size and the "is there more" rule live in session-page.ts, where a test can import them
// without pulling PowerSync's React Native binding into a Node runner
export { hasMoreSessions, SESSION_MAX_PAGES, SESSION_PAGE } from './session-page';

/** `channelId` narrows to a room; `projectId` to a project's rooms (History's chips); `query` searches.
 *  `pageSize` sets how many sessions the first page holds — `loadMore()` adds another page, and the
 *  QUERIES grow with it, so the replica is never asked for rows nobody has scrolled to. */
export function useSessions(ws: string | null, opts: { query?: string; channelId?: string | null; channelIds?: Set<string> | null; pageSize?: number; status?: ThreadStatus | null; settledLocally?: Map<string, string> } = {}): Sessions {
  const pageSize = opts.pageSize ?? SESSION_PAGE;
  const [page, setPage] = useState(1);
  // one more than the page needs, so a full list is the proof that another page exists
  const asked = page * pageSize + 1;
  // a narrowed list (a room, a search) filters in JS, so it asks for more rows to fill its page
  const wide = opts.channelIds || opts.channelId || opts.query ? 4 : 1;
  const { data: liveThreads } = useQuery<SessionThreadRow>(SESSION_THREADS_FOR_WORKSPACE, [ws ?? '', asked * wide]);
  const { data: liveTasks } = useQuery<SessionTaskRow>(SESSION_TASKS_FOR_WORKSPACE, [ws ?? '', asked * wide]);
  // A PAGE ARRIVES OVER A LIST, IT DOES NOT REPLACE IT. Changing a watched query's parameters makes
  // PowerSync re-run it, and the hook reports `undefined` until the new answer lands — so asking for
  // page two emptied the list for a beat and the reader fell into blank space, which is the very
  // symptom this round is fixing. The last answer stands until the next one is here.
  const threads = useKeep(liveThreads);
  const tasks = useKeep(liveTasks);
  const { data: runs } = useQuery<OpenRun>(OPEN_RUNS_FOR_WORKSPACE, [ws ?? '']);
  const { data: decisions } = useQuery<QueueDecision>(OPEN_DECISIONS_FOR_WORKSPACE, [ws ?? '']);
  const { data: agents } = useQuery<AgentLite>(AGENTS_FOR_WORKSPACE, [ws ?? '']);
  const query = opts.query ?? '';
  const channelId = opts.channelId ?? null;
  const channelIds = opts.channelIds ?? null;
  const status = opts.status ?? null;
  const settledLocally = opts.settledLocally;
  const limit = page * pageSize;
  // a new workspace, room or search starts at page one: keeping a deep page would ask the replica
  // for rows the person has not scrolled to in THIS list. The rooms are keyed by their CONTENT, not
  // the Set's identity, so a re-render that rebuilds the set cannot reset the page under a reader.
  const roomKey = channelIds ? [...channelIds].sort().join(',') : '';
  useEffect(() => { setPage(1); }, [ws, channelId, query, roomKey]);
  const loadMore = useCallback(() => setPage((p) => Math.min(p + 1, SESSION_MAX_PAGES)), []);

  return useMemo(() => {
    const th = (threads ?? []).filter((t) => !channelIds || channelIds.has(t.channel_id));
    const tk = (tasks ?? []).filter((t) => !channelIds || channelIds.has(t.channel_id));
    const base = historyRows<SessionTaskRow>({ threads: th, tasks: tk, channelId, channelSlug: '', query, limit });
    // liveness: a run under a thread, a task, or (liveKinOf) the parent and origin thread of its task
    const kin = liveKinOf(tk.map((t) => ({ id: t.id, parent_task_id: t.parent_task_id, origin_thread_id: t.origin_thread_id })));
    const liveByKey = new Map<string, OpenRun>();
    for (const r of runs ?? []) {
      if (r.thread_id) liveByKey.set(`th:${r.thread_id}`, r);
      if (r.task_id) {
        liveByKey.set(`tk:${r.task_id}`, r);
        for (const k of kin(r.task_id)) { liveByKey.set(`tk:${k}`, r); liveByKey.set(`th:${k}`, r); }
      }
    }
    const askThreads = new Set((decisions ?? []).map((d) => d.thread_id).filter(Boolean));
    const askTasks = new Set((decisions ?? []).map((d) => d.task_id).filter(Boolean));
    const agentById = new Map((agents ?? []).map((a) => [a.id, a]));
    // the status inputs, indexed once: the newest open card per session, each thread's stamp and last speaker
    const ctx = { ...cardIndex(decisions ?? []), threadMeta: new Map<string, ThreadMeta>(th.map((t) => [t.id, t])), ownedByThread: ownedIndex(tk), settledLocally, agentName: (id: string) => agentById.get(id)?.name ?? null };
    const all: SessionRowData[] = base.map((r) => {
      const live = (r.threadId ? liveByKey.get(`th:${r.threadId}`) : null) ?? (r.task ? liveByKey.get(`tk:${r.task.id}`) : null) ?? null;
      const ask = (!!r.threadId && askThreads.has(r.threadId)) || (!!r.task && askTasks.has(r.task.id));
      return { ...r, live, liveAgent: live?.agent_id ? agentById.get(live.agent_id) ?? null : null, ask, ...rowStatus(r, !!live, ctx) };
    });
    // the counts read the whole page; the filter narrows what is shown (one derivation, one list)
    const counts = countStatuses(all);
    const rows = status ? all.filter((r) => r.status === status) : all;
    // sessionGroups keeps the row objects it is handed, so the liveness fields ride through the buckets
    const groups = sessionGroups(rows, Date.now()).map((g) => ({ label: g.label, rows: g.rows as SessionRowData[] }));
    const more = page < SESSION_MAX_PAGES && hasMoreSessions({ threads: (threads ?? []).length, tasks: (tasks ?? []).length, asked: asked * wide });
    return {
      rows, groups, agents: agents ?? [], decisions: decisions ?? [],
      ready: threads !== undefined && tasks !== undefined,
      hasMore: more, shown: rows.length, counts, loadMore,
    };
  }, [threads, tasks, runs, decisions, agents, query, channelId, channelIds, limit, asked, wide, page, loadMore, status, settledLocally]);
}

/** a row's line, plain: presentation markdown out (plainTitle), and a LEADING emoji dropped — the row's
 *  glyph already says what kind of session this is (a routine's ⏱ title would say it twice) */
export function cleanLine(s: string): string {
  // a guillemet marker (‹task:id› · ‹wb:id› · ‹gen-image:…›) is a card for a renderer, not a word for a row
  return plainTitle(s).replace(/‹[^›]*›/g, ' ').replace(/^[\s\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{1F300}-\u{1FAFF}\u{FE0F}\u{200D}]+/u, '').replace(/\s+/g, ' ').trim();
}

/** the row's snippet: a live run says who and what; else the thread's last line */
export function rowSnip(r: SessionRowData): { text: string; mono: boolean } {
  if (r.live) {
    const who = r.liveAgent?.name ?? 'an agent';
    const step = r.live.step?.trim() || (r.live.kind === 'chat' ? 'thinking' : 'working');
    const count = r.live.total ? ` · ${r.live.done ?? 0}/${r.live.total}` : '';
    return { text: `${who} · ${step}${count}`, mono: false };
  }
  if (r.branch) return { text: `⎇ ${r.branch}`, mono: true };
  return { text: cleanLine(r.snip.split('\n')[0] ?? ''), mono: false };
}

/** how the row's kind reads: a routine's run, a task, a chat */
export function rowKind(r: SessionRowData): 'task' | 'chat' | 'routine' {
  if (r.task) return 'task';
  if (r.scheduleId) return 'routine';
  return 'chat';
}
