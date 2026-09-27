// 0134, rule D9: a session's DESIGNATED machine — workspace-scoped, written at birth by the composer's
// machine chip (or the desktop default), moved afterwards only by a human (`thread.set_machine`).
// Leaf helpers of PostgresStore, kept out of pgstore.ts on its ratchet's own terms.
import type postgres from 'postgres';
import type { ThreadKind } from '@neuramesh/shared';
import { DomainError } from '../errors';

/** the machine's id when it belongs to the workspace, else null — a designation naming a foreign
 *  machine is dropped at birth and 404s at set time, rather than mis-routing at claim time */
export async function workspaceMachine(sql: postgres.Sql, workspace: string, machineId: string): Promise<string | null> {
  return (await sql<Array<{ id: string }>>`select id from machines where id = ${machineId}::uuid and workspace_id = ${workspace}::uuid`)[0]?.id ?? null;
}

export async function setThreadMachineSql(sql: postgres.Sql, workspace: string, threadId: string, machineId: string | null): Promise<void> {
  if (machineId && !(await workspaceMachine(sql, workspace, machineId))) throw new DomainError('NOT_FOUND', `machine ${machineId} is not in this workspace`);
  const [row] = await sql<Array<{ id: string }>>`update threads set machine_id = ${machineId}::uuid, updated_at = now() where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid returning id`;
  if (!row) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);
}

/** 0144, coding threads: a conversation's kind — `chat`, or `coding` (the coding runtime works on a
 *  repository in it). The same leaf shape as the machine above; handler/thread.ts holds the rules. */
export async function setThreadKindSql(sql: postgres.Sql, workspace: string, threadId: string, kind: ThreadKind): Promise<void> {
  const [row] = await sql<Array<{ id: string }>>`update threads set kind = ${kind}, updated_at = now() where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid returning id`;
  if (!row) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);
}
