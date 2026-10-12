import { app, protocol } from 'electron';
import { join } from 'node:path';
import { activeDb, actorId, apiUrl, artifactMime, ws } from './sync';
import { readAttachment } from './attachments';
import { readBrainArtifact } from './brain-artifact-reader';

/** Serve local attachments and verified cloud bytes through the same renderer URL. */
export function registerAttachmentProtocol(): void {
  protocol.handle('nm-attachment', async (req) => {
    const id = new URL(req.url).hostname;
    let bytes = await readAttachment(id);
    if (!bytes) {
      try {
        const [row] = await activeDb().getAll<{ storage_path: string | null; content_hash: string | null; mime: string | null }>(
          'select storage_path, content_hash, mime from artifacts where id = ? and workspace_id = ?', [id, ws()]);
        if (row?.storage_path?.startsWith('brain:')) bytes = Buffer.from((await readBrainArtifact({ apiUrl: apiUrl(), actorId: actorId(), workspace: ws(), cacheRoot: join(app.getPath('userData'), 'brain-artifacts') }, id, row.content_hash, row.mime ?? undefined)).bytes);
      } catch (error) { console.warn('[brain] artifact read failed', error instanceof Error ? error.message : 'download failed'); }
    }
    if (!bytes) return new Response('not found', { status: 404 });
    const mime = (await artifactMime(id)) ?? 'application/octet-stream';
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { 'content-type': mime, 'cache-control': 'private, no-store', 'content-security-policy': "default-src 'none'; sandbox", 'x-content-type-options': 'nosniff' },
    });
  });
}
