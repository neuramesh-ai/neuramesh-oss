// The reply queue (docs/design/models-and-replies-2026-10/plan.md §2). Since February 2026 X lets an
// app reply only to a post whose author mentions it or quotes it, so NeuraMesh posts no reply. It
// PACES them: each queued row gets a time, the server reminds the person at that time, and the
// reminder opens X's own reply box with the text in it (the docs.x.com Web Intent). The person taps
// Reply. Every rule a client or the server needs is here, so the card, the push and the routine's
// automatic queue cannot disagree about a time or a link.

import type { ReplyItem } from './replyops';

/** the gaps a person can pick, in minutes. A routine's queue uses the same set. */
export const REPLY_GAPS = [5, 8, 12, 20] as const;
export type ReplyGap = (typeof REPLY_GAPS)[number];
export const isReplyGap = (n: unknown): n is ReplyGap => typeof n === 'number' && (REPLY_GAPS as readonly number[]).includes(n);

/** a reminder's life: queued (waiting for its time) → due (the server sent it) → opened (the person
 *  opened X) or posted (they said so) or skipped. Only queued and due rows are still owed. */
export const REMINDER_STATES = ['queued', 'due', 'opened', 'posted', 'skipped'] as const;
export type ReminderState = (typeof REMINDER_STATES)[number];
export const reminderOwed = (s: string): boolean => s === 'queued' || s === 'due';

/** the post id an X permalink carries: x.com/<handle>/status/<id> (twitter.com and mobile hosts too) */
export function xPostId(url: string): string | null {
  const m = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/?#]+\/status(?:es)?\/(\d{5,25})(?:[/?#]|$)/i.exec(url.trim());
  return m ? m[1]! : null;
}

/** X's reply box with the reply in it: tap Reply and it posts. Null for a row X cannot answer this
 *  way (another network, or a link with no post id), where the reminder opens the post instead. */
export function replyIntentUrl(item: Pick<ReplyItem, 'draft' | 'target'>): string | null {
  if (item.target.platform !== 'x') return null;
  const id = xPostId(item.target.url);
  return id ? `https://x.com/intent/tweet?in_reply_to=${id}&text=${encodeURIComponent(item.draft)}` : null;
}

/** where a row's verb goes: the reply box when X can open one, else the post itself */
export const replyOpenUrl = (item: Pick<ReplyItem, 'draft' | 'target'>): string => replyIntentUrl(item) ?? item.target.url;

/** the times a queue takes: the first at `startMs`, then one every `gapMin` minutes */
export function queueTimes(count: number, startMs: number, gapMin: ReplyGap): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => startMs + i * gapMin * 60_000);
}

/** one reminder row, as the server stores it and the clients read it (reply_reminders) */
export interface ReplyReminder {
  id: string;
  message_id: string;
  thread_id: string | null;
  letter: string;
  handle: string;
  draft: string;
  open_url: string;
  due_at: string;
  state: ReminderState;
  member_id: string;
}

/** the push a due reminder sends (the server's cron and the web toast use the same words) */
export function reminderWords(r: Pick<ReplyReminder, 'letter' | 'handle' | 'open_url'>): { title: string; body: string } {
  const inX = r.open_url.startsWith('https://x.com/intent/');
  return {
    title: `Reply ${r.letter} is ready to post`,
    body: inX ? `@${r.handle} · Tap to open it in X with the text in it.` : `@${r.handle} · Tap to open the post. Copy the reply from the card.`,
  };
}
