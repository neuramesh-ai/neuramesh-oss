export interface CloudArtifactRow {
  id: string;
  mime?: string | null;
  inline_content?: string | null;
  storage_path?: string | null;
  content_hash?: string | null;
}

export interface ArtifactBytes { bytes: Uint8Array; mime: string; sha256: string | null }

export interface BrainArtifactMetadata { id: string; name: string; mime: string; sha256: string; sizeBytes: number; createdAt: string; storagePath: string; kind?: string; tags?: string[] }

export function brainArtifactRows(items: BrainArtifactMetadata[]) {
  return items.map((item) => ({ id: item.id, name: item.name, mime: item.mime, kind: item.kind ?? (item.mime.startsWith('image/') ? 'screenshot' : 'file'), tags: JSON.stringify(item.tags ?? []), inline_content: null,
    storage_path: item.storagePath, content_hash: item.sha256, size_bytes: item.sizeBytes, created_at: item.createdAt, promoted: 0, message_id: null, task_id: null }));
}

/** Materialize bytes only for an opened file. The replica continues to carry metadata. */
export async function hydrateArtifact<T extends CloudArtifactRow>(
  row: T | null,
  load: (id: string) => Promise<ArtifactBytes>,
  sha256: (bytes: Uint8Array) => Promise<ArrayBuffer> = (bytes) => crypto.subtle.digest('SHA-256', new Uint8Array(bytes)),
): Promise<T | null> {
  if (!row || !row.storage_path?.startsWith('brain:')) return row;
  const result = await load(row.id);
  const expected = row.content_hash ?? result.sha256;
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('The cloud artifact has no valid checksum.');
  const digest = await sha256(result.bytes);
  const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) throw new Error('The cloud artifact failed its checksum.');
  const mime = row.mime || result.mime;
  const textual = /^(text\/|application\/(json|xml|javascript)(;|$))/.test(mime) && !/^text\/html/.test(mime);
  let content: string;
  if (textual || mime === 'text/html') content = new TextDecoder().decode(result.bytes);
  else {
    let binary = '';
    for (let start = 0; start < result.bytes.length; start += 8192) binary += String.fromCharCode(...result.bytes.subarray(start, start + 8192));
    content = `data:${mime};base64,${btoa(binary)}`;
  }
  return { ...row, mime, inline_content: content };
}
