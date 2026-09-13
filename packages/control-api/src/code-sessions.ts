// Code sessions (0135, the mobile-cloud round): the SQL behind handler/codesession.ts.
//
// SQL-FIRST, the member-machines idiom: every function takes the postgres handle from
// `sqlOf(store)`, so the Store contract grows no delegates and pgstore stays at its ratchet cap.
// A store with no postgres (memory) does not serve Code-session rows, and the handler says so.
import type postgres from 'postgres';
import type { NMEvent } from '@neuramesh/shared';

export interface CodeSessionHead {
  id: string;
  workspaceId: string;
  createdBy: string;
  machineId: string | null;
  title: string;
  state: string;
}

/** the row's identity + ownership facts — what every authz decision reads */
export async function readCodeSession(sql: postgres.Sql, id: string): Promise<CodeSessionHead | null> {
  const [row] = await sql<Array<{ id: string; workspace_id: string; created_by: string; machine_id: string | null; title: string; state: string }>>`
    select id, workspace_id, created_by, machine_id, title, state from code_sessions where id = ${id}::uuid limit 1`;
  return row ? { id: row.id, workspaceId: row.workspace_id, createdBy: row.created_by, machineId: row.machine_id, title: row.title, state: row.state } : null;
}

/** a live machine in this workspace → its owner (null owner for a runner); undefined = no such machine here */
export async function machineOwnerIn(sql: postgres.Sql, workspaceId: string, machineId: string): Promise<{ ownerUserId: string | null; name: string } | undefined> {
  const [row] = await sql<Array<{ owner_user_id: string | null; name: string }>>`
    select owner_user_id, name from machines
     where id = ${machineId}::uuid and workspace_id = ${workspaceId}::uuid and (lifecycle is null or lifecycle <> 'destroyed') limit 1`;
  return row ? { ownerUserId: row.owner_user_id, name: row.name } : undefined;
}

export interface CodeSessionPatch {
  projectId?: string | null; repoId?: string | null; repoName?: string; branch?: string; title?: string;
  mode?: string; state?: string; machineId?: string | null; lastLine?: string; changesCount?: number; checkpointsCount?: number;
}

/** only the fields the patch carries, in the table's own names — an absent field is never a write */
function columnsOf(p: CodeSessionPatch): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  if (p.projectId !== undefined) out['project_id'] = p.projectId;
  if (p.repoId !== undefined) out['repo_id'] = p.repoId;
  if (p.repoName !== undefined) out['repo_name'] = p.repoName;
  if (p.branch !== undefined) out['branch'] = p.branch;
  if (p.title !== undefined) out['title'] = p.title;
  if (p.mode !== undefined) out['mode'] = p.mode;
  if (p.state !== undefined) out['state'] = p.state;
  if (p.machineId !== undefined) out['machine_id'] = p.machineId;
  if (p.lastLine !== undefined) out['last_line'] = p.lastLine;
  if (p.changesCount !== undefined) out['changes_count'] = p.changesCount;
  if (p.checkpointsCount !== undefined) out['checkpoints_count'] = p.checkpointsCount;
  return out;
}

export async function insertCodeSession(sql: postgres.Sql, input: { id: string; workspaceId: string; createdBy: string } & CodeSessionPatch, event: NMEvent): Promise<void> {
  const cols = columnsOf(input);
  await sql.begin(async (tx) => {
    await tx`insert into code_sessions ${tx({ id: input.id, workspace_id: input.workspaceId, created_by: input.createdBy, ...cols })}`;
    await tx`insert into events (id, workspace_id, type, source, target, payload, in_reply_to)
      values (${event.id}, ${event.workspace}::uuid, ${event.type}, ${event.source}, ${event.target}, ${tx.json(event.payload as never)}, ${event.in_reply_to})`;
  });
}

export async function patchCodeSession(sql: postgres.Sql, id: string, patch: CodeSessionPatch, ended: boolean, event?: NMEvent): Promise<void> {
  const cols = columnsOf(patch);
  await sql.begin(async (tx) => {
    // a session that re-opens after a close is live again: a live upsert CLEARS ended_at (the phone
    // re-dials the lane it left, and a row that says both "streaming" and "ended" is two answers)
    await tx`update code_sessions set ${tx({ ...cols, updated_at: new Date().toISOString(), ended_at: ended ? new Date().toISOString() : null })} where id = ${id}::uuid`;
    if (event) {
      await tx`insert into events (id, workspace_id, type, source, target, payload, in_reply_to)
        values (${event.id}, ${event.workspace}::uuid, ${event.type}, ${event.source}, ${event.target}, ${tx.json(event.payload as never)}, ${event.in_reply_to})`;
    }
  });
}
