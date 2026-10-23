import { originalImage } from './image-original';
import { parseDraftedPosts, type DraftedPost } from '@neuramesh/shared';

export type ContentDraftCmd = { type: 'content.create'; channel: string; task: string; platform: string; body: string; mediaUrl?: string; imageBrief?: string; thumb?: string; imageError?: string };

/**
 * Produces the actual pixels for one drafted post's image brief (imagegen.ts, injected).
 * `thumb` is the small inline preview that rides the draft; `bytes` and `mime` are the original image that
 * gets HOSTED so a network can fetch it — without that copy the picture can never leave the machine.
 */
export type ImageMaker = (post: DraftedPost) => Promise<{ bytes?: Buffer; mime?: string; thumb?: string; error?: string }>;
/** Creates the draft and returns its new content item id (null = the create was rejected). */
export type EmitDraft = (cmd: ContentDraftCmd) => Promise<string | null>;
/** Hosts the original image against that item (content.attach_media). */
export type AttachMedia = (itemId: string, dataUrl: string) => Promise<boolean>;

export type DraftOutcome = { made: number; images: number; hosted: number; notes: string[] };

// Cost guard: a runaway draft set must not mint twenty paid generations. Anything past the cap
// keeps its brief and renders as "needs image" — and we say so rather than dropping it silently.
const IMAGE_CAP = 4;

/**
 * The marketer content producer (marketing-workflow §4.5). Reads the marketer's `posts.json`
 * from its run workspace and emits a `content.create` for each validated draft, ATTACHED to
 * `taskId` — so each post renders inline as a reviewable card in the task's thread.
 *
 * When a draft carries an image brief and `makeImage` is supplied (§4.6), the image is generated
 * here: full bytes land in the workspace's `media/` folder, and a downscaled thumbnail rides the
 * draft so the card shows the real picture. A generation failure is never fatal — the post is
 * still created, keeping its brief, and the reason is reported back.
 *
 * Deliberately free of Electron/HTTP: the caller injects `emit` and `makeImage`, so the
 * read → parse → attach path is unit-testable without a live backend or a GPU bill.
 */
export async function draftPostsFromWorkspace(
  dir: string,
  ctx: { taskId: string; channelId: string },
  emit: EmitDraft,
  makeImage?: ImageMaker,
  attach?: AttachMedia,
): Promise<DraftOutcome> {
  let raw: string;
  try {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    raw = await readFile(join(dir, 'posts.json'), 'utf8');
  } catch {
    return { made: 0, images: 0, hosted: 0, notes: [] }; // no posts.json — the marketer produced nothing parseable
  }
  const posts: DraftedPost[] = parseDraftedPosts(raw);
  const out: DraftOutcome = { made: 0, images: 0, hosted: 0, notes: [] };
  let asked = 0;

  for (const p of posts) {
    let thumb: string | undefined;
    let publish: string | undefined;
    let imageError: string | undefined; // the reason a briefed draft has no image — shown ON the card
    if (p.imageBrief && makeImage && !p.mediaUrl) {
      asked++;
      if (asked > IMAGE_CAP) {
        imageError = `image cap reached (${IMAGE_CAP}/task) — use Try again to draw this one`;
        if (asked === IMAGE_CAP + 1) out.notes.push(`image cap ${IMAGE_CAP} reached — later drafts keep their brief instead`);
      } else {
        const got: Awaited<ReturnType<ImageMaker>> = await makeImage(p).catch((e: Error) => ({ error: e.message }));
        try {
          const original = originalImage(got);
          const { mkdir, writeFile } = await import('node:fs/promises');
          const { join } = await import('node:path');
          try {
            await mkdir(join(dir, 'media'), { recursive: true });
            await writeFile(join(dir, 'media', `${p.platform}-${asked}.${original.extension}`), original.bytes);
          } catch { /* Hosting below remains authoritative; this local copy is optional. */ }
          thumb = got.thumb;
          publish = original.dataUrl;
          out.images++;
        } catch (error) {
          imageError = error instanceof Error ? error.message : 'The original image is unavailable.';
          out.notes.push(`image for the ${p.platform} draft: ${imageError}`);
        }
      }
    }
    const itemId = await emit({
      type: 'content.create',
      channel: ctx.channelId,
      task: ctx.taskId,
      platform: p.platform,
      body: p.body,
      ...(p.mediaUrl ? { mediaUrl: p.mediaUrl } : {}),
      ...(p.imageBrief ? { imageBrief: p.imageBrief } : {}),
      ...(thumb ? { thumb } : {}),
      ...(imageError ? { imageError } : {}),
    }).catch(() => null);
    if (!itemId) continue;
    out.made++;
    // Host the full-size copy against the draft. Only now can it publish: Instagram has Meta
    // fetch the URL, TikTok pulls it through our proxy, X uploads the bytes.
    if (publish && attach) {
      const hosted = await attach(itemId, publish).catch(() => false);
      if (hosted) out.hosted++;
      else out.notes.push(`the ${p.platform} image was generated but not hosted — it can't publish until it is`);
    }
  }
  return out;
}
