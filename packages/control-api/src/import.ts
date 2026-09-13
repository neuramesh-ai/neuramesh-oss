// The workspace import (source release 2026-09, unit U7; docs/export-format.md "Import").
// `POST /v1/workspaces/:id/import/batches` lands a workspace export (export.ts writes it, the
// desktop's driver plans it with @neuramesh/shared planBatches) inside an existing Pro workspace,
// one batch under 4 MB at a time, in EXPORT_TABLES order. Owner only, human bearer only, and the
// TARGET must be `cloud`: the plan and the subscription live on the workspace (review.md §4), so
// a move into a Free workspace would land behind the hosted gate. The local stack imports nothing.
//
// The server keeps no import table. The opening batch (seq 0, `first`) checks the export's bytes
// against the plan's storage allocation less what the target already holds, and writes nothing.
// Every later batch is one transaction that is a pure function of its body and the target's rows:
// ids are the client's (so a replay skips), parents are checked in the target (so order is a fact,
// not a promise), and the three things only the target knows come back in the response: merged
// agents and repos (`idMap`), renumbered tasks (`numberMap`), suffixed slugs (`slugMap`).
import { EXPORT_FORMAT, EXPORT_TABLES, EXPORT_VERSION, IMPORT_BATCH_MAX_BYTES, lateKeys, type Actor, type ImportBatchResult, type ImportStorage } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import { z } from 'zod';
import { sqlOf } from './credits';
import { DomainError } from './errors';
import { planDiskGb } from './fleet';
import { ImportRefusal, importBatch } from './import-batch';
import { localMode } from './localmode';
import type { Store } from './store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().uuid();

export const PRO_REFUSAL = 'This workspace needs Pro. Get Pro to migrate a workspace into it.';
export const STORAGE_REFUSAL = 'Not enough storage on this plan. Delete files in this workspace, or migrate a smaller workspace.';
export const SIZE_REFUSAL = 'The batch is over 4 MB. Send smaller batches.';

const ManifestSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  workspace: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  exportedAt: z.string(),
  counts: z.record(z.number().int().min(0)),
});

/** One batch body. Rows keep their shape: the table's columns decide what is written (import-batch.ts). */
export const ImportBatchSchema = z.object({
  importId: uuid,
  seq: z.number().int().min(0),
  table: z.enum(EXPORT_TABLES),
  rows: z.array(z.object({ id: uuid }).passthrough()),
  first: z.object({ manifest: ManifestSchema, totalBytes: z.number().int().min(0) }).optional(),
  links: z.literal(true).optional(),
  idMap: z.record(uuid, uuid).optional(),
  last: z.literal(true).optional(),
}).superRefine((b, ctx) => {
  if (b.first && (b.seq !== 0 || b.rows.length)) ctx.addIssue({ code: 'custom', message: 'The opening batch has seq 0 and no rows.' });
  if (b.links && !lateKeys(b.table).length) ctx.addIssue({ code: 'custom', message: `${b.table} has no link pass.` });
});
export type ImportBatchBody = z.infer<typeof ImportBatchSchema>;

/** The bytes the target's exportable rows hold today: the same tables the export reads, measured as stored. */
export async function workspaceBytes(sql: postgres.Sql, ws: string): Promise<number> {
  let total = 0;
  for (const t of EXPORT_TABLES) {
    const [row] = t === 'project_repos'
      ? await sql`select coalesce(sum(pg_column_size(pr.*)), 0)::bigint as b from project_repos pr join projects p on p.id = pr.project_id where p.workspace_id = ${ws}::uuid`
      : t === 'agent_channels'
        ? await sql`select coalesce(sum(pg_column_size(ac.*)), 0)::bigint as b from agent_channels ac join agents a on a.id = ac.agent_id where a.workspace_id = ${ws}::uuid`
        : await sql`select coalesce(sum(pg_column_size(t.*)), 0)::bigint as b from ${sql(t)} t where t.workspace_id = ${ws}::uuid`;
    total += Number(row?.['b'] ?? 0);
  }
  return total;
}

/** The opening batch: the storage gate, before anything is written. */
export async function openImport(sql: postgres.Sql, ws: string, plan: string, first: { totalBytes: number }): Promise<ImportBatchResult> {
  const storage: ImportStorage = { allocationBytes: planDiskGb(plan) * 1024 ** 3, usedBytes: await workspaceBytes(sql, ws), totalBytes: first.totalBytes };
  if (storage.totalBytes > storage.allocationBytes - storage.usedBytes) throw new ImportRefusal('PLAN_LIMIT', STORAGE_REFUSAL, { storage });
  return { ok: true, seq: 0, written: 0, skipped: 0, storage };
}

export function importRoutes<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store): void {
  app.post('/v1/workspaces/:id/import/batches', async (c) => {
    // a local stack has no plan and no cloud: the route does not exist there
    if (localMode()) return c.json({ error: 'not found', code: 'NOT_FOUND' }, 404);
    // the declared size first, so an oversized body is refused before it is read
    if (Number(c.req.header('content-length') ?? 0) > IMPORT_BATCH_MAX_BYTES) return c.json({ error: SIZE_REFUSAL, code: 'IMPORT_TOO_LARGE' }, 413);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'the import needs the postgres store', code: 'NOT_FOUND' }, 501);
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: 'workspace not found', code: 'NOT_FOUND' }, 404);
    const actor = c.get('actor');
    const [me] = actor.kind === 'human'
      ? await sql`select w.plan from workspace_members m join workspaces w on w.id = m.workspace_id
          where m.workspace_id = ${id}::uuid and m.user_id = ${actor.id}::uuid and m.role = 'owner'`
      : [];
    if (!me) return c.json({ error: 'Only the workspace owner can migrate a workspace into it.', code: 'NOT_PERMITTED' }, 403);
    const plan = (me['plan'] as string | null) ?? 'free';
    if (plan !== 'cloud') return c.json({ error: PRO_REFUSAL, code: 'PLAN_LIMIT' }, 402);
    const text = await c.req.text();
    if (Buffer.byteLength(text, 'utf8') > IMPORT_BATCH_MAX_BYTES) return c.json({ error: SIZE_REFUSAL, code: 'IMPORT_TOO_LARGE' }, 413);
    let raw: unknown = null;
    try { raw = JSON.parse(text); } catch { raw = null; }
    const body = ImportBatchSchema.safeParse(raw);
    if (!body.success) return c.json({ error: 'The batch is not in the import format.', code: 'IMPORT_FORMAT', issues: body.error.issues }, 400);
    try {
      const result = body.data.first ? await openImport(sql, id, plan, body.data.first) : await importBatch(sql, id, body.data);
      console.log(`import_batch workspace=${id} import=${body.data.importId} seq=${body.data.seq} table=${body.data.table}${body.data.links ? ' links' : ''} written=${result.written} skipped=${result.skipped}${body.data.last ? ' last' : ''}`);
      return c.json(result);
    } catch (e) {
      if (e instanceof DomainError) return c.json({ error: e.message, code: e.code, ...(e instanceof ImportRefusal ? e.details : {}) }, e.status as 400);
      throw e;
    }
  });
}
