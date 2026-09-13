import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';
import type { ApplyPatchInput, EditFileInput, ToolExecutors } from '@cline/sdk';
import type { PolicyRule } from '@neuramesh/shared';
import { createEngineeringShellExecutor, createEngineeringWebExecutor } from './engineering-safe-executors';
import { engineeringPatchPaths } from '../../engineering-patch';

type CreateDefaultExecutors = typeof import('@cline/sdk').createDefaultExecutors;
type FileReadRequest = Parameters<NonNullable<ToolExecutors['readFile']>>[0];

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function lexicalPath(root: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(root, path);
}

function outsideWorkspace(path: string): Error {
  return new Error(`Engineering refused a path outside the selected repository: ${path}`);
}

async function existingWorkspacePath(root: string, path: string): Promise<string> {
  const candidate = lexicalPath(root, path);
  if (!isWithin(root, candidate)) throw outsideWorkspace(path);
  const canonical = await realpath(candidate);
  if (!isWithin(root, canonical)) throw outsideWorkspace(path);
  return canonical;
}

/** Resolve a write target through its deepest existing ancestor. This catches a new file below a
 * symlink that points outside the repository without requiring the target itself to exist. */
async function writableWorkspacePath(root: string, path: string): Promise<string> {
  const candidate = lexicalPath(root, path);
  if (!isWithin(root, candidate)) throw outsideWorkspace(path);
  const tail: string[] = [];
  let cursor = candidate;
  for (;;) {
    try {
      const canonical = join(await realpath(cursor), ...tail);
      if (!isWithin(root, canonical)) throw outsideWorkspace(path);
      return canonical;
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('Engineering refused')) throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw outsideWorkspace(path);
      tail.unshift(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
      cursor = parent;
    }
  }
}

/** Create the machine-owned executors for one Engineering repository. The SDK's built-in file
 * reader otherwise resolves relative paths against the daemon process, which can expose an
 * unrelated checkout. Every workspace-bearing argument is replaced with this canonical root. */
export async function createEngineeringToolExecutors(
  cwd: string,
  createDefaults: CreateDefaultExecutors,
  policyRules: readonly PolicyRule[] = [],
  managedRepoRoot?: string,
): Promise<{ executors: ToolExecutors; close(): void }> {
  const root = await realpath(cwd);
  const defaults = createDefaults({
    fileRead: { maxFileSizeBytes: 2_000_000 },
    editor: { restrictToCwd: true },
    applyPatch: { restrictToCwd: true },
    webFetch: { followRedirects: false, maxResponseBytes: 2_000_000 },
  });
  const executors: ToolExecutors = {
    ...(defaults.readFile ? {
      readFile: async (request: FileReadRequest, context) => defaults.readFile!(
        { ...request, path: await existingWorkspacePath(root, request.path) }, context,
      ),
    } : {}),
    ...(defaults.search ? {
      search: (query, _cwd, context) => defaults.search!(query, root, context),
    } : {}),
    ...(defaults.bash ? { bash: createEngineeringShellExecutor(root, policyRules, managedRepoRoot) } : {}),
    ...(defaults.webFetch ? { webFetch: createEngineeringWebExecutor(policyRules) } : {}),
    ...(defaults.editor ? {
      editor: async (input: EditFileInput, _cwd, context) => defaults.editor!(
        { ...input, path: await writableWorkspacePath(root, input.path) }, root, context,
      ),
    } : {}),
    ...(defaults.applyPatch ? {
      applyPatch: async (input: ApplyPatchInput, _cwd, context) => {
        await Promise.all(engineeringPatchPaths(input.input).map((path) => writableWorkspacePath(root, path)));
        return defaults.applyPatch!(input, root, context);
      },
    } : {}),
    ...(defaults.skills ? { skills: defaults.skills } : {}),
    ...(defaults.askQuestion ? { askQuestion: defaults.askQuestion } : {}),
    ...(defaults.submit ? { submit: defaults.submit } : {}),
  };
  return { executors, close: () => {} };
}
