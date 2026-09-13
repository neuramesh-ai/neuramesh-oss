// The client half of the import (source release 2026-09, unit U7; docs/export-format.md
// "Import"). The desktop reads a workspace export, plans the batches with planBatches, streams
// them to the target Pro workspace, and rewrites `#123` in message bodies with rewriteTaskRefs
// once the server has answered with the new numbers. Everything here is pure, so the desktop
// half streams exactly what the tests here proved and a retry plans the same batches again.
//
// Two maps drive both halves and are the format's own description of itself: IMPORT_COLUMNS
// names every column that travels (the server writes these and nothing else, so `machine_id`,
// `local_path`, `embedding` and `fts` can never land), and EXPORT_REFS names every column that
// points at another row (the client re-points them, the server checks the parents exist).
import {
  EXPORT_MANIFEST_NAME, EXPORT_FORMAT, EXPORT_STRIPPED, EXPORT_TABLES, EXPORT_VERSION, IMPORT_BATCH_MAX_BYTES,
  IMPORT_ENVELOPE_BYTES, exportEntryName,
  type ExportManifest, type ExportRows, type ExportTable, type ImportBatch,
} from './export';

/** Every column of every exported row, per table. Checked both ways against the row types below. */
export const IMPORT_COLUMNS = {
  projects: ['id', 'workspace_id', 'name', 'slug', 'description', 'status', 'is_default', 'created_at', 'auto_open_pr', 'run_ci_before_merge', 'website', 'logo_url', 'ship_gate', 'model_pack'],
  channels: ['id', 'workspace_id', 'slug', 'topic', 'settings', 'created_at', 'project_id', 'thread_mode', 'kind', 'marketing', 'created_by_kind', 'created_by'],
  repos: ['id', 'workspace_id', 'provider', 'org_name', 'name', 'default_branch', 'clone_url', 'created_at'],
  project_repos: ['id', 'project_id', 'repo_id', 'is_primary'],
  agents: ['id', 'workspace_id', 'name', 'role', 'runtime', 'model', 'card', 'status', 'created_at', 'kind', 'endpoint_url', 'emoji', 'model_source', 'retired_at', 'brief', 'description'],
  agent_channels: ['id', 'agent_id', 'channel_id', 'created_at', 'created_by_kind', 'created_by'],
  threads: ['id', 'workspace_id', 'channel_id', 'title', 'description', 'created_by', 'task_id', 'created_at', 'updated_at', 'root_message_id', 'mode', 'brain_override', 'archived_at', 'filed_at', 'filed_reason', 'schedule_id', 'titled_at', 'origin', 'settled_at'],
  tasks: ['id', 'workspace_id', 'channel_id', 'project_id', 'number', 'title', 'description', 'state', 'creator_kind', 'creator_id', 'assignee_kind', 'assignee_id', 'repo_id', 'base_ref', 'branch', 'submitted_sha', 'requirements', 'requirements_confirmed', 'artifact_count', 'version', 'created_at', 'updated_at', 'claimed_at', 'submitted_at', 'accepted_at', 'closed_at', 'offered_agent_id', 'definition_of_done', 'pr_url', 'pr_number', 'approved_at', 'blocked_from', 'kind', 'ship_plan', 'parent_task_id', 'plan_approved_at', 'work_plan', 'origin_thread_id'],
  messages: ['id', 'workspace_id', 'channel_id', 'task_id', 'author_kind', 'author_id', 'body', 'created_at', 'edited_at', 'pinned', 'reply_to', 'thread_id'],
  artifacts: ['id', 'workspace_id', 'channel_id', 'project_id', 'task_id', 'kind', 'name', 'tags', 'version', 'content_hash', 'storage_path', 'size_bytes', 'promoted', 'promoted_by', 'created_by_kind', 'created_by', 'created_at', 'inline_content', 'message_id', 'mime', 'width', 'height'],
  memory_blocks: ['id', 'workspace_id', 'channel_id', 'project_id', 'kind', 'content', 'basis_count', 'updated_at'],
  facts: ['id', 'workspace_id', 'channel_id', 'content', 'basis_count', 'valid_from', 'valid_until', 'superseded_by', 'created_at', 'kind', 'task_id'],
} as const satisfies { [T in ExportTable]: ReadonlyArray<keyof ExportRows[T] & string> };

// the other direction: a column on a row type that the list above forgot fails to compile here
type Unlisted = { [T in ExportTable]: Exclude<keyof ExportRows[T], (typeof IMPORT_COLUMNS)[T][number]> }[ExportTable];
const _everyColumnListed: [Unlisted] extends [never] ? true : never = true;

/** Exported, never written: the column names a row outside the export (a schedule), so the import leaves it null. */
export const IMPORT_UNWRITTEN: Partial<Record<ExportTable, readonly string[]>> = { threads: ['schedule_id'] };

/** A column that names another row. `late` keys point FORWARD in EXPORT_TABLES order (or to a
 *  newer row of the same table), so they ride a link pass after every row has landed. `actor`
 *  columns name a human or an agent: re-pointed when they name an exported agent, never checked
 *  as a parent. `address` marks the `kind:id` string form threads.created_by uses. */
export interface ExportRef { column: string; to: ExportTable | 'actor'; late?: true; address?: true }

export const EXPORT_REFS: Record<ExportTable, readonly ExportRef[]> = {
  projects: [],
  channels: [{ column: 'project_id', to: 'projects' }, { column: 'created_by', to: 'actor' }],
  repos: [],
  project_repos: [{ column: 'project_id', to: 'projects' }, { column: 'repo_id', to: 'repos' }],
  agents: [],
  agent_channels: [{ column: 'agent_id', to: 'agents' }, { column: 'channel_id', to: 'channels' }, { column: 'created_by', to: 'actor' }],
  threads: [
    { column: 'channel_id', to: 'channels' }, { column: 'created_by', to: 'actor', address: true },
    { column: 'task_id', to: 'tasks', late: true }, { column: 'root_message_id', to: 'messages', late: true },
  ],
  tasks: [
    { column: 'channel_id', to: 'channels' }, { column: 'project_id', to: 'projects' }, { column: 'repo_id', to: 'repos' },
    { column: 'offered_agent_id', to: 'agents' }, { column: 'parent_task_id', to: 'tasks' }, { column: 'origin_thread_id', to: 'threads' },
    { column: 'creator_id', to: 'actor' }, { column: 'assignee_id', to: 'actor' },
  ],
  messages: [
    { column: 'channel_id', to: 'channels' }, { column: 'task_id', to: 'tasks' }, { column: 'thread_id', to: 'threads' },
    { column: 'reply_to', to: 'messages' }, { column: 'author_id', to: 'actor' },
  ],
  artifacts: [
    { column: 'channel_id', to: 'channels' }, { column: 'project_id', to: 'projects' }, { column: 'task_id', to: 'tasks' },
    { column: 'message_id', to: 'messages' }, { column: 'promoted_by', to: 'agents' }, { column: 'created_by', to: 'actor' },
  ],
  memory_blocks: [{ column: 'channel_id', to: 'channels' }, { column: 'project_id', to: 'projects' }],
  facts: [{ column: 'channel_id', to: 'channels' }, { column: 'task_id', to: 'tasks' }, { column: 'superseded_by', to: 'facts', late: true }],
};

export const lateKeys = (table: ExportTable): string[] => EXPORT_REFS[table].filter((r) => r.late).map((r) => r.column);
/** The tables with a link pass, in EXPORT_TABLES order. */
export const LINK_TABLES: readonly ExportTable[] = EXPORT_TABLES.filter((t) => lateKeys(t).length > 0);
/** The columns the row pass writes: every column, less the late keys and the unwritten ones. */
export function writeColumns(table: ExportTable): string[] {
  const skip = new Set([...lateKeys(table), ...(IMPORT_UNWRITTEN[table] ?? [])]);
  return (IMPORT_COLUMNS[table] as readonly string[]).filter((c) => !skip.has(c));
}
/** Every row carries the workspace it came from, except the two join tables. */
export const hasWorkspaceId = (table: ExportTable): boolean => table !== 'project_repos' && table !== 'agent_channels';

// ── reading an export ─────────────────────────────────────────────────────────────────────

export interface ParsedExport { manifest: ExportManifest; rows: { [T in ExportTable]: Array<ExportRows[T]> } }

/** The archive's entries, decoded, as one object. Throws a plain Error a sheet can show. */
export function parseExport(entries: ReadonlyArray<{ name: string; text: string }>): ParsedExport {
  const manifestEntry = entries.find((e) => e.name === EXPORT_MANIFEST_NAME);
  if (!manifestEntry) throw new Error('The file has no manifest.json. It is not a NeuraMesh export.');
  const manifest = JSON.parse(manifestEntry.text) as ExportManifest;
  if (manifest.format !== EXPORT_FORMAT) throw new Error('The file is not a NeuraMesh export.');
  if (manifest.version !== EXPORT_VERSION) throw new Error(`The export is version ${manifest.version}. This app reads version ${EXPORT_VERSION}.`);
  const rows = {} as ParsedExport['rows'];
  for (const t of EXPORT_TABLES) {
    const entry = entries.find((e) => e.name === exportEntryName(t));
    if (!entry) throw new Error(`The export has no ${exportEntryName(t)}.`);
    const parsed = entry.text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as ExportRows[typeof t]);
    if (parsed.length !== manifest.counts[t]) throw new Error(`${exportEntryName(t)} has ${parsed.length} rows. The manifest says ${manifest.counts[t]}.`);
    (rows as Record<string, unknown[]>)[t] = parsed;
  }
  return { manifest, rows };
}

// ── planning the batches ──────────────────────────────────────────────────────────────────

export interface PlanOptions {
  targetWorkspaceId: string;
  /** one uuid for the move. A retry that passes the same one plans the same batches. */
  importId: string;
  /** a new id for an old one. Deterministic when the caller makes it so (a uuid v5 of importId and the old id, for example). */
  mint: (oldId: string) => string;
  /** the rows' share of one batch body, default IMPORT_BATCH_MAX_BYTES less IMPORT_ENVELOPE_BYTES */
  maxBytes?: number;
}

export interface TooLargeRow { table: ExportTable; id: string; bytes: number; because?: string }

export interface ImportPlan {
  batches: ImportBatch[];
  /** the bytes of every row the batches carry, what the opening batch declares */
  totalBytes: number;
  /** rows over the cap on their own, and rows that name one of them: they stay where they are */
  tooLarge: TooLargeRow[];
  /** old id to new id, every row */
  ids: Record<string, string>;
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/** The re-pointed value of one ref column: `kind:id` keeps its kind, an unknown id stays as it is. */
export function repoint(value: unknown, ref: ExportRef, ids: Readonly<Record<string, string>>): unknown {
  if (typeof value !== 'string') return value;
  if (ref.address) {
    const at = value.indexOf(':');
    if (at < 0) return value;
    const id = value.slice(at + 1);
    return ids[id] ? `${value.slice(0, at + 1)}${ids[id]}` : value;
  }
  return ids[value] ?? value;
}

interface Prepared { rows: Record<string, unknown>[]; links: Record<string, unknown>[]; bytes: number }

/** One table's rows for the row pass and the link pass: stripped, re-pointed, sized. Rows over the
 *  cap, and rows that name one, go to `tooLarge` and their new ids to `left`. */
function prepareTable(t: ExportTable, exp: ParsedExport, ids: Record<string, string>, opts: PlanOptions, maxBytes: number, left: Set<string>, tooLarge: TooLargeRow[]): Prepared {
  const drop = new Set(EXPORT_STRIPPED[t] ?? []);
  const late = EXPORT_REFS[t].filter((r) => r.late);
  const early = EXPORT_REFS[t].filter((r) => !r.late);
  const out: Prepared = { rows: [], links: [], bytes: 0 };
  for (const source of exp.rows[t] as unknown as ReadonlyArray<Record<string, unknown>>) {
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(source)) if (!drop.has(k) && !late.some((r) => r.column === k)) row[k] = v;
    row['id'] = ids[source['id'] as string];
    if (hasWorkspaceId(t)) row['workspace_id'] = opts.targetWorkspaceId;
    let because: string | undefined;
    for (const ref of early) {
      const v = repoint(source[ref.column], ref, ids);
      row[ref.column] = v;
      if (typeof v === 'string' && left.has(v)) because = v;
    }
    const bytes = utf8Bytes(JSON.stringify(row));
    if (bytes > maxBytes || because) {
      tooLarge.push({ table: t, id: row['id'] as string, bytes, ...(because ? { because } : {}) });
      left.add(row['id'] as string);
      continue;
    }
    out.bytes += bytes;
    out.rows.push(row);
    if (!late.length) continue;
    const link: Record<string, unknown> = { id: row['id'], workspace_id: opts.targetWorkspaceId };
    for (const ref of late) {
      const v = repoint(source[ref.column], ref, ids);
      link[ref.column] = typeof v === 'string' && left.has(v) ? null : v;
    }
    if (late.some((ref) => link[ref.column] != null)) out.links.push(link);
  }
  return out;
}

/** Rows into batches under the cap, appended to `batches` with the next seq numbers. */
function chunk(batches: ImportBatch[], importId: string, table: ExportTable, rows: Record<string, unknown>[], links: boolean, maxBytes: number): void {
  let batch: Record<string, unknown>[] = [];
  let bytes = 0;
  const flush = (): void => {
    if (!batch.length) return;
    batches.push({ importId, seq: batches.length, table, rows: batch, ...(links ? { links: true as const } : {}) });
    batch = [];
    bytes = 0;
  };
  for (const row of rows) {
    const b = utf8Bytes(JSON.stringify(row)) + 1;
    if (batch.length && bytes + b > maxBytes) flush();
    batch.push(row);
    bytes += b;
  }
  flush();
}

/** Turns a parsed export into the ordered batches the import lane accepts. Pure: the same export,
 *  target, importId and mint plan the same batches. */
export function planBatches(exp: ParsedExport, opts: PlanOptions): ImportPlan {
  const maxBytes = opts.maxBytes ?? IMPORT_BATCH_MAX_BYTES - IMPORT_ENVELOPE_BYTES;
  const ids: Record<string, string> = {};
  for (const t of EXPORT_TABLES) for (const row of exp.rows[t]) ids[row.id] = opts.mint(row.id);
  const tooLarge: TooLargeRow[] = [];
  const left = new Set<string>();
  const prepared = new Map<ExportTable, Prepared>();
  let totalBytes = 0;
  for (const t of EXPORT_TABLES) {
    const p = prepareTable(t, exp, ids, opts, maxBytes, left, tooLarge);
    prepared.set(t, p);
    totalBytes += p.bytes;
  }
  const batches: ImportBatch[] = [{ importId: opts.importId, seq: 0, table: EXPORT_TABLES[0], rows: [], first: { manifest: exp.manifest, totalBytes } }];
  for (const t of EXPORT_TABLES) chunk(batches, opts.importId, t, prepared.get(t)!.rows, false, maxBytes);
  for (const t of LINK_TABLES) chunk(batches, opts.importId, t, prepared.get(t)!.links, true, maxBytes);
  batches[batches.length - 1]!.last = true;
  return { batches, totalBytes, tooLarge, ids };
}

// ── task numbers in prose ─────────────────────────────────────────────────────────────────

/** `#12` becomes `#40` when the map says so. A number the map lacks, and a `#` inside a word, stay as they are. */
export function rewriteTaskRefs(text: string, numberMap: Readonly<Record<string, number>>): string {
  return text.replace(/(^|[^\w#])#(\d+)(?!\w)/g, (whole, before: string, n: string) => {
    const to = numberMap[n];
    return to === undefined ? whole : `${before}#${to}`;
  });
}
