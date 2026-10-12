import { normalizeEngineeringChanges } from './changes';
import type { EngineeringChange } from './domain';

export type ReviewLine = {
  kind: 'context' | 'added' | 'removed' | 'hunk' | 'note';
  oldLine: number | null;
  newLine: number | null;
  text: string;
};
export type ReviewFile = {
  change: EngineeringChange;
  kind: EngineeringChange['kind'] | 'renamed';
  previousPath?: string;
  binary: boolean;
  lines: ReviewLine[];
  additions: number;
  deletions: number;
};

/** Each hunk owns both counters. A removal never consumes a line in the new file. */
export function reviewLines(diff: string): ReviewLine[] {
  const rows: ReviewLine[] = [];
  let oldLine: number | null = null;
  let newLine: number | null = null;
  let inHunk = false;
  for (const text of diff.replace(/\r\n/g, '\n').split('\n')) {
    if (text.startsWith('@@')) {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      oldLine = hunk ? Number(hunk[1]) : null;
      newLine = hunk ? Number(hunk[2]) : null;
      inHunk = true;
      rows.push({ kind: 'hunk', oldLine: null, newLine: null, text });
    } else if (inHunk && text.startsWith('\\')) {
      rows.push({ kind: 'note', oldLine: null, newLine: null, text: text.slice(2) });
    } else if (inHunk && /^[ +\-]/.test(text)) {
      const kind = text[0] === '+' ? 'added' : text[0] === '-' ? 'removed' : 'context';
      rows.push({ kind, oldLine: kind === 'added' ? null : oldLine, newLine: kind === 'removed' ? null : newLine, text: text.slice(1) });
      if (kind !== 'added' && oldLine !== null) oldLine++;
      if (kind !== 'removed' && newLine !== null) newLine++;
    }
  }
  return rows;
}

/** Old sessions can repeat a path. The latest version is the review target. */
export function reviewFiles(changes: EngineeringChange[]): ReviewFile[] {
  return normalizeEngineeringChanges(changes).map((change) => {
    const previousPath = change.previousPath ?? /^rename from (.+)$/m.exec(change.diff)?.[1];
    const binary = /^(?:Binary files |GIT binary patch)/m.test(change.diff) || /\0/.test(change.before + change.after) || [change.before, change.after].includes('[binary file]');
    const lines = binary ? [] : reviewLines(change.diff);
    return {
      change, kind: previousPath ? 'renamed' : change.kind, ...(previousPath ? { previousPath } : {}), binary, lines,
      additions: lines.filter((line) => line.kind === 'added').length,
      deletions: lines.filter((line) => line.kind === 'removed').length,
    };
  });
}

export function reviewSource(file: ReviewFile): { text: string; notice?: string } {
  if (/^\[(?:file too large|preview omitted)/.test(file.change.before + file.change.after)) return { text: '', notice: 'This file exceeds the available preview size. Open it in the repository to review it.' };
  if (file.change.previewError) return { text: '', notice: file.change.previewError };
  if (file.binary) return { text: '', notice: 'This is a binary file. A text preview is not available.' };
  const text = file.change.kind === 'deleted' ? file.change.before : file.change.after;
  // Older saved sessions put the entire tool input in `after`. It is a patch, not file content.
  if (/^(?:\*\*\* Begin Patch|diff --git |@@ )/m.test(text) && text === file.change.diff) {
    return { text: '', notice: 'The full file content is not available. Use Changes to review the patch.' };
  }
  return { text };
}
