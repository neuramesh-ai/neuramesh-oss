// ROUTINE OR CONTENT: the two kinds of schedule that open a session (George, 2026-09-27).
//
// a ROUTINE runs with no person in the loop, so the machinery built for that serves its session:
// the resume asks again when no answer came, a unit born there passes its gates by itself, the
// monitor sweep leaves the session to those two, and the orchestrator's turn there says so. a
// CONTENT schedule drafts a post, and a draft always waits for a person. its session keeps its
// schedule id (the rail clock, the Automations run list), and none of that machinery touches it.
//
// the test is @neuramesh/shared isRoutineSchedule, the one host/schedules.ts runs before a claim and
// the browser client's plan card runs too. the server runs the same test in SQL (control-api
// store/routine-rule.ts). the room is the schedule's own, and a thread whose schedule row is gone is
// no routine there or here. this module holds the daemon's replica readers.
import { isRoutineSchedule, schedulePayload } from '@neuramesh/shared';

type ReadDb = { getAll: <T>(sql: string, params?: unknown[]) => Promise<T[]> };
type Facts = { payload: string | null; kind: string | null };

/** a conversation a ROUTINE opened. false for a person's conversation and a content schedule's session */
export async function isRoutineThread(db: ReadDb, threadId: string | null | undefined): Promise<boolean> {
  if (!threadId) return false;
  const [r] = await db.getAll<Facts>(
    `select s.payload, c.kind from threads th join schedules s on s.id = th.schedule_id
       left join channels c on c.id = s.channel_id where th.id = ? limit 1`,
    [threadId],
  ).catch(() => [] as Facts[]);
  return !!r && isRoutineSchedule(schedulePayload(r.payload), r.kind);
}

/** a repo-less unit whose conversation a ROUTINE opened, so the hands-off gates apply to it. false for a
 *  person's conversation, a content schedule's session, and repo work (code merges on a person's word) */
export async function isRoutineUnit(db: ReadDb, taskId: string): Promise<boolean> {
  const [r] = await db.getAll<Facts>(
    `select s.payload, c.kind from tasks t join threads th on th.id = t.origin_thread_id join schedules s on s.id = th.schedule_id
       left join channels c on c.id = s.channel_id where t.id = ? and t.repo_id is null limit 1`,
    [taskId],
  ).catch(() => [] as Facts[]);
  return !!r && isRoutineSchedule(schedulePayload(r.payload), r.kind);
}
