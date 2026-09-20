// GROUNDING IS A GATE, NOT A RULE (2026-09-19, the local fleet harness). With the brand note in
// its prompt and the skill's "read the room's brand docs first" loaded, the house model on the
// runner still went list_playbooks → load_skill → draft_posts and never opened the shelf. A
// prompt rule loses to a small model every time. So the rule lives where a rule can be enforced:
// `draft_posts` in a marketing room whose shelf holds brand docs refuses until this turn has read
// one of them, and the refusal names the exact call that lifts it. The agent keeps its judgment on
// what to read and what to write. It cannot skip reading.
//
// One record per TURN (the registries are built per turn), shared by the read tools that fill it
// and the write tool that asks it. The chat registry had no library reads at all before this
// (the marketer's conversation could not reach the shelf its skill told it to read): the two
// tools live here now, one implementation for both registries.
import type { AttDbLike } from '../agents';
import type { LibDoc } from './orchtools';
import { readBrand } from './brandnote';

/** what this turn has read: shelf documents by name, and the draft cards by letter (chattools-drafts.ts) */
export interface Grounding { read: Set<string>; drafts: Set<string> }
export const newGrounding = (): Grounding => ({ read: new Set(), drafts: new Set() });

type Scope = 'room' | 'project' | 'workspace';
export type LibraryReader = (channelId: string, limit?: number, scope?: Scope) => Promise<LibDoc[]>;

/** the shelf as a list: names, kinds, and where a widened scope found them */
export async function listLibrary(libraryDocs: LibraryReader, channelId: string, scope: Scope): Promise<string> {
  const docs = await libraryDocs(channelId, 60, scope);
  if (!docs.length) return scope === 'room' ? 'this room\'s library is empty — try scope:\'project\' or scope:\'workspace\'' : `no documents in this ${scope}`;
  return JSON.stringify(docs.map((d) => ({
    name: d.name, kind: d.kind, promoted: !!d.promoted,
    ...(scope === 'room' ? {} : { room: d.room, project: d.project }),
    created: d.created_at, size: (d.inline_content ?? '').length,
  })));
}

/** one document's text, capped, with the read recorded on the turn's grounding */
export async function readLibraryDoc(libraryDocs: LibraryReader, channelId: string, want: string, scope: Scope, grounding: Grounding): Promise<string> {
  const docs = await libraryDocs(channelId, 60, scope);
  const hit = docs.find((d) => d.name === want) ?? docs.find((d) => d.name.toLowerCase() === want.toLowerCase());
  if (!hit) return `no document named "${want}" in this ${scope} — call list_library${scope === 'room' ? ' (or widen it with scope)' : ` with scope:'${scope}'`} for the names`;
  const body = hit.inline_content ?? '';
  // An image's `inline_content` is a data URI, not prose. Returning it raw spent the turn's
  // context on base64; returning '' let the model report the document as empty. Say what it
  // is instead, so the agent reports the limit rather than inventing the contents.
  if ((hit.mime ?? '').startsWith('image/') || body.startsWith('data:image')) {
    return `"${hit.name}" is an image (${hit.mime ?? 'image'}), not a text document — it cannot be read as text. It is in the library and a human can view it.`;
  }
  if (!body.trim()) return `"${hit.name}" is in the library but has no readable text body.`;
  grounding.read.add(hit.name);
  // capped so one long report cannot eat the turn's context; the model is TOLD it was cut
  return body.length > 24_000 ? `${body.slice(0, 24_000)}\n\n…(truncated — this document is ${body.length} characters)` : body;
}

/**
 * The gate `draft_posts` asks before it writes: null when the draft may proceed, else the
 * refusal that names the read that lifts it. Only a marketing room with brand docs on its
 * shelf gates; every other room drafts as before.
 */
export async function ungrounded(db: AttDbLike, channelId: string, grounding: Grounding): Promise<string | null> {
  const b = await readBrand(db, channelId);
  if (!b.marketing || !b.docs.size) return null;
  const names = [...b.docs.keys()];
  if (names.some((n) => grounding.read.has(n))) return null;
  const first = names.includes('business-profile.md') ? 'business-profile.md' : names[0]!;
  const rest = names.filter((n) => n !== first);
  return `Not yet: read this room's brand docs before you draft. Call read_library_doc with name "${first}" (scope room)${rest.length ? `, and ${rest.join(', ')} for the voice and the market` : ''}. Then call draft_posts again with copy grounded in what they say.`;
}
