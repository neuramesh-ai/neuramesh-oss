import { createHash } from 'node:crypto';
import type { Actor } from '@neuramesh/shared';
import { TABLE_COLUMNS } from '@neuramesh/client-core/schema';
import { LOCAL_SYNC_SCHEMA_VERSION, type ReplicaBatch, type ReplicaChange } from '@neuramesh/client-core/replica';
import type { Hono } from 'hono';
import type postgres from 'postgres';
import type { Store } from './store';
import { localMode } from './localmode';
import { hashMachineToken } from './machine-auth';

type Sql = postgres.Sql | postgres.TransactionSql;
export type ReplicaPrincipal = Actor | { kind: 'machine'; tokenHash: string };
type Cursor = { revision: string; scope: string; schema: string };
const schema = createHash('sha256').update(JSON.stringify(TABLE_COLUMNS)).digest('hex');
let nextPruneAt = 0;
const encode = (cursor: Cursor): string => Buffer.from(JSON.stringify(cursor)).toString('base64url');
export function decodeLocalCursor(raw: string): Cursor | null {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    return /^\d+$/.test(c.revision) && typeof c.scope === 'string' && typeof c.schema === 'string' ? c : null;
  } catch { return null; }
}

/** Only the client contract's columns leave this API. In particular, machine credentials and
 * provider secrets must never ride the replica just because Postgres gains a new column. */
export function localReplicaRow(table: string, source: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = { id: source['id'] };
  for (const [column, type] of Object.entries(TABLE_COLUMNS[table] ?? {})) {
    const value = source[column];
    row[column] = value == null ? null : type === 'integer' ? Number(value)
      : typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return row;
}

async function authorization(sql: Sql, actor: ReplicaPrincipal): Promise<{ workspaces: string[]; scope: string }> {
  if (actor.kind === 'machine') {
    // A machine reads ONLY its own workspace, even when its owner belongs to several. Resolve
    // the bearer again in the snapshot transaction so revocation also invalidates its cursor.
    const members = await sql<{ workspace_id: string; id: string; created_at: string; machine_id: string }[]>`
      select w.workspace_id, w.id, w.created_at::text, m.id as machine_id
      from machines m join workspace_members w on w.workspace_id=m.workspace_id and w.user_id=m.owner_user_id
      where m.token_hash=${actor.tokenHash}`;
    return { workspaces: members.map(m => m.workspace_id), scope: createHash('sha256').update(JSON.stringify([actor, members])).digest('hex') };
  }
  if (actor.kind !== 'human') throw new Error('A replica requires a member or machine identity');
  const members = await sql<{ workspace_id: string; id: string; created_at: string }[]>`
    select workspace_id, id, created_at::text from workspace_members where user_id = ${actor.id} order by workspace_id`;
  return { workspaces: members.map((m) => m.workspace_id), scope: createHash('sha256').update(JSON.stringify([actor.id, members])).digest('hex') };
}

function workspaceExpression(table: string): string {
  if (table === 'agent_channels') return '(select workspace_id from agents where id = t.agent_id)';
  if (table === 'project_repos') return '(select workspace_id from repos where id = t.repo_id)';
  if (table === 'channel_members') return '(select workspace_id from channels where id = t.channel_id)';
  return 't.workspace_id';
}

/** Collect only an expired prefix while holding the same lock as writers. The retention floor
 * changes in the delete transaction, so an old client always resets instead of missing rows. */
export async function pruneLocalChanges(sql: postgres.Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select revision from local_sync_state where singleton for update`;
    const [cut] = await tx<{ revision: string | null }[]>`
      select max(revision)::text as revision from (
        select revision from local_sync_changes
        where revision < coalesce((select min(revision) from local_sync_changes where created_at >= now() - interval '30 days'), 9223372036854775807)
        order by revision limit 10000
      ) expired`;
    if (!cut?.revision) return;
    await tx`delete from local_sync_changes where revision <= ${cut.revision}::bigint`;
    await tx`update local_sync_state set retained_after = greatest(retained_after, ${cut.revision}::bigint) where singleton`;
  });
}

export async function localBootstrap(sql: postgres.Sql, actor: ReplicaPrincipal): Promise<ReplicaBatch> {
  const [current] = await sql<{ enabled: boolean }[]>`select enabled from local_sync_state where singleton`;
  if (!current?.enabled) {
    // A writer that already observed enabled=false must finish before the first snapshot.
    // Otherwise it can commit after the snapshot without ever recording a change.
    await sql.begin(async (tx) => {
      await tx.unsafe(`lock table ${Object.keys(TABLE_COLUMNS).sort().map((table) => `"${table}"`).join(',')} in share row exclusive mode`);
      await tx`update local_sync_state set enabled = true where singleton and not enabled`;
    });
  }
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    const auth = await authorization(tx, actor);
    const [state] = await tx<{ revision: string }[]>`select revision::text from local_sync_state where singleton`;
    const changes: ReplicaChange[] = [];
    if (auth.workspaces.length) {
      for (const table of Object.keys(TABLE_COLUMNS)) {
        const rows = await tx.unsafe<{ row: Record<string, unknown> }[]>(
          `select to_jsonb(t) as row from "${table}" t where ${workspaceExpression(table)} = any($1::uuid[]) order by t.id`, [auth.workspaces]);
        for (const { row } of rows) changes.push({ table, id: String(row['id']), row: localReplicaRow(table, row) });
      }
    }
    return { schemaVersion: LOCAL_SYNC_SCHEMA_VERSION, cursor: encode({ revision: state!.revision, scope: auth.scope, schema }), workspaces: auth.workspaces, changes, hasMore: false };
  });
}

export async function localChanges(sql: postgres.Sql, actor: ReplicaPrincipal, cursor: Cursor, limit = 1000): Promise<ReplicaBatch | null> {
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    const auth = await authorization(tx, actor);
    const [state] = await tx<{ revision: string; retained_after: string }[]>`
      select revision::text, retained_after::text from local_sync_state where singleton`;
    if (cursor.scope !== auth.scope || cursor.schema !== schema || BigInt(cursor.revision) < BigInt(state!.retained_after)
      || BigInt(cursor.revision) > BigInt(state!.revision)) return null;
    // Never split an authoritative transaction between batches. Its revisions are contiguous
    // because record_local_sync_change holds the revision lock through COMMIT.
    const page = await tx<{ revision: string; transaction_id: string }[]>`
      select revision::text, transaction_id::text from local_sync_changes where revision > ${cursor.revision}::bigint
      order by revision limit ${limit}`;
    const last = page.at(-1);
    const [end] = last ? await tx<{ revision: string }[]>`
      select max(revision)::text as revision from local_sync_changes where transaction_id = ${last.transaction_id}::bigint` : [];
    const revision = end?.revision ?? state!.revision;
    const rows = auth.workspaces.length ? await tx<{ table_name: string; row_id: string; row_data: Record<string, unknown> | null }[]>`
      select table_name, row_id, row_data from local_sync_changes
      where revision > ${cursor.revision}::bigint and revision <= ${revision}::bigint and workspace_id = any(${auth.workspaces}::uuid[]) order by revision` : [];
    return { schemaVersion: LOCAL_SYNC_SCHEMA_VERSION, cursor: encode({ revision, scope: auth.scope, schema }), workspaces: auth.workspaces,
      changes: rows.filter((r) => TABLE_COLUMNS[r.table_name]).map((r) => ({ table: r.table_name, id: r.row_id, row: r.row_data ? localReplicaRow(r.table_name, r.row_data) : null })),
      hasMore: BigInt(revision) < BigInt(state!.revision) };
  });
}

/** Mount after the normal /v1 bearer middleware. All clients use the same authenticated feed;
 * a machine bearer narrows the read scope rather than impersonating its owner's other teams. */
export function localSyncRoutes(app: Hono<{ Variables: { actor: Actor } }>, store: Store): void {
  app.on('GET', ['/v1/sync/:operation', '/v1/brain/replica/:operation'], async (c) => {
    c.header('cache-control', 'private, no-store');
    const bearer = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '')?.[1];
    const actor: ReplicaPrincipal = bearer?.startsWith('nmm_') ? { kind: 'machine', tokenHash: hashMachineToken(bearer) } : c.get('actor');
    if (localMode() && !bearer?.startsWith('nmh_') && actor.kind !== 'machine') return c.json({ error: 'Sync requires a local credential', code: 'NOT_PERMITTED' }, 403);
    if (actor.kind !== 'human' && actor.kind !== 'machine') return c.json({ error: 'Sync requires a member or machine identity', code: 'NOT_PERMITTED' }, 403);
    const sql = (store as Store & { sql?: postgres.Sql }).sql;
    if (!sql) return c.json({ error: 'Local sync requires Postgres', code: 'UNAVAILABLE' }, 503);
    if (Date.now() >= nextPruneAt) {
      nextPruneAt = Date.now() + 3600_000;
      await pruneLocalChanges(sql);
    }
    if (c.req.param('operation') === 'bootstrap') return c.json(await localBootstrap(sql, actor));
    if (c.req.param('operation') !== 'changes') return c.json({ error: 'Unknown sync operation' }, 404);
    const cursor = decodeLocalCursor(c.req.query('cursor') ?? '');
    if (!cursor) return c.json({ error: 'Invalid sync cursor', code: 'INVALID_CURSOR' }, 400);
    const batch = await localChanges(sql, actor, cursor);
    return batch ? c.json(batch) : c.json({ error: 'A fresh replica snapshot is required', code: 'RESET_REQUIRED' }, 409);
  });
}
