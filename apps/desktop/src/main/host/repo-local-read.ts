import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const inside = (root: string, path: string) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`); };

/** Read a registered project checkout without exposing adjacent files or following escaping links. */
export async function localRepoRead(root: string, kind: 'file' | 'tree' | 'changes', path = '', ref?: string, since?: string): Promise<string> {
  const base = await realpath(root);
  const candidate = resolve(base, path);
  if (!inside(base, candidate)) throw new Error('The path must stay inside this project repository.');
  const rel = relative(base, candidate);
  if (rel.split(sep).some(part => part === '.git')) throw new Error('Repository metadata is not a project document.');
  const git = async (args: string[]) => (await exec('git', ['-C', base, ...args], { maxBuffer: 2_000_000, timeout: 15_000 })).stdout;
  if (kind === 'changes') return `Local commits${since ? ` since ${since}` : ''} (up to 30; pull requests and releases require GitHub):\n${(await git(['log', '-30', ...(since ? [`--since=${new Date(since).toISOString()}`] : []), '--format=%h %s', '--'])).slice(0, 60_000)}`;
  if (ref) {
    if (ref.startsWith('-') || ref.includes(':') || /[\x00-\x20]/.test(ref)) throw new Error('Invalid repository revision.');
    const commit = (await git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
    if (kind === 'tree') return (await git(['ls-tree', '-r', '--name-only', commit, '--', rel || '.'])).split('\n').slice(0, 500).join('\n');
    const mode = await git(['ls-tree', commit, '--', rel]);
    if (!mode.startsWith('100')) throw new Error('That path is not a regular repository file.');
    return (await git(['show', `${commit}:${rel}`])).slice(0, 60_000);
  }
  if (kind === 'tree') return (await git(['ls-files', '--', rel || '.'])).split('\n').slice(0, 500).join('\n');
  const canonical = await realpath(candidate);
  if (!inside(base, canonical)) throw new Error('The path points outside this project repository.');
  if (relative(base, canonical).split(sep).includes('.git')) throw new Error('Repository metadata is not a project document.');
  const info = await stat(canonical);
  if (!info.isFile() || info.size > 1_000_000) throw new Error('Read a regular file smaller than 1 MB.');
  const bytes = await readFile(canonical);
  if (bytes.subarray(0, 8000).includes(0)) return 'This is a binary file, not a text document.';
  const body = bytes.toString('utf8');
  return `${rel}\n\n${body.slice(0, 60_000)}${body.length > 60_000 ? '\n[truncated at 60000 characters]' : ''}`;
}
