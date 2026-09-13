// One import batch, one transaction (import.ts is the route; docs/export-format.md "Import").
//
// The row pass: every row carries the target's workspace_id, a merged id the client still carries
// is re-pointed from the echoed idMap, rows whose id already exists are skipped (a replay), the
// remaps only the target can make are applied (agents and repos merge by their natural key,
// projects lose is_default and colliding slugs take a suffix, tasks take the next numbers from the
// target's counter), every parent is checked in the target (409 IMPORT_ORDER otherwise, nothing
// written), and the rest is inserted through jsonb_populate_recordset, so postgres coerces every
// column by the table's own types and the shared write list decides what lands. The link pass
// UPDATES the late keys (threads.task_id, threads.root_message_id, facts.superseded_by), which
// point at rows that land later in EXPORT_TABLES order, once those rows exist.
//
// The maps come from the rows as they are after the write, never from what this run decided, so
// a replayed batch answers the same numbers and slugs the first one did.
import { EXPORT_REFS, hasWorkspaceId, lateKeys, repoint, writeColumns, type ExportRef, type ExportTable, type ImportBatchResult } from '@neuramesh/shared';
import type postgres from 'postgres';
import { DomainError, type DomainErrorCode } from './errors';
import type { ImportBatchBody } from './import';

type Row = Record<string, unknown>;
const asSql = (tx: unknown): postgres.Sql => tx as postgres.Sql;

/** A refusal with the fields the client acts on (the row, the column, the missing id, the storage numbers). */
export class ImportRefusal extends DomainError {
  constructor(code: DomainErrorCode, message: string, readonly details: Record<string, unknown> = {}) {
    super(code, message);
  }
}

/** Identifiers in the two statements built as text come from the shared allowlists only. */
function ident(name: string): string {
  if (!/^[a-z_]+$/.test(name)) throw new Error(`not an identifier: ${name}`);
  return `"${name}"`;
}

export async function importBatch(db: postgres.Sql, ws: string, body: ImportBatchBody): Promise<ImportBatchResult> {
  return db.begin(async (tx) => {
    const sql = asSql(tx);
    const sent = body.rows as Row[];
    const rows = sent.map((r) => ({ ...r }));
    if (hasWorkspaceId(body.table)) {
      for (const r of rows) {
        if (r['workspace_id'] !== ws) throw new ImportRefusal('IMPORT_WORKSPACE', 'Every row must carry the target workspace id.', { rowId: r['id'] });
      }
    }
    // defense in depth: a merged id the client did not re-point is re-pointed here
    const idMap = body.idMap ?? {};
    for (const r of rows) for (const ref of EXPORT_REFS[body.table]) if (ref.column in r) r[ref.column] = repoint(r[ref.column], ref, idMap);
    return body.links ? linkPass(sql, ws, body.table, rows, body.seq) : rowPass(sql, ws, body.table, rows, sent, body.seq);
  }) as Promise<ImportBatchResult>;
}

async function rowPass(sql: postgres.Sql, ws: string, table: ExportTable, rows: Row[], sent: Row[], seq: number): Promise<ImportBatchResult> {
  const ids = rows.map((r) => r['id'] as string);
  const existing = new Set((await sql`select id from ${sql(table)} where id = any(${ids}::uuid[])`).map((r) => r['id'] as string));
  let fresh = rows.filter((r) => !existing.has(r['id'] as string));
  const out: ImportBatchResult = { ok: true, seq, written: 0, skipped: 0 };
  if (table === 'agents') fresh = await mergeAgents(sql, ws, fresh, out);
  if (table === 'repos') fresh = await mergeRepos(sql, ws, fresh, out);
  if (table === 'projects') {
    for (const r of fresh) r['is_default'] = false; // the target has its default project already
    await suffixSlugs(sql, ws, table, fresh);
  }
  if (table === 'channels') await suffixSlugs(sql, ws, table, fresh);
  if (table === 'tasks') {
    for (const r of fresh) {
      const [n] = await sql`select nm_next_task_number(${ws}::uuid) as n`;
      r['number'] = Number(n!['n']);
    }
  }
  await checkParents(sql, ws, table, fresh, 'rows', new Set(fresh.map((r) => r['id'] as string)));
  out.written = await insertRows(sql, table, fresh);
  out.skipped = rows.length - out.written;
  if (table === 'tasks') out.numberMap = await numberMapOf(sql, ws, ids, sent);
  if (table === 'projects' || table === 'channels') {
    const slugs = await slugMapOf(sql, ws, table, ids, sent);
    if (Object.keys(slugs).length) out.slugMap = slugs;
  }
  return out;
}

/** An agent whose name is already in the target's crew is that agent: not inserted, mapped. The rest arrive offline, they have no machine here. */
async function mergeAgents(sql: postgres.Sql, ws: string, fresh: Row[], out: ImportBatchResult): Promise<Row[]> {
  if (!fresh.length) return fresh;
  const names = fresh.map((r) => r['name'] as string);
  const found = await sql`select id, name from agents where workspace_id = ${ws}::uuid and name = any(${names}::text[])`;
  const byName = new Map(found.map((r) => [r['name'] as string, r['id'] as string]));
  const keep: Row[] = [];
  for (const r of fresh) {
    const hit = byName.get(r['name'] as string);
    if (hit) (out.idMap ??= {})[r['id'] as string] = hit;
    else { r['status'] = 'offline'; keep.push(r); }
  }
  return keep;
}

/** A repo the target already links (same provider, org and name) is that repo. */
async function mergeRepos(sql: postgres.Sql, ws: string, fresh: Row[], out: ImportBatchResult): Promise<Row[]> {
  if (!fresh.length) return fresh;
  const key = (r: Row): string => `${r['provider']}\n${r['org_name']}\n${r['name']}`;
  const found = await sql`select id, provider, org_name, name from repos where workspace_id = ${ws}::uuid and name = any(${fresh.map((r) => r['name'] as string)}::text[])`;
  const byKey = new Map(found.map((r) => [key(r as Row), r['id'] as string]));
  const keep: Row[] = [];
  for (const r of fresh) {
    const hit = byKey.get(key(r));
    if (hit) (out.idMap ??= {})[r['id'] as string] = hit;
    else keep.push(r);
  }
  return keep;
}

/** projects.slug is unique per workspace, channels.slug per project: a taken slug gets -2, -3, and so on. */
async function suffixSlugs(sql: postgres.Sql, ws: string, table: 'projects' | 'channels', fresh: Row[]): Promise<void> {
  if (!fresh.length) return;
  const taken = new Map<string, Set<string>>();
  const bucket = (scope: string): Set<string> => {
    let set = taken.get(scope);
    if (!set) taken.set(scope, (set = new Set()));
    return set;
  };
  const scopeOf = (r: Row): string => (table === 'channels' ? String(r['project_id']) : '');
  const held = table === 'channels'
    ? await sql`select project_id as scope, slug from channels where workspace_id = ${ws}::uuid and project_id = any(${[...new Set(fresh.map(scopeOf))]}::uuid[])`
    : await sql`select '' as scope, slug from projects where workspace_id = ${ws}::uuid`;
  for (const h of held) bucket(String(h['scope'])).add(h['slug'] as string);
  for (const r of fresh) {
    const set = bucket(scopeOf(r));
    const base = r['slug'] as string;
    let slug = base;
    for (let n = 2; set.has(slug); n++) slug = `${base}-${n}`;
    set.add(slug);
    r['slug'] = slug;
  }
}

/** Every parent a row names must be in the target already (or in this batch, for a same-table key). */
async function checkParents(sql: postgres.Sql, ws: string, table: ExportTable, rows: Row[], phase: 'rows' | 'links', inBatch: Set<string>): Promise<void> {
  const refs = EXPORT_REFS[table].filter((r): r is ExportRef & { to: ExportTable } => r.to !== 'actor' && !!r.late === (phase === 'links'));
  for (const ref of refs) {
    const wanted = new Map<string, string>(); // parent id to the first row that names it
    for (const r of rows) {
      const v = r[ref.column];
      if (typeof v === 'string' && !wanted.has(v) && !(ref.to === table && inBatch.has(v))) wanted.set(v, r['id'] as string);
    }
    if (!wanted.size) continue;
    const found = new Set((await sql`select id from ${sql(ref.to)} where id = any(${[...wanted.keys()]}::uuid[]) and workspace_id = ${ws}::uuid`).map((r) => r['id'] as string));
    for (const [parent, rowId] of wanted) {
      if (found.has(parent)) continue;
      throw new ImportRefusal('IMPORT_ORDER', `Row ${rowId} names ${ref.column} ${parent}, which is not in the workspace yet. Send the ${ref.to} rows first.`, { rowId, column: ref.column, missing: parent });
    }
  }
}

// `$1::text::jsonb`, not `$1::jsonb`: described as jsonb, the driver would JSON-encode the text again.
// The two join tables skip on ANY unique key, not on id alone: their natural key is the pair, and a
// merged agent re-pointed onto a room it already reads is the same registration under a new id.
async function insertRows(sql: postgres.Sql, table: ExportTable, fresh: Row[]): Promise<number> {
  if (!fresh.length) return 0;
  const cols = writeColumns(table).map(ident).join(', ');
  const conflict = hasWorkspaceId(table) ? 'on conflict (id) do nothing' : 'on conflict do nothing';
  const inserted = await sql.unsafe(
    `insert into ${ident(table)} (${cols}) select ${cols} from jsonb_populate_recordset(null::${ident(table)}, $1::text::jsonb) ${conflict} returning id`,
    [JSON.stringify(fresh)],
  );
  return inserted.length;
}

/** The link pass: the rows exist, their late parents exist, and the keys are set. A row already linked so is skipped. */
async function linkPass(sql: postgres.Sql, ws: string, table: ExportTable, rows: Row[], seq: number): Promise<ImportBatchResult> {
  const late = lateKeys(table);
  const ids = rows.map((r) => r['id'] as string);
  const present = new Set((await sql`select id from ${sql(table)} where id = any(${ids}::uuid[]) and workspace_id = ${ws}::uuid`).map((r) => r['id'] as string));
  for (const id of ids) {
    if (!present.has(id)) throw new ImportRefusal('IMPORT_ORDER', `Row ${id} is not in the workspace yet. Send the ${table} rows before their links.`, { rowId: id, column: 'id', missing: id });
  }
  await checkParents(sql, ws, table, rows, 'links', new Set());
  const set = late.map((c) => `${ident(c)} = v.${ident(c)}`).join(', ');
  const before = late.map((c) => `t.${ident(c)}`).join(', ');
  const after = late.map((c) => `v.${ident(c)}`).join(', ');
  const updated = await sql.unsafe(
    `update ${ident(table)} t set ${set} from jsonb_populate_recordset(null::${ident(table)}, $1::text::jsonb) v
      where t.id = v.id and t.workspace_id = $2::uuid and row(${before}) is distinct from row(${after}) returning t.id`,
    [JSON.stringify(rows), ws],
  );
  return { ok: true, seq, written: updated.length, skipped: rows.length - updated.length };
}

/** old number to the number the target holds, for every task of the batch that is in the target */
async function numberMapOf(sql: postgres.Sql, ws: string, ids: string[], sent: Row[]): Promise<Record<string, number>> {
  const held = await sql`select id, number from tasks where id = any(${ids}::uuid[]) and workspace_id = ${ws}::uuid`;
  const byId = new Map(held.map((r) => [r['id'] as string, Number(r['number'])]));
  const map: Record<string, number> = {};
  for (const r of sent) {
    const now = byId.get(r['id'] as string);
    if (now !== undefined) map[String(r['number'])] = now;
  }
  return map;
}

/** row id to the slug the target holds, where it differs from the one sent */
async function slugMapOf(sql: postgres.Sql, ws: string, table: 'projects' | 'channels', ids: string[], sent: Row[]): Promise<Record<string, string>> {
  const held = await sql`select id, slug from ${sql(table)} where id = any(${ids}::uuid[]) and workspace_id = ${ws}::uuid`;
  const byId = new Map(held.map((r) => [r['id'] as string, r['slug'] as string]));
  const map: Record<string, string> = {};
  for (const r of sent) {
    const now = byId.get(r['id'] as string);
    if (now !== undefined && now !== r['slug']) map[r['id'] as string] = now;
  }
  return map;
}
