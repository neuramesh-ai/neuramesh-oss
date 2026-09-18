// Marketing content producer (marketing-workflow §4.5). A content-task marketer writes its
// drafts to a `posts.json` file in its run workspace; the daemon parses it here and turns each
// entry into a content_item attached to the task (which renders inline as a reviewable post
// card). Pure + strictly validated so a malformed or hallucinated model output can never mint a
// junk draft — an unparseable file yields no posts, not a crash.

export type DraftedPost = { platform: string; body: string; mediaUrl?: string; imageBrief?: string };

// Mirrors the content_items.platform CHECK (0084 + 0088) and content.create's zod enum.
export const CONTENT_PLATFORMS = ['x', 'instagram', 'linkedin', 'tiktok', 'email'] as const;

// Models habitually append their working notes to the post BODY — an image brief, a
// "Character count: 196/280" tally, a "(draft only, holding for approval)" footer. That text
// would publish verbatim as part of the post AND it inflates the character count (a 196-char
// post reading 410/280). Strip it here: the body must be only what goes on the wire, and the
// image brief is kept separately so it can drive media later instead of being lost.
const BRIEF_RE = /^\s*(?:image|visual|media|photo)\s+(?:brief|prompt|idea)\s*:\s*/i;
const META_RE = /^\s*(?:\(\s*)?(?:draft only|character count|char count|word count|note to reviewer|holding for approval)\b/i;

function splitBody(raw: string): { body: string; imageBrief?: string } {
  const kept: string[] = [];
  const brief: string[] = [];
  let inBrief = false;
  for (const line of raw.split('\n')) {
    if (BRIEF_RE.test(line)) { brief.push(line.replace(BRIEF_RE, '').trim()); inBrief = true; continue; }
    if (META_RE.test(line)) { inBrief = false; continue; }
    if (inBrief) {
      if (!line.trim()) { inBrief = false; continue; } // a blank line ends the brief
      brief.push(line.trim());
      continue;
    }
    kept.push(line);
  }
  return {
    body: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    imageBrief: brief.join(' ').trim() || undefined,
  };
}

/**
 * Validate ONE drafted post that arrived as tool arguments rather than in `posts.json`.
 *
 * The wire file is the marketer's contract on a content TASK; `draft_posts` is how an agent
 * answering in a THREAD hands over the same thing without writing a file nobody can act on. Both
 * end as content_items, so both must be cleaned identically — the "Character count: 196/280"
 * footer models habitually append is the same defect whichever door it comes through, and a
 * second, looser cleaner on the tool path is how the two surfaces drift.
 *
 * Returns null when the entry could never be a post: an unsupported platform, or a body that was
 * only working notes. The caller drops it rather than minting a junk draft.
 */
export function normalizeDraft(input: { platform?: string; body?: string; imageBrief?: string; mediaUrl?: string }): DraftedPost | null {
  const platform = String(input.platform ?? 'x').toLowerCase().trim();
  if (!(CONTENT_PLATFORMS as readonly string[]).includes(platform)) return null;
  const { body, imageBrief } = splitBody(typeof input.body === 'string' ? input.body : '');
  if (!body) return null;
  const declaredBrief = typeof input.imageBrief === 'string' ? input.imageBrief.trim() : '';
  const rawMedia = typeof input.mediaUrl === 'string' ? input.mediaUrl.trim() : '';
  const mediaUrl = /^https?:\/\/\S+$/i.test(rawMedia) ? rawMedia : undefined;
  const brief = declaredBrief || imageBrief;
  return {
    platform,
    body: body.slice(0, 10_000),
    ...(mediaUrl ? { mediaUrl } : {}),
    ...(brief ? { imageBrief: brief.slice(0, 2_000) } : {}),
  };
}

/**
 * Parse the marketer's `posts.json` into validated drafted posts. Accepts either a bare array
 * or a `{ posts: [...] }` wrapper (models reach for both). Every entry must name a supported
 * platform and carry a non-empty body; anything else is dropped. The body is cleaned of working
 * notes (see splitBody) and any image brief is lifted onto `imageBrief`. mediaUrl is kept only
 * when it looks like an http(s) URL. Capped so a runaway output can't fan out into hundreds.
 */
export function parseDraftedPosts(raw: string, cap = 20): DraftedPost[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { posts?: unknown[] }).posts)
      ? (parsed as { posts: unknown[] }).posts
      : [];
  const out: DraftedPost[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    // the SAME cleaner the tool path uses — see normalizeDraft
    const post = normalizeDraft({
      ...(typeof rec['platform'] === 'string' ? { platform: rec['platform'] } : {}),
      ...(typeof rec['body'] === 'string' ? { body: rec['body'] } : {}),
      ...(typeof rec['imageBrief'] === 'string' ? { imageBrief: rec['imageBrief'] } : {}),
      ...(typeof rec['mediaUrl'] === 'string' ? { mediaUrl: rec['mediaUrl'] } : {}),
    });
    if (!post) continue;
    out.push(post);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * The SHOW verb (live #1048). Asked "can you show the drafts for x", the marketer had no way to
 * point at the cards already rendering those drafts, so it retyped all three as markdown — the
 * same posts on screen twice. It now writes a ```cards block naming letters, and the thread
 * re-anchors those cards under the reply.
 *
 * Deliberately forgiving about shape ("a, b", "a b c", "#1048·a", a JSON array) and strict about
 * output: single letters, de-duplicated, in the order given. A hallucinated letter is dropped by
 * the caller, which resolves letters against the drafts that actually exist.
 */
export function parseShowLetters(raw: string, cap = 20): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of raw.split(/[\s,;[\]"']+/)) {
    const letter = /^(?:#?\d+[·.-])?([a-z])$/i.exec(tok.trim())?.[1]?.toLowerCase();
    if (!letter || seen.has(letter)) continue;
    seen.add(letter);
    out.push(letter);
    if (out.length >= cap) break;
  }
  return out;
}

// A TARGETED revision of an existing draft (marketing-workflow §4.5): the marketer, asked to
// change one card, writes `revised.json` keying each edit by the draft's LETTER (a/b/c — the
// #1027·a the human replied to). Only the drafts named change; the rest are left alone. `body`
// and/or `imageBrief` — at least one — or the entry is meaningless and dropped.
export type DraftRevision = { letter: string; body?: string; imageBrief?: string; dropImage?: boolean };

export function parseDraftRevisions(raw: string, cap = 20): DraftRevision[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { revisions?: unknown[] }).revisions)
      ? (parsed as { revisions: unknown[] }).revisions
      : [];
  const out: DraftRevision[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    // accept "a", "A", "#1027·a", "1027·a", "draft a" → the trailing letter
    const rawLetter = String(rec['letter'] ?? rec['id'] ?? rec['draft'] ?? '').trim().toLowerCase();
    const letter = (/([a-z])\s*$/.exec(rawLetter)?.[1]) ?? '';
    if (!letter || seen.has(letter)) continue;
    const rawBody = typeof rec['body'] === 'string' ? rec['body'] : '';
    const { body, imageBrief: bodyBrief } = rawBody.trim() ? splitBody(rawBody) : { body: '', imageBrief: undefined };
    const declaredBrief = typeof rec['imageBrief'] === 'string' ? rec['imageBrief'].trim() : '';
    const brief = declaredBrief || bodyBrief;
    const dropImage = rec['dropImage'] === true || rec['removeImage'] === true;
    if (!body && !brief && !dropImage) continue; // nothing to actually change
    seen.add(letter);
    out.push({
      letter,
      ...(body ? { body: body.slice(0, 10_000) } : {}),
      ...(brief ? { imageBrief: brief.slice(0, 2_000) } : {}),
      ...(dropImage ? { dropImage: true } : {}),
    });
    if (out.length >= cap) break;
  }
  return out;
}
