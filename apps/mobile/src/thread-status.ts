// A THREAD'S STATUS FOR ITS OWN HEAD (the thread-status round): the same derivation the rows use
// (shared/threadstatus.ts, session-status.ts), fed from the one thread on screen. The thread screen
// asks by thread id; the task screen asks by task id and finds the task's thread (thread-per-task).
import { OPEN_DECISIONS_FOR_WORKSPACE, OPEN_RUNS_FOR_WORKSPACE, type QueueDecision } from '@neuramesh/client-core';
import { threadStatus, type StatusTask, type ThreadStatus } from '@neuramesh/shared';
import { useQuery } from '@powersync/react-native';
import { useCallback } from 'react';
import type { OpenRun } from './sessions';
import { useSettle, type Undo } from './settle';
import { laterOf } from './settle-rules';

interface ThreadMetaRow { id: string; workspace_id: string; task_id: string | null; title: string | null; settled_at: string | null; last_author_kind: string | null; last_at: string | null }
const META = `select t.id, t.workspace_id, t.task_id, t.title, t.settled_at,
  (select m.author_kind from messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_author_kind,
  (select max(m.created_at) from messages m where m.thread_id = t.id) as last_at
  from threads t`;
const TASK_COLS = `id, state, kind, pr_number, plan_approved_at, updated_at, parent_task_id,
  (select max(m.created_at) from messages m where m.task_id = tasks.id and m.author_kind = 'human') as last_human_msg_at`;
const TASK = `select ${TASK_COLS} from tasks where id = ? limit 1`;
// the units this conversation OWNS (docs/41): their gates show on the owner, so the head must read them too
const OWNED = `select ${TASK_COLS} from tasks where origin_thread_id = ? and parent_task_id is null order by updated_at desc limit 20`;

export interface HeadStatus {
  status: ThreadStatus;
  threadId: string | null;
  undo: Undo | null;
  settle: (title: string) => Promise<void>;
  unsettle: () => Promise<void>;
}

export function useThreadStatus(i: { threadId?: string | null; taskId?: string | null }): HeadStatus {
  const { data: byThread } = useQuery<ThreadMetaRow>(`${META} where t.id = ? limit 1`, [i.threadId ?? '']);
  const { data: byTask } = useQuery<ThreadMetaRow>(`${META} where t.task_id = ? order by t.created_at limit 1`, [i.taskId ?? '']);
  const thread = (i.threadId ? byThread?.[0] : byTask?.[0]) ?? null;
  const taskId = i.taskId ?? thread?.task_id ?? null;
  const { data: tasks } = useQuery<StatusTask & { id: string }>(TASK, [taskId ?? '']);
  const { data: owned } = useQuery<StatusTask & { id: string }>(OWNED, [thread?.id ?? '']);
  const ws = thread?.workspace_id ?? '';
  const { data: decisions } = useQuery<QueueDecision>(OPEN_DECISIONS_FOR_WORKSPACE, [ws]);
  const { data: runs } = useQuery<OpenRun>(OPEN_RUNS_FOR_WORKSPACE, [ws]);
  const { local, undo, settle, unsettle } = useSettle(ws || null);
  const threadId = thread?.id ?? null;
  const card = (decisions ?? []).find((d) => (!!taskId && d.task_id === taskId) || (!!threadId && d.thread_id === threadId)) ?? null;
  const live = (runs ?? []).some((r) => (!!taskId && r.task_id === taskId) || (!!threadId && r.thread_id === threadId));
  const settledAt = laterOf(thread?.settled_at ?? null, threadId ? local.get(threadId) ?? null : null);
  const status = threadStatus({
    task: tasks?.[0] ?? null,
    card: card ? { ...card, status: 'open' } : null,
    live,
    lastAuthorKind: thread?.last_author_kind ?? null,
    lastAt: thread?.last_at ?? null,
    settledAt,
    owned: owned ?? [],
  });
  const settleHere = useCallback(async (title: string) => { if (threadId) await settle(threadId, title); }, [settle, threadId]);
  return { status, threadId, undo, settle: settleHere, unsettle };
}
