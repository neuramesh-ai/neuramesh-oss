import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { artifactMime } from '@neuramesh/shared';
import type { EngineeringRuntimeEvent } from '../../engineering-protocol';

const MAX_BYTES = 2 * 1024 * 1024;
const within = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** A person previews the current thread's checkout. No model, shell, or transcript mutation. */
export async function previewEngineeringFile(cwd: string, requestId: string, path: string): Promise<Extract<EngineeringRuntimeEvent, { type: 'file_preview' }>> {
  const reply = { type: 'file_preview' as const, requestId, path };
  try {
    const root = await realpath(cwd);
    const target = resolve(cwd, path);
    if (!within(resolve(cwd), target) && !within(root, target)) throw new Error('Select a file inside this thread’s repository.');
    const canonical = await realpath(target);
    if (!within(root, canonical)) throw new Error('This file links outside the thread’s repository.');
    const file = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error('Select a file, not a folder.');
      if (stat.size > MAX_BYTES) throw new Error('This file exceeds the 2 MB preview limit.');
      // Bound the read even if another process grows the file after stat().
      const bytes = Buffer.alloc(MAX_BYTES + 1);
      let bytesRead = 0;
      while (bytesRead < bytes.length) {
        const read = await file.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
        if (!read.bytesRead) break;
        bytesRead += read.bytesRead;
      }
      if (bytesRead > MAX_BYTES) throw new Error('This file exceeds the 2 MB preview limit.');
      const data = bytes.subarray(0, bytesRead);
      const mime = artifactMime(path);
      const media = mime.startsWith('image/') || mime === 'application/pdf';
      if (!media && data.includes(0)) throw new Error('This binary file has no preview.');
      const result = { ...reply, content: media ? `data:${mime};base64,${data.toString('base64')}` : data.toString('utf8') };
      if (Buffer.byteLength(JSON.stringify(result)) > 4 * 1024 * 1024) throw new Error('This file exceeds the preview transport limit.');
      return result;
    } finally { await file.close(); }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ...reply, error: code === 'ENOENT' ? 'This file is no longer in the thread’s repository.' : code ? 'The file could not be read.' : error instanceof Error ? error.message : 'The file could not be read.' };
  }
}
