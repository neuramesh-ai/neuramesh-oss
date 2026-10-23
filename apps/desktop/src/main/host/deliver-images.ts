import { beginImageGeneration } from '../agent-stream';
import { createHash, randomUUID } from 'node:crypto';
import { originalImage, type ImageOutput } from '../image-original';
import { publishConversationArtifact } from '../harness/brain-sync-context';
import type { HostCtx } from './ctx';

/** Both chat registries save originals through the authenticated artifact store. The server
 * derives task/channel ownership from the posted message's thread, never from model input. */
export async function deliverImages(ctx: Pick<HostCtx, 'post'> & {
  actor: { kind: string; id: string; role?: string };
  agentName?: string;
  channel: { id: string; workspace_id: string };
  anchor: { threadId?: string; taskId?: string };
  generate: (brief: string) => Promise<ImageOutput>;
}, input: { images: Array<{ brief: string; name?: string }>; caption?: string }): Promise<{ attached: number; failed: string[]; error?: string }> {
  const progress = beginImageGeneration(ctx.channel.id, ctx.agentName ?? 'rex', ctx.anchor, input.images.length);
  try {
    const made: Array<ReturnType<typeof originalImage> & { name: string }> = [];
    const failed: string[] = [];
    for (const requested of input.images) {
      try {
        const image = originalImage(await ctx.generate(requested.brief));
        const stem = (requested.name ?? 'image').replace(/\.(png|jpe?g|webp|gif)$/i, '').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'image';
        made.push({ ...image, name: `${stem}.${image.extension}` });
      } catch (error) { failed.push(error instanceof Error ? error.message : 'The generator failed.'); }
    }
    if (!made.length) return { attached: 0, failed, error: `No images were generated — ${failed[0] ?? 'empty result'}. Report the failure.` };
    progress.saving();
    const response = await ctx.post('/v1/messages', ctx.actor, { workspace: ctx.channel.workspace_id, channel: ctx.channel.id, ...ctx.anchor,
      body: input.caption?.trim() || `Here ${made.length === 1 ? 'is the image' : 'are the images'}.` }).catch(() => null);
    const message = response?.ok ? (await response.json().catch(() => null))?.message as { id?: string; thread_id?: string } | undefined : undefined;
    const threadId = message?.thread_id ?? ctx.anchor.threadId;
    if (!message?.id || !threadId) return { attached: 0, failed, error: 'The images generated but their destination could not be saved. Report the failure.' };
    let attached = 0;
    for (const image of made) {
      try {
        const id = randomUUID();
        const body = { id, workspace: ctx.channel.workspace_id, channel: ctx.channel.id, messageId: message.id, kind: 'file', name: image.name, mime: image.mime };
        // The active recorder keeps failed uploads queued durably. Task callers without a recorder
        // use the same authenticated endpoint and report rejection without substituting a thumbnail.
        const queued = publishConversationArtifact('/v1/artifacts', { ...body, inlineContent: image.dataUrl }, ctx.actor);
        const saved = await (queued ?? ctx.post('/v1/brain/artifacts', ctx.actor, { ...body, threadId,
          contentBase64: image.bytes.toString('base64'), sha256: createHash('sha256').update(image.bytes).digest('hex') }));
        if (!saved.ok) throw new Error(`Original image upload failed (${saved.status}).`);
        attached++;
      } catch (error) { failed.push(error instanceof Error ? error.message : 'Original image upload failed.'); }
    }
    return { attached, failed, ...(!attached ? { error: 'The images generated but their originals could not be attached. Report the failure.' } : {}) };
  } finally { progress.finish(); }
}
