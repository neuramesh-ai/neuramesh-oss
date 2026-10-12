// THE FRAME (docs/design/brand-grounding-2026-09 §6, George 2026-09-19 after the first film on the
// harness showed an invented "NeuraMesh Board" with pseudo-labels: "scope the reference frame
// rung, and lets fix"). A video post names one image on its room's shelf, and the film shows that
// screen. The agent picks the name from the shelf (list_library shows images beside docs, the brand
// note names them); nothing here picks for it and nothing invents an image. A name the shelf does
// not hold is refused with the images it does hold, so the next call can be right, and the server
// refuses it again at the command (handler/content.ts), so a draft never carries a frame that is
// not on its shelf.
//
// REAL APP SCREENSHOTS ONLY (George, 2026-10-06: "when we need an actual screenshot, it should be an
// actual screenshot of the app from our codebase or workspace files instead of a social platform or
// random screenshot"). A frame or a product shot is an image that a PERSON put in Files or a chat,
// or one the platform took from the project's repository (shelve_repo_screenshot, `source` repo:).
// An agent's web capture (the X profile) or a picture an agent drew never counts. The server holds
// the same rule where the draft is written and where the film is made (control-api store/frames.ts).
import { looksLikeProductBeat, scriptBeats } from '@neuramesh/shared';
import type { LibraryReader } from './grounding';
import type { LibDoc } from './orchtools';

const isImage = (d: { mime?: string | null; inline_content: string | null }): boolean => (d.mime ?? '').startsWith('image/') || (d.inline_content ?? '').startsWith('data:image/');
/** a real app screenshot: a person's image, or a file the platform took from the project's repository */
export const isAppShot = (d: Pick<LibDoc, 'created_by_kind' | 'source'>): boolean => d.created_by_kind === 'human' || (d.source ?? '').startsWith('repo:');

/** the images on the room's shelf, then the rest of the PROJECT's (George 2026-09-20: "search the
 *  project files for actual product images"; the server's lookup widened the same way), by name.
 *  `apps`: the real app screenshots among them. `others`: the images a film may not show. */
async function shelf(libraryDocs: LibraryReader, channelId: string): Promise<{ apps: string[]; others: string[] }> {
  const docs = await libraryDocs(channelId, 60, 'project').catch(() => []);
  const room = await libraryDocs(channelId, 60, 'room').catch(() => []);
  const here = new Set(room.filter(isImage).map((d) => d.name));
  const all = [...room.filter(isImage), ...docs.filter(isImage).filter((d) => !here.has(d.name))];
  const apps = [...new Set(all.filter(isAppShot).map((d) => d.name))];
  return { apps, others: [...new Set(all.filter((d) => !isAppShot(d)).map((d) => d.name))].filter((n) => !apps.includes(n)) };
}

/** the real app screenshots a film may show, room first, by name */
export async function appShots(libraryDocs: LibraryReader, channelId: string): Promise<string[]> {
  return (await shelf(libraryDocs, channelId)).apps;
}

const same = (a: string, b: string): boolean => a === b || a.toLowerCase() === b.trim().toLowerCase();
const listed = (apps: string[]): string => apps.length ? `App screenshots on the shelf: ${apps.join(', ')}.` : 'The shelf holds no app screenshots.';
/** the ways out when no screenshot fits: the repository, the person, or a beat with no screen */
const WAYS_OUT = 'Take one from the project\'s repository with shelve_repo_screenshot (list_repo_files finds the images), ask the person to upload a screenshot of the app to this room\'s Files, or write the beat without the screen.';
const notAnApp = (name: string): string => `"${name}" is not an app screenshot: an agent made it (a web capture or a drawn picture), and a film shows only a real screenshot of the app.`;

/** the frame's name as the shelf spells it, or the refusal that lists the screenshots the shelf holds */
export async function frameOf(libraryDocs: LibraryReader, channelId: string, name: string): Promise<{ ok: true; name: string } | { ok: false; why: string }> {
  const { apps, others } = await shelf(libraryDocs, channelId);
  const hit = apps.find((n) => same(n, name));
  if (hit) return { ok: true, name: hit };
  const lead = others.some((n) => same(n, name)) ? notAnApp(name) : `no image named "${name}" on this room's shelf.`;
  return { ok: false, why: `${lead} ${listed(apps)} Name one of those as the frame, or draft without one. ${WAYS_OUT}` };
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

// THE PRODUCT SHOTS (video-rung plan §9). A beat that puts the app's screen on camera cuts to a real
// screenshot once the film lands, and the beat says which: `SHOW: <image name>`. Enforced at the
// draft, not prompted: a SHOW name that is not a real app screenshot on the shelf is refused with the
// screenshots it does hold, and a beat whose words put the app's screen on camera without a SHOW line
// is refused too, naming the ways out. A creator with a phone in hand needs no shot (2026-10-06).
const stamp = (b: { start: number; end: number }): string => `[${Math.floor(b.start / 60)}:${String(b.start % 60).padStart(2, '0')}-${Math.floor(b.end / 60)}:${String(b.end % 60).padStart(2, '0')}]`;

/** the gate a video script passes before it is written: null when every screen beat names a real app screenshot */
export async function productShotsGate(libraryDocs: LibraryReader, channelId: string, script: string): Promise<string | null> {
  const beats = scriptBeats(script);
  if (!beats.some((b) => b.show || looksLikeProductBeat(b))) return null;
  const { apps, others } = await shelf(libraryDocs, channelId);
  for (const b of beats) {
    if (b.show) {
      if (apps.some((n) => same(n, b.show))) continue;
      const lead = others.some((n) => same(n, b.show)) ? notAnApp(b.show) : `no image of that name is on the shelf.`;
      return `Not yet: beat ${stamp(b)} says SHOW: ${b.show}, and ${lead} ${listed(apps)} Name one of them, then draft again. ${WAYS_OUT}`;
    } else if (looksLikeProductBeat(b)) {
      return `Not yet: beat ${stamp(b)} puts the app's screen on camera but names no screenshot, and a video model invents a screen it cannot copy. Add \`SHOW: <image name>\` to that beat (the real screenshot is cut into the film). ${listed(apps)} ${WAYS_OUT}`;
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
