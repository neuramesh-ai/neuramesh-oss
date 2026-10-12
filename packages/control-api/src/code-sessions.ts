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
  /** 0144: the coding thread this session belongs to — set once, at insert, by the handler */
  threadId?: string | null;
  projectId?: string | null; repoId?: string | null; repoName?: string; branch?: string; title?: string;
  mode?: string; state?: string; machineId?: string | null; lastLine?: string; changesCount?: number; checkpointsCount?: number;
}

/** only the fields the patch carries, in the table's own names — an absent field is never a write */
function columnsOf(p: CodeSessionPatch): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  if (p.threadId !== undefined) out['thread_id'] = p.threadId;
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

/** 0144: the coding thread a session belongs to. Its id IS the thread id (the engineering thread
 *  id the client mints is the threads row it births), so the link is a lookup, never a field the
 *  host has to know: a legacy session's id names no thread and stays unlinked. */
export async function threadIdFor(sql: postgres.Sql, workspaceId: string, id: string): Promise<string | null> {
  const [row] = await sql<Array<{ id: string }>>`select id from threads where id = ${id}::uuid and workspace_id = ${workspaceId}::uuid limit 1`;
  return row?.id ?? null;
}

export async function insertCodeSession(sql: postgres.Sql, input: { id: string; workspaceId: string; createdBy: string } & CodeSessionPatch, event: NMEvent): Promise<boolean> {
  const cols = columnsOf(input);
  return sql.begin(async (tx) => {
    const inserted = await tx`insert into code_sessions ${tx({ id: input.id, workspace_id: input.workspaceId, created_by: input.createdBy, ...cols })}
      on conflict (id) do nothing returning id`;
    if (!inserted.length) return false;
    await tx`insert into events (id, workspace_id, type, source, target, payload, in_reply_to)
      values (${event.id}, ${event.workspace}::uuid, ${event.type}, ${event.source}, ${event.target}, ${tx.json(event.payload as never)}, ${event.in_reply_to})`;
    return true;
  });
}

export async function patchCodeSession(sql: postgres.Sql, id: string, patch: CodeSessionPatch, ended: boolean, event?: NMEvent): Promise<void> {
  const cols = columnsOf(patch);
  await sql.begin(async (tx) => {
    // A reconnecting host's prompt-derived fallback must not replace a deliberate title.
    // All paths take the thread lock before the Code row, including settlement updates below.
    // This matches the human/generated rename transaction and prevents a reverse-order deadlock.
    const [thread] = await tx`select title, titled_at from threads where id = ${id}::uuid for update`;
    if (patch.title !== undefined && thread?.['titled_at']) cols['title'] = thread['title'] as string;
    // a session that re-opens after a close is live again: a live upsert CLEARS ended_at (the phone
    // re-dials the lane it left, and a row that says both "streaming" and "ended" is two answers)
    await tx`update code_sessions set ${tx({ ...cols, updated_at: new Date().toISOString(), ended_at: ended ? new Date().toISOString() : null })} where id = ${id}::uuid`;
    // Opening or closing the connection also touches updated_at. Only a real prompt/reply
    // (lastLine) or a fresh approval reopens a manually settled coding conversation.
    if (patch.lastLine !== undefined || patch.state === 'awaiting_approval') {
      await tx`update threads t set settled_at = null from code_sessions c
        where c.id = ${id}::uuid and t.id = c.thread_id and t.workspace_id = c.workspace_id
          and t.settled_at is not null`;
    }
    if (event) {
      await tx`insert into events (id, workspace_id, type, source, target, payload, in_reply_to)
        values (${event.id}, ${event.workspace}::uuid, ${event.type}, ${event.source}, ${event.target}, ${tx.json(event.payload as never)}, ${event.in_reply_to})`;
    }
  });
}
