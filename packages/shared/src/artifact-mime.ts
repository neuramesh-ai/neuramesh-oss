/** Portable deliverables use the same media types when saved and when reading older records. */
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac',
  pdf: 'application/pdf', json: 'application/json', html: 'text/html', htm: 'text/html',
  md: 'text/markdown', txt: 'text/plain', srt: 'text/plain', vtt: 'text/vtt', csv: 'text/csv',
  js: 'text/javascript', mjs: 'text/javascript', ts: 'text/plain', tsx: 'text/plain', jsx: 'text/plain',
  css: 'text/css', yaml: 'text/plain', yml: 'text/plain', xml: 'text/xml', sh: 'text/plain',
};
export function artifactMime(name: string): string {
  return MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}
export function artifactTextMime(mime: string): boolean {
  return /^text\//i.test(mime) || /^application\/(?:json|xml|javascript)$/i.test(mime);
}
