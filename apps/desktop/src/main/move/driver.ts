// THE MOVE DRIVER — a local workspace into a Pro workspace (source release 2026-09, unit U7;
// docs/export-format.md "Import", artboards H1 and H2). Two steps, both pure around an injected
// fetch, emit and clock, so the electron half (moveipc.ts) supplies the real ones and the tests
// script a server:
//
//   planMove   reads the LOCAL export (GET /v1/workspaces/:id/export), plans the batches with the
//              shared planBatches under a deterministic mint, rewrites the local human's id to the
//              cloud user's, and sends the OPENING batch to the target. That batch writes nothing:
//              it answers the storage numbers the sheet shows, or refuses PLAN_LIMIT before a row
//              lands. A retry re-uses the importId the progress file holds, so it plans the same ids.
//   runMove    streams the batches in order, re-points every ref with the maps the server answered
//              so far, rewrites `#12` in prose once the tasks have landed, echoes the idMap, persists
//              the progress after every batch (a cancel or a failure resumes from there with the
//              same importId), and on the last OK writes the moved marker. Local rows are never
//              touched: the replica is the backup.
import { randomUUID } from 'node:crypto';
import {
  EXPORT_REFS, parseExport, planBatches, repoint, rewriteTaskRefs,
  type ExportTable, type ImportBatch, type ImportBatchError, type ImportBatchResult, type ImportErrorCode, type ImportPlan, type ImportStorage, type ParsedExport, type TooLargeRow,
} from '@neuramesh/shared';
import { rewriteHumanActors } from './actors';
import type { MoveFiles, MoveTarget, MovedMarker } from './files';
import { mintFor } from './mint';
import { exportEntriesOf } from './untar';

type Row = Record<string, unknown>;

/** one side of the move: where to call, which workspace, and the headers that side's credential mints */
export interface MoveEndpoint { apiUrl: string; workspaceId: string; headers: () => Promise<Record<string, string>> }

export type MovePhase = 'idle' | 'planning' | 'ready' | 'moving' | 'done' | 'error';
export interface MovePush {
  phase: MovePhase;
  /** the batch in flight (1-based), of `total` batches after the opening one */
  seq?: number;
  total?: number;
  /** rows written and skipped so far */
  written?: number;
  skipped?: number;
  message?: string;
  code?: ImportErrorCode | 'FAILED';
  /** the table the move stopped at (IMPORT_ORDER) */
  table?: ExportTable;
  storage?: ImportStorage;
}

export interface MoveDeps {
  fetchImpl: typeof fetch;
  emit: (p: MovePush) => void;
  now: () => number;
  files: MoveFiles;
  log?: (line: string) => void;
  /** a fresh importId when no progress file names one. Injectable for determinism in tests. */
  importId?: () => string;
}

/** a refusal from the server, with the fields the sheet says out loud */
export class MoveRefusal extends Error {
  constructor(readonly code: ImportErrorCode | 'FAILED', message: string, readonly details: Partial<ImportBatchError> & { status?: number } = {}) {
    super(message);
  }
}

async function readExport(d: MoveDeps, source: MoveEndpoint): Promise<ParsedExport> {
  const res = await d.fetchImpl(`${source.apiUrl}/v1/workspaces/${encodeURIComponent(source.workspaceId)}/export`, { headers: await source.headers() });
  if (!res.ok) throw new MoveRefusal('FAILED', `The export did not download (${res.status}).`, { status: res.status });
  return parseExport(exportEntriesOf(Buffer.from(await res.arrayBuffer())));
}

async function send(d: MoveDeps, target: MoveEndpoint, body: ImportBatch): Promise<ImportBatchResult> {
  const res = await d.fetchImpl(`${target.apiUrl}/v1/workspaces/${encodeURIComponent(target.workspaceId)}/import/batches`, { method: 'POST', headers: await target.headers(), body: JSON.stringify(body) });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!res.ok) {
    const e = (parsed ?? {}) as Partial<ImportBatchError>;
    throw new MoveRefusal(e.code ?? 'FAILED', e.error ?? `The server answered ${res.status}.`, { ...e, status: res.status });
  }
  return parsed as ImportBatchResult;
}

export interface MovePlanned {
  importId: string;
  parsed: ParsedExport;
  plan: ImportPlan;
  /** the plan's batches with the local human rewritten to the cloud user */
  batches: ImportBatch[];
  storage: ImportStorage;
  counts: Record<ExportTable, number>;
  totalBytes: number;
  tooLarge: TooLargeRow[];
  agents: string[];
  /** the batch a retry resumes at (1 when nothing landed yet) */
  resumeSeq: number;
}

/** the numbers for the sheet, and nothing written: the export read, the batches planned, the opening batch answered */
export async function planMove(d: MoveDeps, source: MoveEndpoint, target: MoveEndpoint, actors: { localHumanId: string; cloudUserId: string }): Promise<MovePlanned> {
  const t0 = d.now();
  d.emit({ phase: 'planning' });
  const parsed = await readExport(d, source);
  const progress = d.files.readProgress();
  const resume = progress && progress.targetWorkspaceId === target.workspaceId ? progress : null;
  const importId = resume?.importId ?? (d.importId ?? randomUUID)();
  const plan = planBatches(parsed, { targetWorkspaceId: target.workspaceId, importId, mint: mintFor(importId) });
  const batches = plan.batches.map((b) => (b.links || !b.rows.length ? b : { ...b, rows: rewriteHumanActors(b.table, b.rows, actors.localHumanId, actors.cloudUserId) }));
  // a resume declares only the bytes still to send: the rows that landed already count in the
  // target's usedBytes, and declaring them twice could refuse a resume on a nearly full plan
  const resumeSeq = resume?.nextSeq ?? 1;
  const remaining = resumeSeq > 1 ? bytesOf(batches.slice(resumeSeq)) : plan.totalBytes;
  const opening = await send(d, target, { ...batches[0]!, first: { ...batches[0]!.first!, totalBytes: remaining } });
  const storage = opening.storage ?? { allocationBytes: 0, usedBytes: 0, totalBytes: plan.totalBytes };
  d.log?.(`move_plan source=${source.workspaceId.slice(0, 8)} target=${target.workspaceId.slice(0, 8)} import=${importId.slice(0, 8)} batches=${batches.length - 1} bytes=${plan.totalBytes} too_large=${plan.tooLarge.length} resume_seq=${resume?.nextSeq ?? 1} ms=${(d.now() - t0).toFixed(0)}`);
  return {
    importId, parsed, plan, batches, storage,
    counts: parsed.manifest.counts, totalBytes: plan.totalBytes, tooLarge: plan.tooLarge,
    agents: parsed.rows.agents.map((a) => a.name), resumeSeq,
  };
}

/** the bytes of the rows a set of batches carries, as planBatches counts them (the link passes are small and count too) */
const bytesOf = (batches: readonly ImportBatch[]): number => batches.reduce((n, b) => n + b.rows.reduce((m, r) => m + Buffer.byteLength(JSON.stringify(r), 'utf8'), 0), 0);

/** prose that names a task by number: rewritten with the numbers the target assigned so far */
const TEXT_COLUMNS: Partial<Record<ExportTable, readonly string[]>> = { tasks: ['title', 'description', 'definition_of_done'], messages: ['body'] };

/** a batch's rows as they are sent: every ref re-pointed with the maps so far, `#12` rewritten in prose */
export function prepareRows(batch: ImportBatch, idMap: Readonly<Record<string, string>>, numberMap: Readonly<Record<string, number>>): Row[] {
  const refs = EXPORT_REFS[batch.table];
  const text = batch.links ? [] : TEXT_COLUMNS[batch.table] ?? [];
  return batch.rows.map((r) => {
    const out: Row = { ...r };
    for (const ref of refs) if (ref.column in out) out[ref.column] = repoint(out[ref.column], ref, idMap);
    for (const col of text) { const v = out[col]; if (typeof v === 'string') out[col] = rewriteTaskRefs(v, numberMap); }
    return out;
  });
}

export type MoveOutcome =
  | { status: 'done'; marker: MovedMarker }
  | { status: 'cancelled'; nextSeq: number }
  | { status: 'error'; refusal: MoveRefusal; nextSeq: number };

/** the batches after the opening one, in order, resuming where the progress file says */
export async function runMove(d: MoveDeps, planned: MovePlanned, endpoint: MoveEndpoint, target: MoveTarget, cancelled: () => boolean): Promise<MoveOutcome> {
  const t0 = d.now();
  const progress = d.files.readProgress();
  const resume = progress?.importId === planned.importId ? progress : null;
  const idMap: Record<string, string> = { ...(resume?.idMap ?? {}) };
  const numberMap: Record<string, number> = { ...(resume?.numberMap ?? {}) };
  const slugMap: Record<string, string> = { ...(resume?.slugMap ?? {}) };
  const total = planned.batches.length - 1;
  let written = 0;
  let skipped = 0;
  const save = (nextSeq: number): void => d.files.writeProgress({ importId: planned.importId, targetWorkspaceId: target.workspaceId, nextSeq, idMap, numberMap, slugMap });
  for (let seq = resume?.nextSeq ?? 1; seq <= total; seq++) {
    if (cancelled()) {
      save(seq);
      d.log?.(`move_cancel seq=${seq} total=${total}`);
      d.emit({ phase: 'ready', seq, total, written, skipped });
      return { status: 'cancelled', nextSeq: seq };
    }
    const batch = planned.batches[seq]!;
    d.emit({ phase: 'moving', seq, total, written, skipped });
    const t1 = d.now();
    let res: ImportBatchResult;
    try {
      res = await send(d, endpoint, { ...batch, rows: prepareRows(batch, idMap, numberMap), ...(Object.keys(idMap).length ? { idMap } : {}) });
    } catch (e) {
      const refusal = e instanceof MoveRefusal ? e : new MoveRefusal('FAILED', e instanceof Error ? e.message : String(e));
      save(seq);
      d.log?.(`move_error code=${refusal.code} seq=${seq} table=${batch.table}${batch.links ? ' links' : ''}`);
      d.emit({ phase: 'error', code: refusal.code, message: refusal.message, seq, total, written, skipped, table: batch.table, storage: refusal.details.storage });
      return { status: 'error', refusal, nextSeq: seq };
    }
    Object.assign(idMap, res.idMap ?? {});
    Object.assign(numberMap, res.numberMap ?? {});
    Object.assign(slugMap, res.slugMap ?? {});
    written += res.written;
    skipped += res.skipped;
    save(seq + 1);
    d.log?.(`move_batch seq=${seq} table=${batch.table}${batch.links ? ' links' : ''} written=${res.written} skipped=${res.skipped} ms=${(d.now() - t1).toFixed(0)}`);
  }
  const marker: MovedMarker = { importId: planned.importId, movedAt: new Date(d.now()).toISOString(), target, counts: planned.counts, totalBytes: planned.totalBytes, numberMap };
  d.files.writeMarker(marker);
  d.files.clearProgress();
  d.log?.(`move_done ms=${(d.now() - t0).toFixed(0)} rows=${written} skipped=${skipped} batches=${total}`);
  d.emit({ phase: 'done', seq: total, total, written, skipped });
  return { status: 'done', marker };
}
