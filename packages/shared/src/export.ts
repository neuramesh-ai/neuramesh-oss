// The workspace export format (source release 2026-09, unit U1b; docs/export-format.md).
//
// `GET /v1/workspaces/:id/export` streams one tar.gz: `manifest.json` first, then one JSONL file
// per table in DEPENDENCY ORDER, so a reader that inserts rows as it meets them never sees a
// foreign key before its target. Unit U7 (a local workspace moves to Cloud) reads this format,
// remaps every id, and imports it in batches; the order below is its batch order.
//
// Rows are the database's rows: snake_case column names, ids as uuid strings, timestamps as ISO
// strings, jsonb as objects. Not a client type, because the desktop's sync replica already holds
// these same shapes and the import writes them back by column. What never travels is listed in
// EXPORT_STRIPPED and in the doc: derived vectors, machine references, and paths on someone's Mac.

export const EXPORT_FORMAT = 'neuramesh-export';
export const EXPORT_VERSION = 1;

/** Dependency order. The manifest's `counts` and the archive's entries follow it. */
export const EXPORT_TABLES = [
  'projects', 'channels', 'repos', 'project_repos', 'agents', 'agent_channels',
  'threads', 'tasks', 'messages', 'artifacts', 'memory_blocks', 'facts',
] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

/** Columns removed from a row before it is written. Everything else in the table travels. */
export const EXPORT_STRIPPED: Partial<Record<ExportTable, readonly string[]>> = {
  // derived search vectors: rebuilt by the importer, and megabytes of noise otherwise
  messages: ['embedding', 'fts'],
  facts: ['embedding', 'fts'],
  // machine rows never travel (doctrine §5), so a reference to one means nothing off this machine
  agents: ['machine_id'],
  threads: ['machine_id'],
  // a path on the exporting person's disk
  repos: ['local_path'],
};

export interface ExportManifest {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  workspace: { id: string; name: string; slug: string };
  /** ISO 8601, the moment the export began */
  exportedAt: string;
  /** rows per table, in EXPORT_TABLES order; equal to the line count of each `<table>.jsonl` */
  counts: Record<ExportTable, number>;
}

/** Every exported row carries the workspace it came from, except the two join tables. */
export interface ExportRowBase { id: string; workspace_id: string }

export interface ExportProject extends ExportRowBase {
  name: string; slug: string; description: string | null; status: string; is_default: boolean; created_at: string;
  auto_open_pr: boolean; run_ci_before_merge: boolean; website: string | null; logo_url: string | null;
  ship_gate: boolean | null; model_pack: string | null;
}
export interface ExportChannel extends ExportRowBase {
  slug: string; topic: string; settings: unknown; created_at: string; project_id: string | null;
  thread_mode: string; kind: string; marketing: unknown; created_by_kind: string | null; created_by: string | null;
}
export interface ExportRepo extends ExportRowBase {
  provider: string; org_name: string; name: string; default_branch: string; clone_url: string; created_at: string;
}
export interface ExportProjectRepo { id: string; project_id: string; repo_id: string; is_primary: boolean }
export interface ExportAgent extends ExportRowBase {
  name: string; role: string; runtime: string; model: string; card: unknown; status: string; created_at: string;
  kind: string; endpoint_url: string | null; emoji: string | null; model_source: string; retired_at: string | null;
  brief: string | null; description: string | null;
}
export interface ExportAgentChannel { id: string; agent_id: string; channel_id: string; created_at: string; created_by_kind: string | null; created_by: string | null }
export interface ExportThread extends ExportRowBase {
  channel_id: string; title: string | null; description: string | null; created_by: string | null; task_id: string | null;
  created_at: string; updated_at: string; root_message_id: string | null; mode: string; brain_override: unknown;
  archived_at: string | null; filed_at: string | null; filed_reason: string | null; schedule_id: string | null;
  titled_at: string | null; origin: string | null; settled_at: string | null;
}
export interface ExportTask extends ExportRowBase {
  channel_id: string; project_id: string | null; number: number; title: string; description: string | null; state: string;
  creator_kind: string; creator_id: string; assignee_kind: string | null; assignee_id: string | null; repo_id: string | null;
  base_ref: string | null; branch: string | null; submitted_sha: string | null; requirements: unknown;
  requirements_confirmed: boolean; artifact_count: number; version: number; created_at: string; updated_at: string;
  claimed_at: string | null; submitted_at: string | null; accepted_at: string | null; closed_at: string | null;
  offered_agent_id: string | null; definition_of_done: string | null; pr_url: string | null; pr_number: number | null;
  approved_at: string | null; blocked_from: string | null; kind: string | null; ship_plan: unknown;
  parent_task_id: string | null; plan_approved_at: string | null; work_plan: unknown; origin_thread_id: string | null;
}
export interface ExportMessage extends ExportRowBase {
  channel_id: string; task_id: string | null; author_kind: string; author_id: string; body: string; created_at: string;
  edited_at: string | null; pinned: boolean; reply_to: string | null; thread_id: string | null;
}
/** Metadata plus `inline_content` (the thumbnail or the small file). Staged bytes stay on the host. */
export interface ExportArtifact extends ExportRowBase {
  channel_id: string | null; project_id: string | null; task_id: string | null; kind: string; name: string; tags: unknown;
  version: number; content_hash: string | null; storage_path: string | null; size_bytes: number | null; promoted: boolean;
  promoted_by: string | null; created_by_kind: string; created_by: string; created_at: string; inline_content: string | null;
  message_id: string | null; mime: string | null; width: number | null; height: number | null;
}
export interface ExportMemoryBlock extends ExportRowBase {
  channel_id: string | null; project_id: string | null; kind: string; content: string; basis_count: number; updated_at: string;
}
export interface ExportFact extends ExportRowBase {
  channel_id: string; content: string; basis_count: number; valid_from: string; valid_until: string | null;
  superseded_by: string | null; created_at: string; kind: string; task_id: string | null;
}

export interface ExportRows {
  projects: ExportProject; channels: ExportChannel; repos: ExportRepo; project_repos: ExportProjectRepo;
  agents: ExportAgent; agent_channels: ExportAgentChannel; threads: ExportThread; tasks: ExportTask;
  messages: ExportMessage; artifacts: ExportArtifact; memory_blocks: ExportMemoryBlock; facts: ExportFact;
}

/** The archive entry a table's rows live in. */
export const exportEntryName = (table: ExportTable): string => `${table}.jsonl`;
export const EXPORT_MANIFEST_NAME = 'manifest.json';

// ── The import (unit U7, docs/export-format.md "Import") ────────────────────────────────
//
// `POST /v1/workspaces/:id/import/batches` lands an export inside an existing Pro workspace, one
// batch at a time. The client mints a new id for every row, re-points every key, and streams the
// tables in EXPORT_TABLES order (planBatches in import.ts does that). The server keeps nothing
// between batches: a batch is a pure function of its body and of the target's own rows.

/** The body cap for one batch. Vercel refuses a request body over about 4.5 MB, so a batch stays under 4. */
export const IMPORT_BATCH_MAX_BYTES = 4 * 1024 * 1024;
/** Room a batch leaves for its envelope (importId, seq, table, the echoed idMap). planBatches fills rows to the cap minus this. */
export const IMPORT_ENVELOPE_BYTES = 64 * 1024;

export interface ImportBatch {
  /** one uuid for the whole move, the same on every batch */
  importId: string;
  /** 0 for the opening batch, then 1, 2, 3 in the order the batches must land */
  seq: number;
  table: ExportTable;
  /** rows in the table's shape: new ids, keys re-pointed, `workspace_id` set to the target. Empty on the opening batch. */
  rows: Record<string, unknown>[];
  /** the opening batch (seq 0, no rows): the server gates the storage before anything is written */
  first?: { manifest: ExportManifest; totalBytes: number };
  /** a link pass: rows carry `id`, `workspace_id` and the table's late keys only, and the server UPDATES them */
  links?: true;
  /** the merge map the server answered so far, echoed back so a row that still carries a merged id is re-pointed */
  idMap?: Record<string, string>;
  /** the final batch of the move */
  last?: true;
}

export interface ImportStorage { allocationBytes: number; usedBytes: number; totalBytes: number }

export interface ImportBatchResult {
  ok: true;
  seq: number;
  written: number;
  skipped: number;
  /** imported id to the target's own row: agents merged by name, repos merged by (provider, org_name, name) */
  idMap?: Record<string, string>;
  /** old task number to the number the target assigned */
  numberMap?: Record<string, number>;
  /** row id to the slug the target gave it, when the sent one was taken */
  slugMap?: Record<string, string>;
  /** on the opening batch: the numbers the storage gate compared */
  storage?: ImportStorage;
}

export type ImportErrorCode = 'IMPORT_FORMAT' | 'IMPORT_WORKSPACE' | 'IMPORT_ORDER' | 'IMPORT_TOO_LARGE' | 'PLAN_LIMIT' | 'NOT_PERMITTED' | 'NOT_FOUND';

export interface ImportBatchError {
  error: string;
  code: ImportErrorCode;
  /** IMPORT_ORDER: the first row whose parent is not in the target yet, the column, and the id it names */
  rowId?: string;
  column?: string;
  missing?: string;
  /** PLAN_LIMIT on the opening batch: the numbers the gate compared */
  storage?: ImportStorage;
}
