// WHO APPROVED THE PLAN, as the plan card's record says it (George, 2026-09-27: "Guard the routine rules").
//
// the record reads "auto-approved · routine" only when a ROUTINE approved the plan. the server approves a
// plan by itself only for a repo-less unit whose conversation a routine opened (createtask.ts and
// planfollowup.ts in control-api). a content schedule's session keeps its person, and so does repo work,
// so a plan approved there was a person's word, and the record reads "approved". no server field records
// the approver, so the card runs the server's own test on the unit's conversation: the shared
// isRoutineSchedule, on the schedule's payload and the kind of its own room.
import { isRoutineSchedule, schedulePayload } from '@neuramesh/shared';

/** the unit's conversation, as the history watch reads it (watchHistoryAll) */
export interface OriginFacts { schedule_id?: string | null; schedule_payload?: string | null; schedule_room_kind?: string | null }

/** did a routine approve this unit's plan by itself? the schedule row must be in the replica: every
 *  schedule the API writes carries a payload, so a null one means the row has not arrived yet */
export function approvedByRoutine(task: { repo_id?: string | null }, origin: OriginFacts | undefined): boolean {
  return !task.repo_id && !!origin?.schedule_id && origin.schedule_payload != null
    && isRoutineSchedule(schedulePayload(origin.schedule_payload), origin.schedule_room_kind);
}
