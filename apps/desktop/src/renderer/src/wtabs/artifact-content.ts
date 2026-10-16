import { artifactMime, artifactTextMime } from '@neuramesh/shared';

/** Only bytes returned by the authenticated artifact reader enter this renderer. Never fetch a
 * URL in an artifact body. Old recordings used octet-stream for media and subtitle files. */
export function artifactContent(name: string, content: string) {
  const data = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(content);
  const declared = data?.[1]?.toLowerCase();
  const mime = !declared || declared === 'application/octet-stream' ? artifactMime(name) : declared;
  let bytes: Uint8Array<ArrayBuffer> | null = null;
  let text = content;
  let error: string | null = null;
  if (data) {
    try {
      bytes = data[2] ? Uint8Array.from(atob(data[3]!), c => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(data[3]!));
      if (artifactTextMime(mime)) text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch { error = 'This artifact could not be decoded. Try opening it again.'; }
  }
  const binary = !!data && (!artifactTextMime(mime) || !!error);
  const kind = binary && !error ? mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : mime === 'application/pdf' ? 'pdf' : mime.startsWith('image/') ? 'image' : 'download' : null;
  return { text, binary, kind, error, blob: error ? null : new Blob([bytes ?? content], { type: mime }) };
}
