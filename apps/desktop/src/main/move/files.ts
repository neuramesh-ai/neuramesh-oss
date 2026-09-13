// What a move leaves beside the local replica (docs/export-format.md "The desktop driver").
//
//   moved.json               the marker: the move ran to the end. Refuses a second move, and the
//                            This Mac card reads it to say "Moved to <target> · <date>".
//   move-<sourceWs>.json     the progress: importId, the next seq, the three maps. A retry after a
//                            failure or a cancel resumes here with the SAME importId.
//
// The driver reads and writes through MoveFiles, so its tests run on memory and the electron
// half hands it the folder. Local rows are never touched: the replica is the backup.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ExportTable } from '@neuramesh/shared';

export interface MoveTarget { connectionId: string; workspaceId: string; name: string; slug: string }

export interface MovedMarker {
  importId: string;
  movedAt: string;
  target: MoveTarget;
  counts: Record<ExportTable, number>;
  totalBytes: number;
  numberMap: Record<string, number>;
}

export interface MoveProgress {
  importId: string;
  targetWorkspaceId: string;
  nextSeq: number;
  idMap: Record<string, string>;
  numberMap: Record<string, number>;
  slugMap: Record<string, string>;
}

export interface MoveFiles {
  readMarker(): MovedMarker | null;
  writeMarker(m: MovedMarker): void;
  readProgress(): MoveProgress | null;
  writeProgress(p: MoveProgress): void;
  clearProgress(): void;
}

export const movedMarkerPath = (replicaDir: string): string => join(replicaDir, 'moved.json');
export const moveProgressPath = (replicaDir: string, sourceWs: string): string => join(replicaDir, `move-${sourceWs}.json`);

function readJson<T>(path: string): T | null {
  try { return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null; } catch { return null; }
}

/** the marker beside a replica: null when no move ran to the end */
export const readMovedMarker = (replicaDir: string): MovedMarker | null => readJson<MovedMarker>(movedMarkerPath(replicaDir));
/** the marker a connection carries on its cards (nm:bootstrap, nm:connections-list): only a local one can have moved */
export const movedOf = (c: { kind: string; replicaPath: string }): MovedMarker | null => (c.kind === 'local' ? readMovedMarker(dirname(c.replicaPath)) : null);

export function fsMoveFiles(replicaDir: string, sourceWs: string): MoveFiles {
  const write = (path: string, v: unknown): void => { mkdirSync(replicaDir, { recursive: true }); writeFileSync(path, JSON.stringify(v, null, 2), 'utf8'); };
  const progress = moveProgressPath(replicaDir, sourceWs);
  return {
    readMarker: () => readMovedMarker(replicaDir),
    writeMarker: (m) => write(movedMarkerPath(replicaDir), m),
    readProgress: () => readJson<MoveProgress>(progress),
    writeProgress: (p) => write(progress, p),
    clearProgress: () => { try { unlinkSync(progress); } catch { /* nothing to clear */ } },
  };
}

/** the tests' files: the same contract, in memory */
export function memoryMoveFiles(seed: { marker?: MovedMarker | null; progress?: MoveProgress | null } = {}): MoveFiles & { marker: MovedMarker | null; progress: MoveProgress | null } {
  const files = {
    marker: seed.marker ?? null,
    progress: seed.progress ?? null,
    readMarker: () => files.marker,
    writeMarker: (m: MovedMarker) => { files.marker = m; },
    readProgress: () => files.progress,
    writeProgress: (p: MoveProgress) => { files.progress = p; },
    clearProgress: () => { files.progress = null; },
  };
  return files;
}
