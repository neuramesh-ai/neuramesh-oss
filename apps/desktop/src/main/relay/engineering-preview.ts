import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { engineeringToolChanges, engineeringUnifiedDiff, parseEngineeringPatch, type EngineeringRuntimeChange } from '@neuramesh/shared';
import { workspaceTexts, MAX_ENGINEERING_CHANGE_EVENT_BYTES } from './engineering-changes';

const previewLimit = 2 * 1024 * 1024;
function relativePath(root: string, path: string): string {
  const rel = relative(root, resolve(root, path));
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('A proposed file is outside this repository.');
  return rel;
}

/** Execute the SDK parser over bounded copies. It never follows a workspace symlink or writes
 * a user's file while building an approval preview. Absolute paths are remapped into the copy. */
async function preview(cwd: string, tool: string, input: unknown): Promise<{ changes: EngineeringRuntimeChange[]; patch?: string }> {
  const root = await realpath(cwd);
  const data = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const raw = typeof input === 'string' ? input : String(data['input'] ?? '');
  if (Buffer.byteLength(JSON.stringify(input) ?? '') > previewLimit) throw new Error('This change is too large to preview.');
  const operations = tool === 'apply_patch' ? parseEngineeringPatch(raw) : [];
  if (operations.length > 100) throw new Error('This patch contains too many files to preview.');
  const paths = tool === 'apply_patch' ? operations.flatMap((op) => [op.path, ...(op.previousPath ? [op.previousPath] : [])]) : [String(data['path'] ?? '')];
  const relPaths = [...new Set(paths.map((path) => relativePath(root, path)))];
  const snapshots = await workspaceTexts(root, relPaths);
  for (const value of snapshots.values()) if (!value.safe || /^\[(?:binary file|file too large|preview omitted)/.test(value.value)) throw new Error('A source file cannot be safely previewed as text.');
  const scratch = await mkdtemp(join(tmpdir(), 'nm-code-preview-'));
  try {
    for (const [path, snapshot] of snapshots) if (snapshot.exists) { await mkdir(dirname(join(scratch, path)), { recursive: true }); await writeFile(join(scratch, path), snapshot.value); }
    const sdk = await import('@cline/sdk');
    let changes: EngineeringRuntimeChange[];
    let patch: string | undefined;
    if (tool === 'apply_patch') {
      if (!raw.includes('*** End Patch')) throw new Error('The patch is incomplete.');
      const normalized: string[] = ['*** Begin Patch'];
      for (let index = 0; index < operations.length; index++) {
        const op = operations[index]!;
        const path = relativePath(root, op.previousPath ?? op.path);
        const next = operations[index + 1];
        // Some models replace a file with Delete + Add. Present and apply one modification.
        if (op.kind === 'Delete' && next?.kind === 'Add' && relativePath(root, next.path) === path) {
          const before = snapshots.get(path);
          if (!before?.exists) throw new Error('The file to replace no longer exists.');
          normalized.push(`*** Update File: ${path}`, '@@', ...before.value.replace(/\n$/, '').split('\n').filter(() => !!before.value).map((line) => `-${line}`), ...next.lines.filter((line) => line.startsWith('+')), '*** End of File');
          index++;
        } else {
          normalized.push(`*** ${op.kind} File: ${path}`);
          if (op.previousPath) normalized.push(`*** Move to: ${relativePath(root, op.path)}`);
          normalized.push(...op.lines);
        }
      }
      normalized.push('*** End Patch');
      patch = normalized.join('\n');
      const computed = await sdk.computePatchChanges(patch, scratch, { restrictToCwd: true });
      changes = Object.entries(computed.changes).map(([path, change]) => ({
        path: change.movePath ?? path, ...(change.movePath ? { previousPath: path } : {}),
        kind: change.type === 'add' ? 'added' : change.type === 'delete' ? 'deleted' : 'modified',
        before: change.oldContent ?? '', after: change.newContent ?? '', diff: '',
      }));
    } else if (tool === 'editor') {
      const path = relativePath(root, String(data['path']));
      const editor = sdk.createEditorExecutor({ restrictToCwd: true });
      await editor({ ...data, path } as Parameters<typeof editor>[0], scratch, { agentId: 'preview', conversationId: 'preview', iteration: 0 });
      const before = snapshots.get(path)!;
      changes = [{ path, kind: before.exists ? 'modified' : 'added', before: before.value, after: await readFile(join(scratch, path), 'utf8'), diff: '' }];
    } else return { changes: [] };
    changes = changes.map((change) => ({ ...change, diff: engineeringUnifiedDiff(change) }));
    if (Buffer.byteLength(JSON.stringify(changes)) > MAX_ENGINEERING_CHANGE_EVENT_BYTES) throw new Error('This patch exceeds the preview size limit.');
    return { changes, ...(patch ? { patch } : {}) };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

export async function previewEngineeringChanges(cwd: string, tool: string, input: unknown): Promise<EngineeringRuntimeChange[]> {
  if (tool !== 'apply_patch' && tool !== 'editor') return [];
  try { return (await preview(cwd, tool, input)).changes; }
  catch { return engineeringToolChanges(tool, input).map((change) => ({ ...change, previewError: 'The complete preview is unavailable. The patch may be invalid or a source file may be unavailable. Review the patch excerpt below.' })); }
}

export async function preparedEngineeringPatch(cwd: string, patch: string): Promise<string> {
  return (await preview(cwd, 'apply_patch', { input: patch })).patch ?? patch;
}
