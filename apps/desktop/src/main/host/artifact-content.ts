import { brainApiBaseUrl } from '@neuramesh/shared';
import { createHash } from 'node:crypto';

export interface ArtifactContentRow {
  id?: string;
  workspace_id?: string;
  name?: string;
  inline_content: string | null;
  storage_path?: string | null;
  content_hash?: string | null;
}
interface ArtifactReaderOptions {
  workspace: string;
  apiUrl: string;
  headers: () => Promise<Record<string, string>>;
  fetchImpl?: typeof fetch;
}
const readers = new WeakMap<object, Map<string, ArtifactReaderOptions>>();

/** The replica carries metadata. Each host supplies the authenticated byte reader once. */
export function registerArtifactReader(db: object, options: ArtifactReaderOptions): void {
  const configured = readers.get(db) ?? new Map<string, ArtifactReaderOptions>();
  configured.set(options.workspace, options);
  readers.set(db, configured);
}

export async function readArtifactBytes(db: object, row: ArtifactContentRow | null | undefined): Promise<Buffer> {
  if (!row) return Buffer.alloc(0);
  if (row.inline_content !== null && row.inline_content !== undefined) {
    const data = /^data:[^;,]+;base64,([\s\S]*)$/.exec(row.inline_content);
    return data ? Buffer.from(data[1]!, 'base64') : Buffer.from(row.inline_content, 'utf8');
  }
  if (!row.storage_path?.startsWith('brain:')) return Buffer.alloc(0);
  const configured = readers.get(db);
  const reader = row.workspace_id ? configured?.get(row.workspace_id) : configured?.size === 1 ? configured.values().next().value : undefined;
  if (!reader || !row.id) throw new Error('The cloud artifact reader is unavailable. Reconnect this workspace before the next turn.');
  const response = await (reader.fetchImpl ?? fetch)(`${brainApiBaseUrl(reader.apiUrl)}/v1/brain/artifacts/${encodeURIComponent(row.id)}?workspace=${encodeURIComponent(reader.workspace)}`, { headers: await reader.headers(), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`The artifact ${row.name ?? row.id} could not load (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (row.content_hash && createHash('sha256').update(bytes).digest('hex') !== row.content_hash) throw new Error(`The artifact ${row.name ?? row.id} failed its checksum.`);
  return bytes;
}

export async function readArtifactText(db: object, row: ArtifactContentRow | null | undefined): Promise<string> {
  return row?.inline_content ?? (await readArtifactBytes(db, row)).toString('utf8');
}
