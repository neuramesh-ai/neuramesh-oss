// one session per routine (docs/design/routine-sessions-2026-09/plan.md, PR 2): a schedule's session
// holds every run, and it wears the schedule's own title, so the rail shows one row per routine under
// the name a person gave it. the opener's first line ("Routine · …", "Scheduled draft · … · for 10:00",
// a release digest's head) says what one run is, and that stops being the session's name once the
// session holds many runs.
//
// the title follows a renamed routine at its next run, and only while nobody named the session:
// every title write stamps threads.titled_at (0124), so a person's rename holds. pgstore reads the
// schedule here and renames in the conflict clause of its thread insert. the memory store mirrors both.
import { plainTitle, threadTitle } from '@neuramesh/shared';
import type postgres from 'postgres';

/** the title a thread takes when this message births it: its schedule's title, else the heuristic over the body */
export function sessionTitle(scheduleTitle: string | null | undefined, body: string): string {
  return (scheduleTitle ? plainTitle(scheduleTitle).slice(0, 120).trim() : '') || threadTitle(body);
}

/** the same, with the schedule read inside the post's transaction (only one this workspace owns) */
export async function sessionTitleSql(sql: postgres.Sql, workspace: string, scheduleId: string | null, body: string): Promise<string> {
  const [s] = scheduleId ? await sql<Array<{ title: string }>>`select title from schedules where id = ${scheduleId}::uuid and workspace_id = ${workspace}::uuid` : [];
  return sessionTitle(s?.title, body);
}
