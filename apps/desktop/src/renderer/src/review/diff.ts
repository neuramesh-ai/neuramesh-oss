// Unified-diff parsing for the review cockpit — extracted from App.tsx (track A2).

// Split a unified diff into per-file sections so a multi-file PR reads as files (a file list +
// per-file headers with add/del stats), not one undifferentiated blob — and each modified file
// shows its before (−) and after (+) lines.
export interface DiffFile { path: string; change: 'added' | 'deleted' | 'modified'; adds: number; dels: number; lines: string[] }

export function parseDiffFiles(text: string): DiffFile[] {
  return text
    .split(/^(?=diff --git )/m)
    .filter((b) => b.startsWith('diff --git'))
    .map((block) => {
      const lines = block.replace(/\n+$/, '').split('\n');
      const gm = /diff --git a\/(.+?) b\/(.+)$/.exec(lines[0] ?? '');
      const plus = lines.find((l) => l.startsWith('+++ b/'));
      const path = plus ? plus.slice(6) : gm ? gm[2]! : (lines[0] ?? 'file');
      const change: DiffFile['change'] = block.includes('\nnew file mode') ? 'added' : block.includes('\ndeleted file mode') ? 'deleted' : 'modified';
      let adds = 0, dels = 0;
      for (const l of lines) {
        if (l.startsWith('+') && !l.startsWith('+++')) adds++;
        else if (l.startsWith('-') && !l.startsWith('---')) dels++;
      }
      return { path, change, adds, dels, lines };
    });
}

export function baseName(p: string): string { const i = p.lastIndexOf('/'); return i >= 0 ? p.slice(i + 1) : p; }

export const DIFF_BADGE = (c: DiffFile['change']) => (c === 'added' ? 'A' : c === 'deleted' ? 'D' : 'M');
