// Run now (routine sessions, docs/design/routine-sessions-2026-09/plan.md), leaf helpers of both stores,
// kept out of pgstore.ts and memory.ts on their ratchets' own terms (the release-routine.ts precedent).
// The row becomes due at once. The daemon's next tick claims it the ordinary way (schedule.claim_run),
// so a run fired now is a run like any other, and its claim moves next_run_at on to the cadence's next slot.
import type postgres from 'postgres';
import { DomainError } from '../errors';

const NOT_ACTIVE = 'This routine is paused or finished. Resume it, then run it.';

export async function runScheduleNowSql(sql: postgres.Sql, scheduleId: string): Promise<string> {
  const [row] = await sql`update schedules set next_run_at = now() where id = ${scheduleId}::uuid and status = 'active' returning workspace_id`;
  if (row) return row['workspace_id'] as string;
  const [known] = await sql`select 1 from schedules where id = ${scheduleId}::uuid`;
  throw known ? new DomainError('INVALID_INPUT', NOT_ACTIVE) : new DomainError('NOT_FOUND', 'schedule not found');
}

/** the memory row shape the helper touches */
export interface MemRunNowRow { id: string; workspace: string; status: string; nextRunAt: string | null }

export function runScheduleNowMem(rows: MemRunNowRow[], scheduleId: string, nowIso: string): string {
  const row = rows.find((x) => x.id === scheduleId);
  if (!row) throw new DomainError('NOT_FOUND', 'schedule not found');
  if (row.status !== 'active') throw new DomainError('INVALID_INPUT', NOT_ACTIVE);
  row.nextRunAt = nowIso;
  return row.workspace;
}
