import type {Store} from './store';
import {hashMachineToken} from './machine-auth';
import { agentAuthorization, type AgentReplicaPrincipal } from './agent-replica-scope';
// Replica authorization, workspace heads and the schema-column cache.
import { createHash } from 'node:crypto';
import type { Actor } from '@neuramesh/shared';
import { TABLE_COLUMNS } from '@neuramesh/client-core/schema';
import type postgres from 'postgres';
export type Sql = postgres.Sql | postgres.TransactionSql;

/** A machine on the feed (design §10.2): it reads its OWN workspace and nothing else, even when its
 *  owner belongs to several. The workspace comes from the machine row the bearer resolved (with the
 *  Cloud Run epoch fence, fleet.ts machineByTokenHash), never from a header. */
export interface MachineSyncPrincipal { kind: 'machine'; id: string; workspaceId: string; agentScopes?:boolean }
export type SyncPrincipal = Actor | MachineSyncPrincipal | AgentReplicaPrincipal;
/** upstream's name for the same principal */
export type ReplicaPrincipal = SyncPrincipal;

export async function authorization(sql: Sql, actor: SyncPrincipal): Promise<{ workspaces: string[]; marketing: string[]; scope: string }> {
  if (actor.kind === 'scoped-agent') return agentAuthorization(sql,actor);
  if (actor.kind === 'machine') {
    // re-read inside the snapshot: a destroyed machine, one moved off its workspace, or one whose owner
    // left the workspace reads nothing, and the scope change invalidates its cursor
    const live = await sql<{ workspace_id: string; member_id: string; member_since: string; owner_user_id: string; role: string }[]>`
      select m.workspace_id, w.id as member_id, w.created_at::text as member_since, m.owner_user_id, w.role
        from machines m
        join workspace_members w on w.workspace_id = m.workspace_id and w.user_id = m.owner_user_id
       where m.id = ${actor.id}::uuid and m.workspace_id = ${actor.workspaceId}::uuid
         and (m.lifecycle is null or m.lifecycle <> 'destroyed')`;
    const workspaces = live.map((m) => m.workspace_id);
    const destination = await destinationScope(sql,workspaces,'human',live[0]?.owner_user_id ?? actor.id);
    return { workspaces, marketing: actor.agentScopes?destination.marketing:[], scope: createHash('sha256').update(JSON.stringify(['destination-acl-v2','machine', actor.id, actor.agentScopes===true,live,destination])).digest('hex') };
  }
  if (actor.kind !== 'human') throw new Error('A replica requires a member or machine identity');
  const members = await sql<{ workspace_id: string; id: string; created_at: string; role: string }[]>`
    select workspace_id, id, created_at::text, role from workspace_members where user_id = ${actor.id} order by workspace_id`;
  const workspaces = members.map(m=>m.workspace_id);
  const destination = await destinationScope(sql,workspaces,actor.kind,actor.id);
  return { workspaces, marketing: destination.marketing, scope: createHash('sha256').update(JSON.stringify(['destination-acl-v1',actor.id,members,destination])).digest('hex') };
}

export function workspaceExpression(table: string): string {
  if (table === 'agent_channels') return '(select workspace_id from agents where id = t.agent_id)';
  if (table === 'project_repos') return '(select workspace_id from repos where id = t.repo_id)';
  if (table === 'channel_members') return '(select workspace_id from channels where id = t.channel_id)';
  return 't.workspace_id';
}

/** each workspace's head: its last revision, and the floor below which its changes are pruned */
export async function heads(sql: Sql, workspaces: string[]): Promise<Map<string, { revision: string; retained: string }>> {
  if (!workspaces.length) return new Map();
  const rows = await sql<{ workspace_id: string; revision: string; retained_after: string }[]>`
    select workspace_id::text, revision::text, retained_after::text from sync_heads where workspace_id = any(${workspaces}::uuid[])`;
  return new Map(rows.map((r) => [r.workspace_id, { revision: r.revision, retained: r.retained_after }]));
}

/** The columns a snapshot reads per table: the contract's that Postgres has. A snapshot used to read
 *  whole rows (to_jsonb(t)) and drop the rest in this process, so every message's 384-dim embedding
 *  and its tsvector crossed from Postgres for nothing. Cached for ten minutes: a migration that adds a
 *  contract column is followed by a deploy anyway. */
let columnCache: { at: number; columns: Map<string, string[]> } | null = null;
export async function snapshotColumns(sql: Sql): Promise<Map<string, string[]>> {
  if (columnCache && Date.now() - columnCache.at < 600_000) return columnCache.columns;
  const tables = Object.keys(TABLE_COLUMNS);
  const rows = await sql<{ table_name: string; column_name: string }[]>`
    select table_name::text, column_name::text from information_schema.columns
     where table_schema = 'public' and table_name = any(${tables}::text[])`;
  const have = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = have.get(r.table_name);
    if (!set) have.set(r.table_name, (set = new Set()));
    set.add(r.column_name);
  }
  const columns = new Map(tables.map((t) => [t, ['id', ...Object.keys(TABLE_COLUMNS[t]!).filter((c) => have.get(t)?.has(c))]]));
  columnCache = { at: Date.now(), columns };
  return columns;
}

async function destinationScope(sql: Sql, workspaces: string[], kind: string, id: string) {
  if (!workspaces.length) return { marketing: [] as string[], revisions: [] as unknown[] };
  const rows = await sql<{ workspace: string }[]>`select w::text as workspace from unnest(${workspaces}::uuid[]) w where nm_destination_access(w,${kind},${id}::uuid,'marketing')`;
  const revisions = await sql`select workspace_id,destination,revision::text from workspace_destination_revisions where workspace_id=any(${workspaces}::uuid[]) order by workspace_id,destination`;
  return { marketing: rows.map(r=>r.workspace), revisions };
}

/** Shared project summaries may include restricted Marketing analysis. */
export function destinationReplicaRow(table:string,row:Record<string,unknown>,marketing:boolean) {
  return table==='projects'&&!marketing ? {...row,brand_profile:null} : row;
}

/** the machine lane: the bearer's own row, or null (wrong token, a replaced Cloud Run epoch, destroyed) */
export async function machinePrincipal(store: Store, authorization: string | undefined): Promise<MachineSyncPrincipal | null> {
  const token = /^Bearer\s+(nmm_\S+)$/i.exec(authorization ?? '')?.[1];
  if (!token || !store.machineByTokenHash) return null;
  const row = await store.machineByTokenHash(hashMachineToken(token));
  return row ? { kind: 'machine', id: row.id, workspaceId: row.workspace_id } : null;
}
