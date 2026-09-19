// THE FRAME (docs/design/brand-grounding-2026-09 §6, George 2026-09-19 after the first film on the
// harness showed an invented "NeuraMesh Board" with pseudo-labels: "scope the reference frame
// rung, and lets fix"). A video post names one image on its room's shelf, and the film shows that
// screen. The agent picks the name from the shelf (list_library shows images beside docs, the brand
// note names them); nothing here picks for it and nothing invents an image. A name the shelf does
// not hold is refused with the images it does hold, so the next call can be right, and the server
// refuses it again at the command (handler/content.ts), so a draft never carries a frame that is
// not on its shelf.
import type { LibraryReader } from './grounding';

const isImage = (d: { mime?: string | null; inline_content: string | null }): boolean => (d.mime ?? '').startsWith('image/') || (d.inline_content ?? '').startsWith('data:image/');

/** the images on the room's shelf, by name, newest first */
export async function shelfImages(libraryDocs: LibraryReader, channelId: string): Promise<string[]> {
  const docs = await libraryDocs(channelId, 60, 'room').catch(() => []);
  return docs.filter(isImage).map((d) => d.name);
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
