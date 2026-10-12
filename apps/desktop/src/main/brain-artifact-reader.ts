import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ControlApiClient } from '@neuramesh/client-core/api';
import type { ArtifactBytes } from '@neuramesh/client-core/brain-artifacts';
import { apiAuthHeaders, authModeFor } from './apiauth';

export interface ArtifactReadScope { apiUrl: string; actorId: string; workspace: string; cacheRoot: string }
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
// one folder per server, principal and workspace, named by the values themselves. they are ids, not
// secrets, so they need no digest (CodeQL read a SHA-256 of the signed-in user's id as a weak password hash)
const scopeDir = (scope: ArtifactReadScope): string => join(scope.cacheRoot, ...[scope.apiUrl, scope.actorId, scope.workspace].map((value) => {
  const name = value.replace(/[^\w.-]/g, '_').slice(0, 200);
  if (!name || name === '.' || name === '..') throw new Error('Invalid artifact scope.');
  return name;
}));

/** Cache is scoped by server, principal and workspace. A replica hash makes offline reads safe. */
export async function readBrainArtifact(scope: ArtifactReadScope, id: string, expected?: string | null, mime = 'application/octet-stream'): Promise<ArtifactBytes> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid artifact ID.');
  const dir = scopeDir(scope);
  const file = join(dir, id);
  if (expected && /^[a-f0-9]{64}$/.test(expected)) {
    const cached = await readFile(file).catch(() => null);
    if (cached && hash(cached) === expected) return { bytes: cached, mime, sha256: expected };
  }
  const client = new ControlApiClient({ baseUrl: scope.apiUrl, getAuthHeaders: async (force) => {
    if (force && !process.env['NM_MACHINE_TOKEN']?.startsWith('nmm_') && authModeFor(scope.apiUrl) === 'clerk') (await import('./auth-clerk')).clearClerkApiToken();
    return apiAuthHeaders(scope.apiUrl, { kind: 'human', id: scope.actorId });
  } });
  const result = await client.getBytes(`/v1/brain/artifacts/${encodeURIComponent(id)}?workspace=${encodeURIComponent(scope.workspace)}`);
  const checksum = expected ?? result.sha256;
  if (!checksum || !/^[a-f0-9]{64}$/.test(checksum) || hash(result.bytes) !== checksum) throw new Error('The cloud artifact failed its checksum.');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, result.bytes, { mode: 0o600 });
  await rename(temp, file);
  return result;
}
