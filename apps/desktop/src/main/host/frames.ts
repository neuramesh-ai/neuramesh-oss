// THE FRAME (docs/design/brand-grounding-2026-09 §6, George 2026-09-19 after the first film on the
// harness showed an invented "NeuraMesh Board" with pseudo-labels: "scope the reference frame
// rung, and lets fix"). A video post names one image on its room's shelf, and the film shows that
// screen. The agent picks the name from the shelf (list_library shows images beside docs, the brand
// note names them); nothing here picks for it and nothing invents an image. A name the shelf does
// not hold is refused with the images it does hold, so the next call can be right, and the server
// refuses it again at the command (handler/content.ts), so a draft never carries a frame that is
// not on its shelf.
import { looksLikeProductBeat, scriptBeats } from '@neuramesh/shared';
import type { LibraryReader } from './grounding';

const isImage = (d: { mime?: string | null; inline_content: string | null }): boolean => (d.mime ?? '').startsWith('image/') || (d.inline_content ?? '').startsWith('data:image/');

/** the images on the room's shelf, then the rest of the PROJECT's (George 2026-09-20: "search the
 *  project files for actual product images"; the server's lookup widened the same way), by name */
export async function shelfImages(libraryDocs: LibraryReader, channelId: string): Promise<string[]> {
  const docs = await libraryDocs(channelId, 60, 'project').catch(() => []);
  const room = await libraryDocs(channelId, 60, 'room').catch(() => []);
  const here = new Set(room.filter(isImage).map((d) => d.name));
  const names = [...here, ...docs.filter(isImage).map((d) => d.name).filter((n) => !here.has(n))];
  return [...new Set(names)];
}

/** the frame's name as the shelf spells it, or the refusal that lists what the shelf holds */
export async function frameOf(libraryDocs: LibraryReader, channelId: string, name: string): Promise<{ ok: true; name: string } | { ok: false; why: string }> {
  const images = await shelfImages(libraryDocs, channelId);
  const hit = images.find((n) => n === name) ?? images.find((n) => n.toLowerCase() === name.trim().toLowerCase());
  if (hit) return { ok: true, name: hit };
  if (!images.length) return { ok: false, why: `no image named "${name}": this room's shelf holds no images. Draft without a frame, and ask the human to upload a screenshot of the product to this room's Files, then name it as the frame with revise_posts.` };
  return { ok: false, why: `no image named "${name}" on this room's shelf. Its images: ${images.join(', ')}. Name one of those as the frame, or draft without one.` };
}

/** the frames of a draft_posts call, by post index, checked before anything is written: one miss refuses the whole call */
export async function framesFor(libraryDocs: LibraryReader, channelId: string, posts: ReadonlyArray<{ frame?: string }>): Promise<{ ok: true; names: Map<number, string> } | { ok: false; why: string }> {
  const names = new Map<number, string>();
  for (const [i, p] of posts.entries()) {
    if (!p.frame?.trim()) continue;
    const f = await frameOf(libraryDocs, channelId, p.frame);
    if (!f.ok) return f;
    names.set(i, f.name);
  }
  return { ok: true, names };
}

/** a revision's frame: undefined leaves it, "none" drops it (null), a name is checked against the shelf */
export async function frameArg(libraryDocs: LibraryReader, channelId: string, raw: string | undefined): Promise<{ ok: true; frame?: string | null } | { ok: false; why: string }> {
  if (!raw?.trim()) return { ok: true };
  if (/^(none|no frame)$/i.test(raw.trim())) return { ok: true, frame: null };
  const f = await frameOf(libraryDocs, channelId, raw);
  return f.ok ? { ok: true, frame: f.name } : f;
}

// THE PRODUCT SHOTS (video-rung plan §9). A beat that shows the product cuts to a real image once the
// film lands, and the beat says which: `SHOW: <image name>`. Enforced at the draft, not prompted: a
// SHOW name the shelf does not hold is refused with the images it does hold, and a beat whose words
// show the product (the app, the screen, the phone) without a SHOW line is refused too, naming the
// three ways out: name an image, make one (make_product_image), or write the beat without a screen.
const stamp = (b: { start: number; end: number }): string => `[${Math.floor(b.start / 60)}:${String(b.start % 60).padStart(2, '0')}-${Math.floor(b.end / 60)}:${String(b.end % 60).padStart(2, '0')}]`;

/** the gate a video script passes before it is written: null when every product beat names a shelf image */
export async function productShotsGate(libraryDocs: LibraryReader, channelId: string, script: string): Promise<string | null> {
  const beats = scriptBeats(script);
  if (!beats.some((b) => b.show || looksLikeProductBeat(b))) return null;
  const images = await shelfImages(libraryDocs, channelId);
  const have = images.length ? `Images on the shelf: ${images.join(', ')}.` : 'The shelf holds no images.';
  for (const b of beats) {
    if (b.show) {
      const hit = images.find((n) => n === b.show) ?? images.find((n) => n.toLowerCase() === b.show.trim().toLowerCase());
      if (!hit) return `Not yet: beat ${stamp(b)} says SHOW: ${b.show}, and no image of that name is on the shelf. ${have} Name one of them, or make_product_image to make one, then draft again.`;
    } else if (looksLikeProductBeat(b)) {
      return `Not yet: beat ${stamp(b)} shows the product but names no image, and a video model invents a screen it cannot copy. Add \`SHOW: <image name>\` to that beat (the real image is cut into the film). ${have} No image fits: make_product_image, or ask the human for a screenshot, or write the beat without the screen.`;
    }
  }
  return null;
}

/** the gate over every video post of a draft_posts call: the first refusal names its post */
export async function productShotsFor(libraryDocs: LibraryReader, channelId: string, posts: ReadonlyArray<{ script?: string }>): Promise<string | null> {
  for (const [i, p] of posts.entries()) {
    if (!p.script?.trim()) continue;
    const why = await productShotsGate(libraryDocs, channelId, p.script);
    if (why) return posts.length > 1 ? `Post ${String.fromCharCode(97 + i)}: ${why}` : why;
  }
  return null;
}
