// THE ROUTINE WRITER (docs/design/routine-writer-2026-10/plan.md): a person schedules the routine rex wrote
// in a session, and the routine runs in that session from then on. Inside the schedule's own transaction the
// store links the session (threads.schedule_id, only while it holds no routine: the race guard under the
// handler's checks, so two clicks can never arm two routines into one session) and posts the divider there
// as the person who scheduled it. The session takes the routine's title while nobody named it, the rule a
// run's session follows (session-title.ts). The memory store mirrors this in createSchedule.
import { ROUTINE_SCHEDULED_MARKER, type NMEvent } from '@neuramesh/shared';
import type postgres from 'postgres';
import { DomainError } from '../errors';
import { sessionTitle } from './session-title';
import type { NMMessage, ScheduleInput } from './types';

export const ROUTINE_TAKEN = 'This session already holds a routine. Open a new session for another one.';

export async function linkRoutineSessionSql(
  sql: postgres.Sql, ws: string, scheduleId: string, input: ScheduleInput,
  insertEvent: (sql: postgres.Sql, event: NMEvent) => Promise<unknown>,
): Promise<void> {
  const s = input.session;
  if (!s) return;
  const [th] = await sql<Array<{ id: string }>>`update threads
      set schedule_id = ${scheduleId}::uuid, updated_at = now(),
          title = case when titled_at is null then ${sessionTitle(input.title, input.title)} else title end
    where id = ${s.threadId}::uuid and workspace_id = ${ws}::uuid and channel_id = ${input.channelId}::uuid
      and schedule_id is null and task_id is null and coalesce(kind, 'chat') <> 'coding'
    returning id`;
  if (!th) throw new DomainError('THREAD_HAS_ROUTINE', ROUTINE_TAKEN);
  await sql`insert into messages (id, workspace_id, channel_id, task_id, thread_id, author_kind, author_id, body, reply_to, schedule_id)
    values (${s.dividerId}, ${ws}::uuid, ${input.channelId}, null, ${s.threadId}, ${s.author.kind}::actor_kind, ${s.author.id}::uuid, ${ROUTINE_SCHEDULED_MARKER}, null, null)`;
  await insertEvent(sql, s.makeEvent(ws));
}

type MemThread = { id: string; workspace: string; channel: string; title: string; taskId: string | null; kind?: string; scheduleId?: string | null; titledAt?: string | null };

/** the memory store's twin: it refuses before anything is written, and hands back the writes to run once the schedule exists */
export function routineSessionMem(w: { threads: MemThread[]; messages: NMMessage[]; events: NMEvent[] }, ws: string, input: ScheduleInput): ((scheduleId: string) => void) | null {
  const s = input.session;
  if (!s) return null;
  const th = w.threads.find((x) => x.id === s.threadId && x.workspace === ws && x.channel === input.channelId);
  if (!th || th.scheduleId || th.taskId || th.kind === 'coding') throw new DomainError('THREAD_HAS_ROUTINE', ROUTINE_TAKEN);
  return (scheduleId) => {
    th.scheduleId = scheduleId;
    if (!th.titledAt) th.title = sessionTitle(input.title, input.title);
    w.messages.push({ id: s.dividerId, workspace: ws, channel: input.channelId, taskId: null, threadId: s.threadId, author: s.author, body: ROUTINE_SCHEDULED_MARKER, createdAt: new Date().toISOString(), scheduleId: null });
    w.events.push(s.makeEvent(ws));
  };
}
