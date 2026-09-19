// The release routine's rows (docs/design/release-drafts-2026-09), leaf helpers of both stores,
// kept out of pgstore.ts and memory.ts on their ratchets' own terms (the thread-settle.ts
// precedent). Two writes share this file: the fire's outcome (`last_error`, the attention bar)
// and the scan's finish line (`payload.release.cursor` + the ledger line). The merge itself is
// shared/releasescan.ts's `mergeReleaseCursor`, so the two lanes cannot disagree on the shape.
import type postgres from 'postgres';
import { isReleasePayload, mergeReleaseCursor } from '@neuramesh/shared';
import { DomainError } from '../errors';

export type ReleaseCursor = { at: string; tag: string | null };
export type ReleaseLog = { at: string; key: string | null; note: string } | null;

/** the memory row shape both helpers touch */
export interface MemScheduleRow { id: string; workspace: string; payload: Record<string, unknown>; lastError?: string | null }

/** the merge, with the one refusal both stores make: a routine that watches no repository */
export function releaseCursorPatch(payload: Record<string, unknown> | null | undefined, cursor: ReleaseCursor, log: ReleaseLog): Record<string, unknown> {
  if (!isReleasePayload(payload)) throw new DomainError('INVALID_INPUT', 'this routine does not watch a repository');
  return mergeReleaseCursor(payload, cursor, log);
}

export async function markScheduleResultSql(sql: postgres.Sql, scheduleId: string, error: string | null): Promise<string> {
  const [row] = await sql`update schedules set last_error = ${error} where id = ${scheduleId}::uuid returning workspace_id`;
  if (!row) throw new DomainError('NOT_FOUND', 'schedule not found');
  return row['workspace_id'] as string;
}

/** read, merge in code, write: `payload.release` is a nested object and jsonb_set cannot create
 *  the parent it lands in. The row lock keeps two daemons from interleaving their merges. */
export async function setScheduleCursorSql(sql: postgres.Sql, scheduleId: string, cursor: ReleaseCursor, log: ReleaseLog): Promise<string> {
  const [row] = await sql`select workspace_id, payload from schedules where id = ${scheduleId}::uuid for update`;
  if (!row) throw new DomainError('NOT_FOUND', 'schedule not found');
  const next = releaseCursorPatch((row['payload'] ?? {}) as Record<string, unknown>, cursor, log);
  await sql`update schedules set payload = ${sql.json(next as never)} where id = ${scheduleId}::uuid`;
  return row['workspace_id'] as string;
}

export function markScheduleResultMem(rows: MemScheduleRow[], scheduleId: string, error: string | null): MemScheduleRow {
  const s = rows.find((x) => x.id === scheduleId);
  if (!s) throw new DomainError('NOT_FOUND', 'schedule not found');
  s.lastError = error;
  return s;
}

export function setScheduleCursorMem(rows: MemScheduleRow[], scheduleId: string, cursor: ReleaseCursor, log: ReleaseLog): MemScheduleRow {
  const s = rows.find((x) => x.id === scheduleId);
  if (!s) throw new DomainError('NOT_FOUND', 'schedule not found');
  s.payload = releaseCursorPatch(s.payload, cursor, log);
  return s;
}

export function setScheduleStatusMem(rows: Array<MemScheduleRow & { status: string }>, scheduleId: string, status: 'active' | 'paused'): MemScheduleRow {
  const s = rows.find((x) => x.id === scheduleId);
  if (!s) throw new DomainError('NOT_FOUND', 'schedule not found');
  s.status = status;
  return s;
}

export function deleteScheduleMem(rows: MemScheduleRow[], scheduleId: string): { workspace: string; rest: MemScheduleRow[] } {
  const s = rows.find((x) => x.id === scheduleId);
  if (!s) throw new DomainError('NOT_FOUND', 'schedule not found');
  return { workspace: s.workspace, rest: rows.filter((x) => x.id !== scheduleId) };
}
