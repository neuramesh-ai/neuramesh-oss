import { createTwoFilesPatch } from 'diff';
import type { EngineeringChange } from './domain';
import { parseEngineeringPatch } from './patch';

const UNKNOWN_SOURCE = 'The original file snapshot is unavailable. This diff shows the patch excerpt only.';
const linesText = (lines: string[]): string => lines.length ? `${lines.join('\n')}\n` : '';

export function engineeringUnifiedDiff(change: Pick<EngineeringChange, 'path' | 'previousPath' | 'kind' | 'before' | 'after'>): string {
  const oldPath = change.previousPath ?? change.path;
  const from = change.kind === 'added' ? '/dev/null' : `a/${oldPath}`;
  const to = change.kind === 'deleted' ? '/dev/null' : `b/${change.path}`;
  const patch = createTwoFilesPatch(from, to, change.before, change.after, '', '', { context: 3 });
  const start = patch.indexOf('--- ');
  const mode = change.kind === 'added' ? 'new file mode 100644\n' : change.kind === 'deleted' ? 'deleted file mode 100644\n' : '';
  const rename = change.previousPath ? `rename from ${change.previousPath}\nrename to ${change.path}\n` : '';
  return `diff --git a/${oldPath} b/${change.path}\n${mode}${rename}${patch.slice(start)}`;
}

/** Older machines send only the patch. Never mistake its instructions or partial hunks for a file. */
export function engineeringPatchChanges(patch: string): EngineeringChange[] {
  const changes = new Map<string, EngineeringChange>();
  for (const operation of parseEngineeringPatch(patch)) {
    const prior = changes.get(operation.path);
    const before = linesText(operation.lines.filter((line) => line.startsWith('-') || line.startsWith(' ')).map((line) => line.slice(1)));
    const after = linesText(operation.lines.filter((line) => line.startsWith('+') || line.startsWith(' ')).map((line) => line.slice(1)));
    const kind = operation.kind === 'Add' ? prior?.kind === 'deleted' ? 'modified' : 'added' : operation.kind === 'Delete' ? 'deleted' : 'modified';
    const incomplete = operation.kind !== 'Add' || prior?.kind === 'deleted' || !patch.includes('*** End Patch');
    const change: EngineeringChange = {
      path: operation.path, ...(operation.previousPath ? { previousPath: operation.previousPath } : {}), kind,
      before: '', after: operation.kind === 'Add' ? after : '', diff: '',
      ...(incomplete ? { previewError: UNKNOWN_SOURCE } : {}),
    };
    change.diff = engineeringUnifiedDiff({ ...change, before, after });
    changes.set(change.path, change);
  }
  return [...changes.values()];
}

export function engineeringToolChanges(toolName: string, input: unknown): EngineeringChange[] {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  if (toolName === 'apply_patch') return engineeringPatchChanges(typeof input === 'string' ? input : typeof value['input'] === 'string' ? value['input'] : '');
  if (toolName !== 'editor' || typeof value['path'] !== 'string' || typeof value['new_text'] !== 'string') return [];
  const before = typeof value['old_text'] === 'string' ? value['old_text'] : '';
  const after = typeof value['new_text'] === 'string' ? value['new_text'] : '';
  const change: EngineeringChange = { path: value['path'], kind: 'modified', before: '', after: '', diff: '', previewError: UNKNOWN_SOURCE };
  return [{ ...change, diff: engineeringUnifiedDiff({ ...change, before, after }) }];
}

/** Repair persisted frames from older machines, and keep one row for each resulting path. */
export function normalizeEngineeringChanges(changes: readonly EngineeringChange[]): EngineeringChange[] {
  const result = new Map<string, EngineeringChange>();
  const seenPatches = new Set<string>();
  for (const change of changes) {
    if (change.after === change.diff && /^\*\*\* (Begin Patch|(?:Add|Update|Delete) File:)/.test(change.diff)) {
      if (seenPatches.has(change.diff)) continue;
      seenPatches.add(change.diff);
      for (const normalized of engineeringPatchChanges(change.diff)) result.set(normalized.path, normalized);
    } else result.set(change.path, change);
  }
  return [...result.values()];
}
