// What a post card is made of (the UGC round, 2026-09-18). Pure, so the card's reading of a row
// is testable without React: a VIDEO post carries its script beside the caption (media.script);
// a draft from before that round carried the script AS the body, so it is still read as one.
// Either way the caption is what publishes and the script is what gets filmed.
import { filmCredits, filmMinutes, productShots } from '@neuramesh/shared';

export type CardMedia = {
  image_url?: string; brief?: string; script?: string; thumb?: string; image_error?: string; video_id?: string; video_error?: string;
  /** the video rung: a film in flight on the platform's key, and what filmed a draft */
  video_pending?: boolean; video_error_code?: 'NO_CREDITS' | 'UNAVAILABLE'; video?: { tier: string; model: string; seconds: number; credits: number; at: string; frame?: string | null; frameUsed?: boolean; shots?: { asked: number; applied: number; why?: string } };
  /** the frame (brand-grounding plan §6): the shelf image the film shows as the product */
  frame?: string;
  /** the length the next film takes (video-rung plan §8): the angle card's pick, or the human's word; eight when unset */
  seconds?: number;
};

/** the tiers this server films on, as GET /v1/starter/video answers them */
export type StarterVideoCatalog = { served: boolean; tier: string | null; tiers: Array<{ tier: string; label: string; model: string; seconds: number; credits: number; lengths?: number[]; perSecondMicros?: number }> } | null;

/** the length a draft's next film takes: its own pick, held inside the tier's lengths, else the tier's default */
export function filmSeconds(media: CardMedia | null, tier: { seconds: number; lengths?: number[] } | null | undefined): number {
  const asked = media?.seconds && media.seconds > 0 ? Math.round(media.seconds) : null;
  if (!asked) return tier?.seconds ?? 8;
  const max = tier?.lengths?.length ? Math.max(...tier.lengths) : asked;
  const min = tier?.lengths?.length ? Math.min(...tier.lengths) : asked;
  return Math.min(max, Math.max(min, asked));
}

/** The facts line under a video card's buttons: what will film it, or what did, in one quiet mono
 *  row. Before a film: the workspace's tier from the catalog. After: the draft's own record. A film
 *  on the person's own key says so, and that it cost no credits. Null when there is nothing honest
 *  to say (no catalog yet, no film yet, no key known). */
export function filmFacts(media: CardMedia | null, catalog: StarterVideoCatalog, script: string | null = null): string[] | null {
  const v = media?.video;
  if (v) {
    const when = new Date(v.at);
    const at = Number.isNaN(when.getTime()) ? '' : when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    // the frame the film was asked to show, and whether the lane took it (a model without a reference lane films without it)
    const frame = v.frame ? [`frame · ${v.frame}${v.frameUsed ? '' : ' · not used'}`] : [];
    // the product shots cut into the film (plan §9): how many of the script's SHOW beats landed, or why none did
    const shots = v.shots ? [v.shots.applied ? `product shot${v.shots.asked > 1 ? `s · ${v.shots.applied} of ${v.shots.asked}` : ''}` : `product shot · not applied${v.shots.why ? ` · ${v.shots.why}` : ''}`] : [];
    if (v.tier === 'own') return [v.model, `${v.seconds} s`, 'your key', 'no credits', at, ...frame, ...shots].filter(Boolean);
    const tier = catalog?.tiers.find((t) => t.tier === v.tier);
    return [tier?.label ?? v.tier, v.model, `${v.seconds} s`, `${v.credits} credits`, at, ...frame, ...shots].filter(Boolean);
  }
  if (media?.video_pending) return null;
  const active = catalog?.served ? catalog.tiers.find((t) => t.tier === catalog.tier) : null;
  if (!active) return null;
  // the draft's own length, priced by the same formula the door charges with (one number everywhere)
  const seconds = filmSeconds(media, active);
  const credits = active.perSecondMicros ? filmCredits(active.perSecondMicros, seconds) : active.credits;
  const shows = [...new Set((script ? productShots(script) : []).map((p) => p.show))];
  return [active.label, active.model, `${seconds} s`, `about ${credits} credits`, `${filmMinutes(seconds)} min`, ...(media?.frame ? [`frame · ${media.frame}`] : []), ...(shows.length ? [`product shot · ${shows.join(', ')}`] : [])];
}

/** the film in flight: its tier and model from the catalog, for the pending row */
export function filmingOn(catalog: StarterVideoCatalog): string {
  const active = catalog?.served ? catalog.tiers.find((t) => t.tier === catalog.tier) : null;
  return active ? `${active.label} (${active.model})` : 'the platform';
}

/** a UGC script: timestamped beats. The card folds it (the thread is not a teleprompter) and films its hook. */
export const isScript = (body: string): boolean => (body.match(/^\[\d+:\d\d\s*[-–]\s*\d+:\d\d\]/gm) ?? []).length >= 2;

export function cardParts(body: string, media: CardMedia | null): { caption: string | null; script: string | null } {
  if (media?.script) return { caption: body, script: media.script };
  return isScript(body) ? { caption: null, script: body } : { caption: body, script: null };
}

/** THE FILM AS A FILE (George, 2026-09-19: "are the videos downloadable?"): the bytes the card
 *  already plays, named for the card, in saveFileAs's shape. The card holds a data URL because the
 *  clip is read once with the session, so Save never fetches again, as the article's pictures do.
 *  Null when the source is not a video data URL: nothing honest to hand over. */
export function filmFile(src: string | null | undefined, stem: string): { name: string; content: string; base64: true } | null {
  const m = /^data:video\/([a-z0-9.+-]+);base64,(.+)$/i.exec(src ?? '');
  if (!m) return null;
  const ext = m[1]!.toLowerCase().split('+')[0]!.replace('quicktime', 'mov');
  const name = `${stem.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'film'}.${ext}`;
  return { name, content: m[2]!, base64: true };
}
