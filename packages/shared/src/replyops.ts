// Reply opportunities (docs/design/reply-radar-2026-08) — the ```nmreply block: high-reach
// conversations worth joining, each with the target post AND the drafted reply on one row.
//
// It exists because drafted REPLIES were riding draft_posts → SocialPostCard, the standalone
// POST preview: network chrome, a "schedule" verb that would schedule a standalone post, and
// no target on the card at all — what you were answering lived in a separate prose list, so
// the reader joined two surfaces by letter (George, 2026-08-22).
//
// The nmnext sibling in every structural way: the daemon's tool writes the block, ONE renderer
// derivation turns it into the card, the block carries its own channel so the card is
// self-contained in any thread renderer, and every verb is the HUMAN's click. v1 posts nothing:
// the human opens the post and replies by hand, so the card's verbs are open · copy · redraft ·
// mark replied. A drawn picture rides `imageArtifactId` (a real attachment, never base64 in
// the fence) and is DOWNLOADED, never auto-published.

import { fencedBlock, stripFenced } from './linear';

/** every network the radar can surface a conversation from (2026-08-22, George: "any connectors
 *  that are ready, not just x"). What differs per network is the READ, not the card. */
export const REPLY_PLATFORMS = ['x', 'linkedin', 'instagram', 'tiktok'] as const;
export type ReplyPlatform = (typeof REPLY_PLATFORMS)[number];

/**
 * Where a row's facts came from — the honesty axis, because only X has a read API today
 * (`/v1/x/search`); LinkedIn, Instagram and TikTok are publish-only connectors, so their
 * conversations are found through public web research with NO engagement numbers. The row
 * says which it is rather than letting a reader assume every number is measured.
 */
export type ReplySource = 'connector' | 'web';

export interface ReplyTarget {
  handle: string;
  name?: string;
  url: string;
  platform: ReplyPlatform;
  /** how this row was found — 'connector' carries real metrics, 'web' never does */
  source: ReplySource;
  /** short age label as the search returned it — "14h", "2d" */
  age?: string;
  /** the post being answered, verbatim (clamped to 3 lines on the card, click to expand) */
  text: string;
  metrics?: { impressions?: number; likes?: number; reposts?: number; replies?: number };
}

export interface ReplyItem {
  /** the card letter — the handle every revise_replies call names */
  letter: string;
  target: ReplyTarget;
  /** the reply text exactly as it would post */
  draft: string;
  /** one line: why this conversation is worth joining */
  why?: string;
  /** a drawn picture for this reply — the artifact id of a real attachment */
  imageArtifactId?: string;
  /** the brief it was drawn from (the redraw re-runs it) */
  imageBrief?: string;
}

export interface NmReply {
  /** the report this came out of — the card's provenance line */
  report?: string;
  channel: string;
  /** the honesty line: what the brand's own posts reach, so the ranking means something */
  baseline?: string;
  items: ReplyItem[];
}

export const REPLIES_CAP = 8;
export const REPLIES_PAGE = 5;
/** each network's reply ceiling — the card shows `n/limit` so an overlong draft is visible
 *  before the human pastes it (X 280 · LinkedIn comments 1,250 · IG 2,200 · TikTok 150) */
export const REPLY_LIMITS: Record<ReplyPlatform, number> = { x: 280, linkedin: 1250, instagram: 2200, tiktok: 150 };

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);

/** clamp/validate a model-authored reply list — the shape guard the tool trusts (cleanNextItems idiom) */
export function cleanReplies(raw: unknown): ReplyItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ReplyItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const t = (o['target'] ?? {}) as Record<string, unknown>;
    const handle = typeof t['handle'] === 'string' ? t['handle'].trim().replace(/^@+/, '').slice(0, 40) : '';
    const url = typeof t['url'] === 'string' && /^https?:\/\//.test(t['url'].trim()) ? t['url'].trim().slice(0, 500) : '';
    const text = typeof t['text'] === 'string' ? t['text'].trim().slice(0, 2000) : '';
    const draft = typeof o['draft'] === 'string' ? o['draft'].trim().slice(0, 1000) : '';
    // a row with no target post, no link or no draft is not a reply opportunity — it is noise
    if (!handle || !url || !text || !draft) continue;
    const m = (t['metrics'] ?? {}) as Record<string, unknown>;
    const metrics = { impressions: num(m['impressions']), likes: num(m['likes']), reposts: num(m['reposts']), replies: num(m['replies']) };
    const platform = (REPLY_PLATFORMS as readonly string[]).includes(t['platform'] as string) ? (t['platform'] as ReplyPlatform) : 'x';
    // web-found rows carry NO metrics, whatever the model put there: only a connector read
    // can measure reach, and a plausible-looking number from a web page is a fabrication
    const source: ReplySource = t['source'] === 'web' ? 'web' : 'connector';
    const item: ReplyItem = {
      letter: (typeof o['letter'] === 'string' && o['letter'].trim() ? o['letter'].trim()[0]! : String.fromCharCode(65 + out.length)).toUpperCase(),
      target: {
        handle,
        url,
        text,
        platform,
        source,
        ...(typeof t['name'] === 'string' && t['name'].trim() ? { name: t['name'].trim().slice(0, 60) } : {}),
        ...(typeof t['age'] === 'string' && t['age'].trim() ? { age: t['age'].trim().slice(0, 12) } : {}),
        ...(source === 'connector' && Object.values(metrics).some((v) => v !== undefined) ? { metrics } : {}),
      },
      draft,
    };
    if (typeof o['why'] === 'string' && o['why'].trim()) item.why = o['why'].trim().slice(0, 160);
    if (typeof o['imageArtifactId'] === 'string' && o['imageArtifactId'].trim()) item.imageArtifactId = o['imageArtifactId'].trim().slice(0, 64);
    if (typeof o['imageBrief'] === 'string' && o['imageBrief'].trim()) item.imageBrief = o['imageBrief'].trim().slice(0, 2000);
    out.push(item);
    if (out.length >= REPLIES_CAP) break;
  }
  return out;
}

export function repliesBlock(data: NmReply): string {
  return '```nmreply\n' + JSON.stringify(data) + '\n```';
}

export function parseReplies(body: string): NmReply | null {
  const m = fencedBlock(body, 'nmreply');
  if (!m) return null;
  try {
    const d = JSON.parse(m.inner) as NmReply;
    if (!d || typeof d.channel !== 'string') return null;
    const items = cleanReplies(d.items);
    if (!items.length) return null;
    return {
      channel: d.channel, items,
      ...(typeof d.report === 'string' && d.report ? { report: d.report } : {}),
      ...(typeof d.baseline === 'string' && d.baseline ? { baseline: d.baseline } : {}),
    };
  } catch { return null; }
}

export function stripReplies(body: string): string {
  return stripFenced(body, 'nmreply').trim();
}

/**
 * Apply one revision to a card's items, in place by letter — the revise_posts contract:
 * the row KEEPS its letter and its position, so the human's mental index never moves.
 * Returns null when the letter names no row (the tool reports that rather than adding one).
 */
export function applyReplyRevision(
  items: ReplyItem[],
  rev: { letter: string; draft?: string; imageArtifactId?: string; imageBrief?: string },
): ReplyItem[] | null {
  const letter = rev.letter.trim()[0]?.toUpperCase();
  if (!letter || !items.some((i) => i.letter === letter)) return null;
  return items.map((i) => (i.letter !== letter ? i : {
    ...i,
    ...(rev.draft?.trim() ? { draft: rev.draft.trim().slice(0, 1000) } : {}),
    ...(rev.imageArtifactId ? { imageArtifactId: rev.imageArtifactId } : {}),
    ...(rev.imageBrief?.trim() ? { imageBrief: rev.imageBrief.trim().slice(0, 2000) } : {}),
  }));
}
