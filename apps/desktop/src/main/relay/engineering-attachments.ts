import { createWriteStream, mkdirSync, rmSync, type WriteStream } from 'node:fs';
import { once } from 'node:events';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { PLAN_ENTITLEMENTS } from '@neuramesh/shared';
import type { EngineeringAttachmentRef } from '../../engineering-protocol';

const MAX_ATTACHMENT_LIMITS = PLAN_ENTITLEMENTS.cloud.attachments;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const MAX_MACHINE_ATTACHMENT_BYTES = 256 * 1024 * 1024;
let machineDeclaredBytes = 0;
const safe = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 100);

interface PendingAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  received: number;
  nextIndex: number;
  path: string;
  complete: boolean;
  stream: WriteStream;
  finished: Promise<void>;
}

/** Machine-owned attachment assembly. Browser chunks are bounded, ordered and kept outside the
 * repository so an attachment cannot become an accidental worktree change. */
export class EngineeringAttachmentInbox {
  private readonly dir: string;
  private readonly pending = new Map<string, PendingAttachment>();
  private declaredBytes = 0;
  private closed = false;

  constructor(actorId: string, threadId: string) {
    this.dir = join(tmpdir(), 'neuramesh-engineering-attachments', `${safe(actorId)}-${safe(threadId)}`);
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
  }

  start(id: string, name: string, mime: string, size: number): void {
    if (this.closed) throw new Error('That attachment inbox is closed.');
    if (this.pending.has(id)) throw new Error('That attachment has already started.');
    if (this.pending.size >= MAX_ATTACHMENT_LIMITS.maxPerMessage) throw new Error(`A Code message can include at most ${MAX_ATTACHMENT_LIMITS.maxPerMessage} attachments.`);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ATTACHMENT_LIMITS.maxBytes
      || this.declaredBytes + size > MAX_TOTAL_BYTES || machineDeclaredBytes + size > MAX_MACHINE_ATTACHMENT_BYTES) {
      throw new Error('The attachment exceeds the Code upload limit.');
    }
    const cleanName = safe(basename(name)) || 'file';
    const path = join(this.dir, `${safe(id)}-${cleanName}`);
    const stream = createWriteStream(path, { flags: 'wx' });
    const finished = new Promise<void>((resolve, reject) => {
      stream.once('finish', resolve);
      stream.once('error', reject);
    });
    void finished.catch(() => {});
    this.pending.set(id, { id, name: cleanName, mime, size, received: 0, nextIndex: 0, path, complete: false, stream, finished });
    this.declaredBytes += size;
    machineDeclaredBytes += size;
  }

  async chunk(id: string, index: number, data: string): Promise<void> {
    const item = this.pending.get(id);
    if (!item || item.complete) throw new Error('That attachment is not accepting data.');
    if (index !== item.nextIndex) throw new Error('Attachment chunks arrived out of order.');
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > 128 * 1024 || item.received + bytes.length > item.size) throw new Error('The attachment chunk is invalid.');
    item.received += bytes.length;
    item.nextIndex += 1;
    if (!item.stream.write(bytes)) await once(item.stream, 'drain');
  }

  end(id: string): void {
    const item = this.pending.get(id);
    if (!item || item.complete || item.received !== item.size) throw new Error('The attachment is incomplete.');
    item.complete = true;
    item.stream.end();
  }

  async resolve(refs: EngineeringAttachmentRef[] = []): Promise<{ userImages: string[]; userFiles: string[] }> {
    const userImages: string[] = [];
    const userFiles: string[] = [];
    for (const ref of refs) {
      const item = this.pending.get(ref.id);
      if (!item?.complete || item.name !== safe(basename(ref.name)) || item.mime !== ref.mime) throw new Error('An attached file is unavailable on the selected machine.');
      await item.finished;
      (item.mime.startsWith('image/') ? userImages : userFiles).push(item.path);
    }
    return { userImages, userFiles };
  }

  release(refs: EngineeringAttachmentRef[] = []): void {
    for (const ref of refs) {
      const item = this.pending.get(ref.id);
      if (!item?.complete) continue;
      this.pending.delete(ref.id);
      this.declaredBytes = Math.max(0, this.declaredBytes - item.size);
      machineDeclaredBytes = Math.max(0, machineDeclaredBytes - item.size);
      rmSync(item.path, { force: true });
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) item.stream.destroy();
    this.pending.clear();
    machineDeclaredBytes = Math.max(0, machineDeclaredBytes - this.declaredBytes);
    this.declaredBytes = 0;
    rmSync(this.dir, { recursive: true, force: true });
  }
}
