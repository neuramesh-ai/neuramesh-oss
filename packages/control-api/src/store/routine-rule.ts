// routine or content: the two kinds of schedule that open a session (George, 2026-09-27).
//
// a ROUTINE runs with no person in the loop, so a unit born in its session passes its gates by
// itself: the birth stamp (handler/createtask.ts) and the plan, design and accept follow-ups
// (handler/planfollowup.ts). a CONTENT schedule drafts a post, and a draft always waits for a person,
// so a unit born in its session keeps every gate a person's conversation has. the session keeps its
// schedule id either way: the rail clock and the Automations run list read it.
//
// the test is @neuramesh/shared isRoutineSchedule, the one the daemon and the browser client run: the
// launcher marks a routine on its row (payload.routine), and a row armed before that marker counts as a
// routine unless its room is a marketing room. the room is the schedule's own. the SQL below is its pg
// twin. `payload -> 'routine'` compares as jsonb, so only a boolean true marks a routine, exactly as
// the shared `=== true` does.
//
// leaf helpers of both stores, kept out of pgstore.ts and memory.ts on their ratchets' own terms.
import type postgres from 'postgres';
import { isRoutineSchedule } from '@neuramesh/shared';

/** the ROUTINE schedule that opened this thread, or null: a person opened it, a content schedule did, or the schedule is gone */
export async function threadRoutineIdSql(sql: postgres.Sql, workspace: string, threadId: string): Promise<string | null> {
  const [row] = await sql<Array<{ id: string }>>`select s.id from threads th
      join schedules s on s.id = th.schedule_id
      left join channels c on c.id = s.channel_id
     where th.id = ${threadId}::uuid and th.workspace_id = ${workspace}::uuid
       and ((s.payload -> 'routine') = 'true'::jsonb or coalesce(c.kind, 'build') <> 'marketing')`;
  return row?.id ?? null;
}

type MemThread = { id: string; workspace: string; scheduleId?: string | null };
type MemSchedule = { id: string; channelId: string; payload: Record<string, unknown> };
type MemChannel = { id: string; kind?: string };

/** the memory twin: the same join, and the shared test itself. pg nulls a deleted schedule's threads (0119), and here the missing row reads the same */
export function threadRoutineIdMem(threads: MemThread[], schedules: MemSchedule[], channels: MemChannel[], workspace: string, threadId: string): string | null {
  const t = threads.find((x) => x.id === threadId && x.workspace === workspace);
  const s = t?.scheduleId ? schedules.find((x) => x.id === t.scheduleId) : undefined;
  return s && isRoutineSchedule(s.payload, channels.find((c) => c.id === s.channelId)?.kind) ? s.id : null;
}
