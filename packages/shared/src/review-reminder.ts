// THE REVIEW REMINDER (George, 2026-09-07: "any item on our calendar that's scheduled should send a
// push notification 30 minutes before it lands incase i want to review it before it goes out").
//
// Pure, because the WORDS are the feature. A reminder that names the wrong time, or fires for a
// post that has already gone, is worse than no reminder: it teaches a person to ignore the one
// channel that was supposed to catch something before it left the building.
//
// It is deliberately NOT a scheduler. The cron that already runs every minute asks this what to say
// about the rows it found, and the push lane's dedupe key makes "already reminded" a fact rather
// than a column — so there is no migration and a double-fired cron is a no-op. THE WINDOW IS THE
// LANE'S TO HOLD: its default dedupe (60s) is shorter than the cron's minute, which sent this reminder
// every other minute for half an hour on 2026-09-08 (George's lock screen). The reminder passes its
// own window, longer than the lead, alongside this key.

/** how long before a post lands the reminder goes out */
export const REVIEW_LEAD_MIN = 30;

export interface ReviewCandidate {
  id: string;
  platform: string;
  body: string;
  /** when it publishes */
  at: Date;
}

export interface ReviewPush {
  id: string;
  /** stable per item AND its scheduled minute: the cron sends exactly one, and a post moved to a new
   *  time earns a new reminder (a stamp on the old time says nothing about the new one) */
  dedupeKey: string;
  title: string;
  body: string;
}

const NAMES: Record<string, string> = { x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok', threads: 'Threads' };

/** the post's opening words, enough to recognise it on a lock screen and no more */
export function snippet(body: string, cap = 90): string {
  const line = body.replace(/\s+/g, ' ').trim();
  return line.length <= cap ? line : `${line.slice(0, cap - 1).trimEnd()}…`;
}

/**
 * The reminder for one candidate, or null when it does not deserve one.
 *
 * The window is HALF-OPEN and forward-only: an item lands inside it when it publishes later than
 * now and no later than the lead. A post already past its time is the publisher's business, not a
 * reviewer's — warning somebody about a post that has gone is the failure this guards against.
 */
export function reviewPushFor(c: ReviewCandidate, now: Date, leadMin = REVIEW_LEAD_MIN): ReviewPush | null {
  const mins = (c.at.getTime() - now.getTime()) / 60_000;
  if (!(mins > 0 && mins <= leadMin)) return null;
  // RELATIVE, not a clock time: the server's clock is UTC on Vercel, so "publishes at 15:30" read
  // as the wrong hour on every phone outside it. "In 30 minutes" is true in every timezone, and the
  // cron's first minute inside the lead rounds up to the lead itself.
  return {
    id: c.id,
    dedupeKey: `review:${c.id}:${c.at.toISOString().slice(0, 16)}`,
    title: `${NAMES[c.platform] ?? c.platform} post publishes in ${Math.ceil(mins)} minutes`,
    body: `${snippet(c.body)} Tap to review it first.`,
  };
}
