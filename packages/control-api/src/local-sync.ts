import type { Actor } from '@neuramesh/shared';
import { TABLE_COLUMNS } from '@neuramesh/client-core/schema';
import { LOCAL_SYNC_SCHEMA_VERSION, type ReplicaBatch, type ReplicaChange } from '@neuramesh/client-core/replica';
import type { Hono } from 'hono';
import { compress } from 'hono/compress';
import postgres from 'postgres';
import type { Store } from './store';
import { localMode } from './localmode';
import { SyncWake, type SyncWakeSource } from './sync-wake';

export type { MachineSyncPrincipal, SyncPrincipal, ReplicaPrincipal } from './local-sync-scope';
import { machinePrincipal, destinationReplicaRow, authorization, workspaceExpression, heads, snapshotColumns, type SyncPrincipal } from './local-sync-scope';
export { decodeLocalCursor, isLegacyCursor, type Cursor } from './local-sync-cursor';
import { schema, encode, decodeLocalCursor, isLegacyCursor, type Cursor } from './local-sync-cursor';
let nextPruneAt = 0;

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

/** Collect each workspace's expired prefix, a few workspaces at a time. The floor moves in the same
 * transaction as the delete and under the head's row lock, so a reader sees both or neither: a client
 * behind the floor always resets instead of missing rows. A writer of that workspace waits for the
 * prune's commit only; other workspaces never notice. */
export async function pruneLocalChanges(sql: postgres.Sql, { days = 30, batch = 10_000, workspaces = 50 } = {}): Promise<number> {
  const stale = await sql<{ workspace_id: string }[]>`
    select distinct workspace_id::text from sync_changes where created_at < now() - make_interval(days => ${days}::int) limit ${workspaces}`;
  let pruned = 0;
  for (const { workspace_id: ws } of stale) {
    pruned += await sql.begin(async (tx) => {
      const [head] = await tx<{ retained_after: string }[]>`
        select retained_after::text from sync_heads where workspace_id = ${ws}::uuid for update`;
      if (!head) return 0;
      // the longest prefix of expired changes: up to the first change that is still fresh
      const [cut] = await tx<{ revision: string | null }[]>`
        select max(revision)::text as revision from (
          select revision from sync_changes
           where workspace_id = ${ws}::uuid
             and revision < coalesce((select min(revision) from sync_changes where workspace_id = ${ws}::uuid
                                        and created_at >= now() - make_interval(days => ${days}::int)), 9223372036854775807)
           order by revision limit ${batch}
        ) expired`;
      if (!cut?.revision) return 0;
      const gone = await tx`delete from sync_changes where workspace_id = ${ws}::uuid and revision <= ${cut.revision}::bigint`;
      await tx`update sync_heads set retained_after = greatest(retained_after, ${cut.revision}::bigint) where workspace_id = ${ws}::uuid`;
      return gone.count;
    });
  }
  return pruned;
}

const ident = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** what every /v1/sync answer says about long-polls: the longest `wait` this server holds (0 = none) */
export function syncMaxWaitSeconds(): number {
  const n = Number(process.env['NM_SYNC_MAX_WAIT_S'] ?? 25);
  return Number.isFinite(n) ? Math.max(0, Math.min(55, Math.floor(n))) : 25;
}
const withWait = (batch: ReplicaBatch): ReplicaBatch => {
  const wait = syncMaxWaitSeconds();
  return wait > 0 ? { ...batch, wait } : batch;
};

export async function localBootstrap(sql: postgres.Sql, actor: SyncPrincipal): Promise<ReplicaBatch> {
  const [current] = await sql<{ enabled: boolean }[]>`select enabled from local_sync_state where singleton`;
  if (!current?.enabled) {
    // A writer that already observed enabled=false must finish before the first snapshot.
    // Otherwise it can commit after the snapshot without ever recording a change.
    await sql.begin(async (tx) => {
      await tx.unsafe(`lock table ${Object.keys(TABLE_COLUMNS).sort().map((table) => `"${table}"`).join(',')} in share row exclusive mode`);
      await tx`update local_sync_state set enabled = true where singleton and not enabled`;
    });
  }
  const columns = await snapshotColumns(sql);
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    const auth = await authorization(tx, actor);
    const head = await heads(tx, auth.workspaces);
    const changes: ReplicaChange[] = [];
    if (auth.workspaces.length) {
      for (const table of Object.keys(TABLE_COLUMNS)) {
        const scopedCrew = actor.kind==='scoped-agent'&&auth.marketing.length&&table==='agents' ? "and nm_destination_access(t.workspace_id,'agent',t.id,'marketing')" : '';
        const select = columns.get(table)!.map((c) => `t.${ident(c)}`).join(', ');
        const rows = await tx.unsafe<{ row: Record<string, unknown> }[]>(
          `select to_jsonb(x) as row from (select ${select} from "${table}" t where ${workspaceExpression(table)} = any($1::uuid[]) ${scopedCrew} and (${workspaceExpression(table)}=any($2::uuid[]) or not coalesce(nm_marketing_row(${workspaceExpression(table)},$3,to_jsonb(t)),false))) x order by x.id`, [auth.workspaces,auth.marketing,table]);
        for (const { row } of rows) changes.push({ table, id: String(row['id']), row: localReplicaRow(table, destinationReplicaRow(table,row,auth.marketing.includes(String(row['workspace_id'])))) });
      }
    }
    const revisions = auth.workspaces.map((w) => head.get(w)?.revision ?? '0');
    return withWait({ ...(actor.kind==='scoped-agent'&&auth.marketing.length?{privateDestination:'marketing' as const}:{}), schemaVersion: LOCAL_SYNC_SCHEMA_VERSION, cursor: encode({ revisions, scope: auth.scope, schema }), workspaces: auth.workspaces, changes, hasMore: false });
  });
}

/** one read of the change log: the page, and whether it moved the cursor at all */
export interface ChangesRead { batch: ReplicaBatch; advanced: boolean; revisions: string[] }
type ChangeRow = { workspace_id: string; table_name: string; row_id: string; row_data: Record<string, unknown> | null };

/**
 * The changes after a cursor, in one repeatable-read snapshot. A page takes the OLDEST pending
 * changes across the principal's workspaces (commit order, sync_changes.seq), at most `limit`, then
 * extends each workspace to the end of the transaction its last change belongs to. So a page never
 * splits a transaction inside a workspace, and a busy workspace cannot starve a quiet one.
 */
export async function readChanges(sql: postgres.Sql, actor: SyncPrincipal, cursor: Cursor, limit = 1000): Promise<ChangesRead | null> {
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    const auth = await authorization(tx, actor);
    if (cursor.scope !== auth.scope || cursor.schema !== schema || cursor.revisions.length !== auth.workspaces.length) return null;
    const head = await heads(tx, auth.workspaces);
    const from = cursor.revisions.map(BigInt);
    const top = auth.workspaces.map((w) => BigInt(head.get(w)?.revision ?? '0'));
    for (let i = 0; i < from.length; i++) {
      // behind the retention floor, or ahead of the head (a cursor from another database): reset
      if (from[i]! < BigInt(head.get(auth.workspaces[i]!)?.retained ?? '0') || from[i]! > top[i]!) return null;
    }
    const end = [...from];
    const pending = auth.workspaces.map((_, i) => i).filter((i) => top[i]! > from[i]!);
    let rows: ChangeRow[] = [];
    if (pending.length) {
      const ws = pending.map((i) => auth.workspaces[i]!);
      const lo = pending.map((i) => String(from[i]));
      const hi = pending.map((i) => String(top[i]));
      const page = await tx<{ workspace_id: string; revision: string; transaction_id: string }[]>`
        select c.workspace_id::text, c.revision::text, c.transaction_id::text
          from unnest(${ws}::uuid[], ${lo}::bigint[], ${hi}::bigint[]) as k(ws, lo, hi)
          join sync_changes c on c.workspace_id = k.ws and c.revision > k.lo and c.revision <= k.hi
         order by c.seq limit ${limit}`;
      const index = new Map(auth.workspaces.map((w, i) => [w, i]));
      if (page.length < limit) {
        for (const i of pending) end[i] = top[i]!;
      } else {
        const last = new Map<string, { revision: bigint; transaction: string }>();
        for (const r of page) {
          const prev = last.get(r.workspace_id);
          if (!prev || BigInt(r.revision) > prev.revision) last.set(r.workspace_id, { revision: BigInt(r.revision), transaction: r.transaction_id });
        }
        for (const [w, l] of last) end[index.get(w)!] = l.revision;
        // Never split an authoritative transaction inside a workspace. Its revisions there are
        // contiguous because record_sync_change holds the head's lock through COMMIT.
        const lw = [...last.keys()];
        const lt = lw.map((w) => last.get(w)!.transaction);
        const tails = await tx<{ workspace_id: string; revision: string }[]>`
          select c.workspace_id::text, max(c.revision)::text as revision
            from unnest(${lw}::uuid[], ${lt}::bigint[]) as k(ws, txn)
            join sync_changes c on c.workspace_id = k.ws and c.transaction_id = k.txn
           group by c.workspace_id`;
        for (const t of tails) {
          const i = index.get(t.workspace_id)!;
          const tail = BigInt(t.revision);
          if (tail > end[i]! && tail <= top[i]!) end[i] = tail;
        }
      }
      const moved = pending.filter((i) => end[i]! > from[i]!);
      if (moved.length) {
        rows = await tx<ChangeRow[]>`
          select c.workspace_id::text, c.table_name, c.row_id, c.row_data
            from unnest(${moved.map((i) => auth.workspaces[i]!)}::uuid[], ${moved.map((i) => String(from[i]))}::bigint[], ${moved.map((i) => String(end[i]))}::bigint[]) as k(ws, lo, hi)
            join sync_changes c on c.workspace_id = k.ws and c.revision > k.lo and c.revision <= k.hi
           order by c.seq`;
      }
    }
    // A denied row still advances the cursor; no row body reaches the replica. ACL revision
    // changes invalidate the scope and force a fresh filtered bootstrap, removing old rows.
    if (rows.some(r=>r.row_data && !auth.marketing.includes(r.workspace_id))) {
      const candidates = rows.filter(r=>r.row_data && !auth.marketing.includes(r.workspace_id));
      const denied = await tx<{ row_id: string; table_name: string }[]>`select r.row_id,r.table_name from jsonb_to_recordset(${tx.json(candidates as never)}::jsonb) as r(workspace_id uuid,table_name text,row_id text,row_data jsonb) where nm_marketing_row(r.workspace_id,r.table_name,r.row_data)`;
      const hidden = new Set(denied.map(r=>`${r.table_name}:${r.row_id}`));
      rows = rows.filter(r=>!hidden.has(`${r.table_name}:${r.row_id}`));
    }
    if(actor.kind==='scoped-agent'&&auth.marketing.length){
      const profiles=rows.filter(row=>row.table_name==='agents'&&row.row_data);
      if(profiles.length){const allowed=await tx<{id:string}[]>`select id::text from agents where id=any(${profiles.map(row=>row.row_id)}::uuid[]) and nm_destination_access(workspace_id,'agent',id,'marketing')`;const visible=new Set(allowed.map(row=>row.id));rows=rows.filter(row=>row.table_name!=='agents'||!row.row_data||visible.has(row.row_id));}
    }
    const revisions = end.map(String);
    const batch: ReplicaBatch = {
      ...(actor.kind==='scoped-agent'&&auth.marketing.length?{privateDestination:'marketing' as const}:{}), schemaVersion: LOCAL_SYNC_SCHEMA_VERSION, cursor: encode({ revisions, scope: auth.scope, schema }), workspaces: auth.workspaces,
      changes: rows.filter((r) => TABLE_COLUMNS[r.table_name]).map((r) => ({ table: r.table_name, id: r.row_id, row: r.row_data ? localReplicaRow(r.table_name, destinationReplicaRow(r.table_name,r.row_data,auth.marketing.includes(r.workspace_id))) : null })),
      hasMore: end.some((e, i) => e < top[i]!),
    };
    return { batch: withWait(batch), advanced: end.some((e, i) => e !== from[i]), revisions };
  });
}

export async function localChanges(sql: postgres.Sql, actor: SyncPrincipal, cursor: Cursor, limit = 1000): Promise<ReplicaBatch | null> {
  return (await readChanges(sql, actor, cursor, limit))?.batch ?? null;
}

/** has any of these workspaces moved past the revisions a read just returned? */
async function headsMoved(sql: postgres.Sql, workspaces: string[], revisions: string[]): Promise<boolean> {
  const head = await heads(sql, workspaces);
  return workspaces.some((w, i) => BigInt(head.get(w)?.revision ?? '0') > BigInt(revisions[i] ?? '0'));
}

/** the most long-polls one instance holds at once (NM_SYNC_MAX_WAITERS). Keep it under the service's
 *  request concurrency, so that waiting requests never take every slot: 50 fits Cloud Run's default 80 */
export function syncMaxWaiters(): number {
  const n = Number(process.env['NM_SYNC_MAX_WAITERS'] ?? 50);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 50;
}

/** one hub per Postgres client: ONE listener connection per nm-api instance, fanned out in process */
const hubs = new WeakMap<object, SyncWake>();
export function syncWakeFor(sql: postgres.Sql): SyncWake {
  let hub = hubs.get(sql);
  if (!hub) {
    // a dedicated URL for the listener, for a deploy whose DATABASE_URL is a transaction pooler
    // (LISTEN needs a session of its own); by default the store's own client opens it
    const listenUrl = process.env['NM_SYNC_LISTEN_URL'];
    const listener = listenUrl ? postgres(listenUrl, { max: 1, prepare: false, onnotice: () => {} }) : sql;
    const source: SyncWakeSource = {
      listen: async (onNotify, onListen) => { await listener.listen('nm_sync', onNotify, onListen); },
      ping: async (payload) => { await sql`select pg_notify('nm_sync', ${payload})`; },
    };
    hub = new SyncWake({ maxWaiters: syncMaxWaiters(), source });
    hubs.set(sql, hub);
  }
  hub.start();
  return hub;
}

/** the wait a request asked for, in ms, within what this server holds. Slightly jittered, so a herd
 *  that started together does not come back together */
function waitMs(raw: string | undefined): number {
  const asked = Number(raw ?? 0);
  if (!Number.isFinite(asked) || asked <= 0) return 0;
  const s = Math.min(asked, syncMaxWaitSeconds());
  return Math.round(s * 1000 * (0.85 + Math.random() * 0.15));
}
/** a wait cut short: the listener is not known to be live, so a NOTIFY might be lost */
const DEGRADED_WAIT_MS = 1_000;

/** Mount after the normal /v1 bearer middleware. Every client (desktop, HQ, phone, machines) reads the
 *  same authenticated feed. A machine bearer narrows the read scope to its own workspace rather than
 *  speaking for its owner's other teams. Two paths, one handler: `/v1/sync/*` (our clients up to
 *  round 6) and `/v1/brain/replica/*` (client-core SQLiteReplica). */
export function localSyncRoutes(app: Hono<{ Variables: { actor: Actor } }>, store: Store): void {
  // GZIP FOR A CLIENT THAT ASKS (round 5). A small workspace's bootstrap measured 1,053 KB on the
  // sandbox, 91% of it skills.body: the bundled packs' 62 skills, each a whole SKILL.md. The replica
  // needs every byte (the skill panel renders the body and the Skills search reads it), so the cut
  // is on the wire, as brain-routes.ts does for a thread. A client that sends no Accept-Encoding
  // gets the same bytes as before.
  app.on('GET', ['/v1/sync/:operation', '/v1/brain/replica/:operation'], compress(), async (c) => {
    c.header('vary', 'Accept-Encoding');
    c.header('cache-control', 'private, no-store');
    const authHeader = c.req.header('authorization') ?? '';
    let principal: SyncPrincipal;
    if (/^Bearer\s+nmm_/i.test(authHeader)) {
      // the /v1 gate already proved the token; the scope is the machine's workspace, whoever the header names
      const machine = await machinePrincipal(store, authHeader);
      if (!machine) return c.json({ error: 'unknown machine token', code: 'AUTH_FAILED' }, 401);
      principal = {...machine,agentScopes:c.req.header('x-nm-agent-scopes')==='1'};
    } else {
      const actor = c.get('actor');
      if (localMode() && !/^Bearer\s+nmh_/i.test(authHeader)) return c.json({ error: 'Sync requires a local credential', code: 'NOT_PERMITTED' }, 403);
      if (actor.kind !== 'human') return c.json({ error: 'Sync requires a member or machine identity', code: 'NOT_PERMITTED' }, 403);
      principal = actor;
    }
    const sql = (store as Store & { sql?: postgres.Sql }).sql;
    if (!sql) return c.json({ error: 'Local sync requires Postgres', code: 'UNAVAILABLE' }, 503);
    // the capability, for a client choosing between a long-poll and a 1 s poll (and for a person with curl)
    c.header('x-nm-sync-wait', String(syncMaxWaitSeconds()));
    if (Date.now() >= nextPruneAt) {
      nextPruneAt = Date.now() + 3600_000;
      // off the request's path: a prune is housekeeping, and its row locks are per workspace
      void pruneLocalChanges(sql).catch((e: unknown) => console.error('sync_prune_failed', e instanceof Error ? e.message : e));
    }
    if (c.req.param('operation') === 'bootstrap') return c.json(await localBootstrap(sql, principal));
    if (c.req.param('operation') !== 'changes') return c.json({ error: 'Unknown sync operation' }, 404);
    const raw = c.req.query('cursor') ?? '';
    const cursor = decodeLocalCursor(raw);
    const reset = () => c.json({ error: 'A fresh replica snapshot is required', code: 'RESET_REQUIRED' }, 409);
    if (!cursor) return isLegacyCursor(raw) ? reset() : c.json({ error: 'Invalid sync cursor', code: 'INVALID_CURSOR' }, 400);
    let read = await readChanges(sql, principal, cursor);
    if (!read) return reset();
    const hold = syncMaxWaitSeconds() > 0 ? waitMs(c.req.query('wait')) : 0;
    if (hold > 0 && !read.advanced) {
      const hub = syncWakeFor(sql);
      const ticket = hub.subscribe(read.batch.workspaces);
      if (!ticket) {
        // over the cap: answer now, and say when to ask again. Jittered, so the overflow spreads out
        return c.json({ ...read.batch, retryMs: 2_000 + Math.floor(Math.random() * 3_000) });
      }
      try {
        // a commit between the read above and the subscription woke nobody: look once more
        if (!(await headsMoved(sql, read.batch.workspaces, read.revisions))) {
          const outcome = await ticket.wait(hub.healthy ? hold : Math.min(hold, DEGRADED_WAIT_MS), c.req.raw.signal);
          // the client has gone: nobody reads an answer
          if (outcome === 'aborted') return c.body(null, 204);
        }
      } finally {
        ticket.cancel();
      }
      read = await readChanges(sql, principal, cursor);
      if (!read) return reset();
    }
    return c.json(read.batch);
  });
}
