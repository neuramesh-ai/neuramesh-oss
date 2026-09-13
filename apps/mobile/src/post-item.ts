// WHAT A CALENDAR ITEM IS, in plain functions (the mobile fix round, 2026-09-06; George: "calendar
// on mobile seems to be showing routines instead of items").
//
// Pure, and apart from the sheet's React Native imports so a Node test can reach it — the split
// `session-page.ts`, `repo-url.ts` and `model-pick.ts` already use.
//
// The rules here are the desktop card's rules (SocialPostCard.tsx), not new ones. In particular
// `canDrawPicture` mirrors the two-question split that fixed the vanishing redraw button on the
// desktop: a card that HAS a picture can still be drawn again. The gate is the brief and the draft
// status, because `generateDraftImage` looks up drafts only.

export interface PostItem {
  id: string;
  channel_id: string;
  thread_id: string | null;
  task_id: string | null;
  platform: string;
  body: string;
  media: string | null;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  external_url: string | null;
  created_at: string;
}

export interface PostMedia { image_url?: string; brief?: string; thumb?: string; image_error?: string }

const PLATFORM: Record<string, string> = { x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok' };

/** the network's own name, or its id when the catalogue has no word for it */
export const platformName = (p: string): string => PLATFORM[p] ?? p;

/** the media column, which is jsonb on the server and a string here. A broken one is no media. */
export function postMedia(item: Pick<PostItem, 'media'>): PostMedia | null {
  try { return JSON.parse(item.media ?? 'null') as PostMedia | null; } catch { return null; }
}

export const hasPicture = (m: PostMedia | null): boolean => !!m?.thumb || !!m?.image_url;

/** a picture can be drawn whenever there is art direction and the item is still a draft */
export function canDrawPicture(item: Pick<PostItem, 'media' | 'status'>): boolean {
  return !!postMedia(item)?.brief && item.status === 'draft';
}

/** the moment an item sits at, or null when nobody has given it one yet */
export function postSlot(item: Pick<PostItem, 'scheduled_at' | 'published_at' | 'status'>): Date | null {
  const raw = item.scheduled_at ?? (item.status === 'published' ? item.published_at : null);
  if (!raw) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** the first line of a post, cut to fit one row */
export function postHeadline(body: string, cap = 48): string {
  const head = (body.split('\n')[0] ?? '').trim();
  return head.length > cap ? `${head.slice(0, cap)}…` : head;
}

/** the message the desktop's Generate button sends. The marker is what the daemon reads. */
export const drawRequest = (itemId: string, redraw: boolean): string =>
  `${redraw ? 'Redraw' : 'Generate'} the image for this draft.‹gen-image:${itemId}›`;

/** local date + 24-hour time to an ISO instant, or null when either part is malformed */
export function slotToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const at = new Date(`${date}T${time}:00`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** the two halves a person edits, taken from an item's own slot or an hour from now */
export function slotFields(item: Pick<PostItem, 'scheduled_at' | 'published_at' | 'status'>, now = new Date()): { date: string; time: string } {
  const at = postSlot(item) ?? new Date(now.getTime() + 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, time: `${pad(at.getHours())}:${pad(at.getMinutes())}` };
}
