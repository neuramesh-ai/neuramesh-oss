// The workspace export (source release 2026-09, unit U1b; the format lives in
// @neuramesh/shared export.ts and docs/export-format.md). GET /v1/workspaces/:id/export streams
// one tar.gz to the workspace OWNER on a human bearer: manifest.json, then one JSONL file per table
// in dependency order. It is exempt from the hosted write gate because it is the way out of a Free
// workspace, and it is a read. Unit U7 imports what this writes.
//
// Streamed, never buffered whole: one table's rows are in memory at a time (a tar header carries
// the entry's size, so an entry is complete before its header is written), and the gzip stream
// leaves as each entry lands. Vercel streams the response.
//
// What never travels, by construction rather than by a denylist someone remembers: the table list
// IS the allowlist (EXPORT_TABLES), so credentials, machines, tokens, invites, devices, emails and
// the credit ledger are not queried at all, and EXPORT_STRIPPED drops the per-row columns that
// name a machine, a local path, or a derived vector.
import { EXPORT_FORMAT, EXPORT_MANIFEST_NAME, EXPORT_STRIPPED, EXPORT_TABLES, EXPORT_VERSION, exportEntryName, type Actor, type ExportManifest, type ExportTable } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import { pipeline, Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { sqlOf } from './credits';
import type { Store } from './store';
import { tarStream, type TarEntry } from './tar';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A stable order per table: creation time where the table has one, then id. */
const ORDER_BY: Partial<Record<ExportTable, string>> = { memory_blocks: 'updated_at', project_repos: 'id' };

/** The rows of one table for one workspace. The two join tables reach the workspace through their parent. */
function rowsOf(sql: postgres.Sql, table: ExportTable, ws: string): Promise<postgres.RowList<postgres.Row[]>> {
  const order = ORDER_BY[table] ?? 'created_at';
  if (table === 'project_repos') {
    return sql`select pr.* from project_repos pr join projects p on p.id = pr.project_id where p.workspace_id = ${ws}::uuid order by pr.id`;
  }
  if (table === 'agent_channels') {
    return sql`select ac.* from agent_channels ac join agents a on a.id = ac.agent_id where a.workspace_id = ${ws}::uuid order by ac.created_at, ac.id`;
  }
  return sql`select * from ${sql(table)} where workspace_id = ${ws}::uuid order by ${sql(order)}, id`;
}

function countOf(sql: postgres.Sql, table: ExportTable, ws: string): Promise<postgres.RowList<postgres.Row[]>> {
  if (table === 'project_repos') return sql`select count(*)::int as c from project_repos pr join projects p on p.id = pr.project_id where p.workspace_id = ${ws}::uuid`;
  if (table === 'agent_channels') return sql`select count(*)::int as c from agent_channels ac join agents a on a.id = ac.agent_id where a.workspace_id = ${ws}::uuid`;
  return sql`select count(*)::int as c from ${sql(table)} where workspace_id = ${ws}::uuid`;
}

/** One JSON object per line, stripped columns removed, Dates as ISO strings (JSON.stringify does that). */
function toJsonl(table: ExportTable, rows: readonly postgres.Row[]): Buffer {
  const drop = new Set(EXPORT_STRIPPED[table] ?? []);
  const lines = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) if (!drop.has(k)) out[k] = v;
    return JSON.stringify(out);
  });
  return Buffer.from(lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
}

/** The archive's entries, manifest first. Exported for the pg test, which reads it back. */
export async function* exportEntries(sql: postgres.Sql, ws: { id: string; name: string; slug: string }): AsyncGenerator<TarEntry> {
  const exportedAt = new Date();
  const counts = {} as Record<ExportTable, number>;
  for (const t of EXPORT_TABLES) counts[t] = Number((await countOf(sql, t, ws.id))[0]?.['c'] ?? 0);
  const manifest: ExportManifest = { format: EXPORT_FORMAT, version: EXPORT_VERSION, workspace: ws, exportedAt: exportedAt.toISOString(), counts };
  yield { name: EXPORT_MANIFEST_NAME, data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), mtime: exportedAt };
  for (const t of EXPORT_TABLES) {
    yield { name: exportEntryName(t), data: toJsonl(t, await rowsOf(sql, t, ws.id)), mtime: exportedAt };
  }
}

export function exportRoutes<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store): void {
  app.get('/v1/workspaces/:id/export', async (c) => {
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'the export needs the postgres store', code: 'NOT_FOUND' }, 501);
    const actor = c.get('actor');
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: 'workspace not found', code: 'NOT_FOUND' }, 404);
    // owner only, human only: an agent never exports, and a member who is not the owner is refused
    const [me] = actor.kind === 'human'
      ? await sql`select w.name, w.slug from workspace_members m join workspaces w on w.id = m.workspace_id
          where m.workspace_id = ${id}::uuid and m.user_id = ${actor.id}::uuid and m.role = 'owner'`
      : [];
    if (!me) return c.json({ error: 'Only the workspace owner can export it.', code: 'NOT_PERMITTED' }, 403);
    const ws = { id, name: me['name'] as string, slug: me['slug'] as string };
    // pipeline, not pipe: a query that fails mid-stream destroys the gzip stream too, so the client
    // reads a broken body instead of a silently short archive, and nothing is left unhandled
    const body = pipeline(Readable.from(tarStream(exportEntries(sql, ws))), createGzip(), (err) => {
      if (err) console.error(`export_failed workspace=${id}: ${err.message}`);
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(Readable.toWeb(body) as unknown as ReadableStream, {
      status: 200,
      headers: {
        'content-type': 'application/gzip',
        'content-disposition': `attachment; filename="neuramesh-${ws.slug}-${stamp}.tar.gz"`,
        'cache-control': 'no-store',
      },
    });
  });
}
