import { randomUUID } from 'node:crypto';
import type { NMEvent } from '@neuramesh/shared';
import type postgres from 'postgres';
import { configuredBrainObjects, brainHash, type BrainObjectRef, type BrainObjectStore } from '../brain-objects';
import { DomainError } from '../errors';
import { trackDomainEvent } from '../analytics';
import { brainCloudOnly } from '../brain-compatibility';

export async function attachContentMediaSql(
  pool: postgres.Sql, itemId: string, mime: string, bytes: Buffer, actor: { kind: string; id: string },
  makeEvent: (workspace: string) => NMEvent, objects = configuredBrainObjects(),
): Promise<{ id: string }> {
  const [scope] = await pool`select workspace_id from content_items where id = ${itemId}::uuid and status in ('draft', 'scheduled')`;
  if (!scope) throw new DomainError('NOT_FOUND', 'The content item does not exist or is published.');
  const workspace = scope['workspace_id'] as string;
  const id = randomUUID();
  // An object failure leaves the previous media and its publication URL intact.
  const ref = objects ? await objects.put(`v1/workspaces/${workspace}/content/${itemId}/${id}/${brainHash(bytes)}`, bytes, mime) : null;
  await pool.begin(async (tx) => {
    const [item] = await tx`select workspace_id from content_items where id = ${itemId}::uuid and status in ('draft', 'scheduled') for update`;
    if (!item || item['workspace_id'] !== workspace) throw new DomainError('NOT_FOUND', 'The content item does not exist or is published.');
    // Recorded turns may contain an earlier image ID or signed URL. Retain those revisions;
    // only the content item's pointer changes. Unconfigured legacy mode still replaces inline rows.
    if (!objects) await tx`delete from content_media where content_item_id = ${itemId}::uuid and object_ref is null`;
    await tx`insert into content_media (id, workspace_id, content_item_id, mime, bytes, object_ref, size_bytes, created_by_kind, created_by)
      values (${id}::uuid, ${workspace}::uuid, ${itemId}::uuid, ${mime}, ${ref && brainCloudOnly(workspace) ? null : bytes}, ${ref ? tx.json(ref as never) : null}, ${bytes.length}, ${actor.kind}, ${actor.id})`;
    const film = mime.startsWith('video/');
    const patch = film ? { video_id: id } : { image_id: id };
    await tx`update content_items set media = (((coalesce(media, '{}'::jsonb) || ${tx.json(patch)}::jsonb) - ${film ? 'video_error' : 'image_error'}) - ${film ? 'image_id' : 'video_id'}) - ${film ? 'thumb' : 'video_error'} where id = ${itemId}::uuid`;
    const event = makeEvent(workspace);
    await tx`insert into events (id, workspace_id, type, source, target, payload, in_reply_to)
      values (${event.id}, ${workspace}::uuid, ${event.type}, ${event.source}, ${event.target}, ${tx.json(event.payload as never)}, ${event.in_reply_to})`;
    trackDomainEvent(event);
  });
  return { id };
}

export async function contentMediaBytesSql(sql: postgres.Sql, mediaId: string, objects?: BrainObjectStore | null): Promise<{ mime: string; bytes: Buffer; workspace: string } | null> {
  const [row] = await sql`select mime, bytes, object_ref, workspace_id from content_media where id = ${mediaId}::uuid limit 1`;
  if (!row) return null;
  const ref = row['object_ref'] as BrainObjectRef | null;
  const storage = objects ?? (ref ? configuredBrainObjects() : null);
  if (ref && !storage && row['bytes'] != null) {
    const bytes = Buffer.from(row['bytes'] as Uint8Array);
    if (bytes.length !== ref.sizeBytes || brainHash(bytes) !== ref.sha256) throw new Error('Media compatibility copy failed checksum verification.');
    return { mime: row['mime'] as string, bytes, workspace: row['workspace_id'] as string };
  }
  if (ref && !storage) throw new Error('Configure brain object storage to read this media.');
  const bytes = ref ? await storage!.get(ref) : Buffer.from(row['bytes'] as Uint8Array);
  return { mime: row['mime'] as string, bytes, workspace: row['workspace_id'] as string };
}
