// What a post card is made of (the UGC round, 2026-09-18). Pure, so the card's reading of a row
// is testable without React: a VIDEO post carries its script beside the caption (media.script);
// a draft from before that round carried the script AS the body, so it is still read as one.
// Either way the caption is what publishes and the script is what gets filmed.

export type CardMedia = { image_url?: string; brief?: string; script?: string; thumb?: string; image_error?: string; video_id?: string; video_error?: string };

/** a UGC script: timestamped beats. The card folds it (the thread is not a teleprompter) and films its hook. */
export const isScript = (body: string): boolean => (body.match(/^\[\d+:\d\d\s*[-–]\s*\d+:\d\d\]/gm) ?? []).length >= 2;

export function cardParts(body: string, media: CardMedia | null): { caption: string | null; script: string | null } {
  if (media?.script) return { caption: body, script: media.script };
  return isScript(body) ? { caption: null, script: body } : { caption: body, script: null };
}
