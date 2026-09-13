import { electron } from './electronlazy';
import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Local blob store for chat attachments. The FULL bytes live on the host
// (userData/attachments/<id>) — they'd blow the 400KB inline/PowerSync cap. The renderer and
// the local agents read them via the nm-attachment:// protocol. A small THUMBNAIL is computed
// here and synced inline (artifacts.inline_content) so a preview is cloud-consistent and shows
// cross-machine even before full-byte sync (the documented follow-up) exists.

const THUMB_MAX = 320; // px on the long edge — crisp composer/feed preview at a few KB

export interface StagedMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  thumb: string | null; // data-URI thumbnail for images, else null
}

// Compose-time registry: an attachment is staged (bytes written, thumbnail computed) the moment
// it's added, before the message exists. The send path reads back the authoritative metadata to
// insert the artifact rows. Cleared on discard / send.
const staged = new Map<string, StagedMeta>();

export function attachmentsDir(): string {
  // agents.ts imports this module, so it must load outside Electron — the path is only ever
  // ASKED for inside it (see electronlazy.ts).
  const app = electron()?.app;
  if (!app) throw new Error('attachmentsDir is only available inside Electron');
  return join(app.getPath('userData'), 'attachments');
}

export function attachmentFilePath(id: string): string {
  return join(attachmentsDir(), id);
}

export function getStaged(id: string): StagedMeta | undefined {
  return staged.get(id);
}

export function hasAttachment(id: string): boolean {
  // ids are random uuids; this also guards the protocol handler against path traversal
  return /^[0-9a-f-]{36}$/i.test(id) && existsSync(attachmentFilePath(id));
}

export async function readAttachment(id: string): Promise<Buffer | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    return await readFile(attachmentFilePath(id));
  } catch {
    return null;
  }
}

/** Write the bytes to the local store and compute image dims + a light thumbnail. */
export async function stageAttachment(id: string, name: string, mime: string, bytes: Buffer): Promise<StagedMeta> {
  await mkdir(attachmentsDir(), { recursive: true });
  await writeFile(attachmentFilePath(id), bytes);
  let width: number | null = null;
  let height: number | null = null;
  let thumb: string | null = null;
  if (mime.startsWith('image/')) {
    try {
      const img = electron()!.nativeImage.createFromBuffer(bytes);
      const s = img.getSize();
      if (s.width && s.height) {
        width = s.width;
        height = s.height;
        const scale = Math.min(1, THUMB_MAX / Math.max(s.width, s.height));
        const small = scale < 1 ? img.resize({ width: Math.round(s.width * scale), quality: 'good' }) : img;
        // alpha-bearing formats keep PNG; photos go JPEG to stay tiny. Re-check the size and
        // fall back to JPEG if a PNG thumb is still heavy — inline_content must stay small.
        const alpha = mime === 'image/png' || mime === 'image/webp' || mime === 'image/gif';
        thumb = alpha ? small.toDataURL() : `data:image/jpeg;base64,${small.toJPEG(72).toString('base64')}`;
        if (thumb.length > 180_000) thumb = `data:image/jpeg;base64,${small.toJPEG(68).toString('base64')}`;
      }
    } catch {
      /* undecodable image (e.g. SVG) — keep the bytes, skip dims/thumb; the protocol renders it */
    }
  }
  const meta: StagedMeta = { id, name, mime, size: bytes.length, width, height, thumb };
  staged.set(id, meta);
  return meta;
}

export async function discardAttachment(id: string): Promise<void> {
  staged.delete(id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await rm(attachmentFilePath(id), { force: true }).catch(() => {});
}

/** Clear a staged entry once its row is persisted (the file stays on disk). */
export function clearStaged(id: string): void {
  staged.delete(id);
}

/** Best-effort size lookup for a stored file (staged map first, else stat). */
export async function attachmentSize(id: string): Promise<number | null> {
  const m = staged.get(id);
  if (m) return m.size;
  try {
    return (await stat(attachmentFilePath(id))).size;
  } catch {
    return null;
  }
}
