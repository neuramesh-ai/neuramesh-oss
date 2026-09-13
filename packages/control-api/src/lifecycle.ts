// The lifecycle pass: decide who is due an onboarding email, render it, hand it to the outbox.
// Driven by the /internal/emails-due cron (docs/27 §3).
//
// The DECISION is a pure function (`dueFor`) over a plain row, so the suppression rules —
// opt-out, bounce, milestone-already-reached, 48h spacing — are unit-testable without a
// database or a network. The QUERY that produces those rows is the store's; the SEND is
// mail.ts. Nothing here decides copy.
import { renderDay1, renderDay3, renderDay7, renderMarketing } from '@neuramesh/shared';
import { APP_URL, unsubscribeUrl } from './mail';
import { queueAndSend } from './onauth';
import type { Store } from './store';

/** One candidate, as the selector query produces it. */
export interface LifecycleRow {
  userId: string;
  email: string | null;
  workspaceId: string | null;
  plan: string;
  /** Hours since the activation clock started (nm_users.onboarding_at). */
  ageHours: number;
  unsubscribed: boolean;
  bounced: boolean;
  /** Hours since this user's most recent lifecycle email; null if they've had none. */
  sinceLastHours: number | null;
  /** Milestones — each one suppresses the nudge that exists to produce it. */
  startedTask: boolean;
  hasMarketingRoom: boolean;
  seatsUsed: number;
  /** day3 only: the newest mined lesson and its context. No lesson, no day3. */
  lesson: { text: string; taskNumber: number | null; channel: string; reviewer: string; worker: string } | null;
  statAccepted: number;
  statReviews: number;
  statLessons: number;
  /** marketing only: something they shipped, for the callback opener. */
  shippedThing: string | null;
}

export type LifecycleTemplate = 'day1' | 'day3' | 'marketing' | 'day7';

const HOUR = 1;
const DAY = 24 * HOUR;
/** At most one lifecycle email per user per 48h, enforced here rather than in the copy. */
const MIN_SPACING_HOURS = 48;

/**
 * Which lifecycle email, if any, is this row due? Pure. Returns null far more often than not.
 *
 * Ordering matters: the list is checked newest-stage-first so a user who has been idle for
 * ten days gets day7 (the last thing they should hear) rather than replaying day1.
 */
export function dueFor(row: LifecycleRow): LifecycleTemplate | null {
  if (!row.email) return null;
  if (row.unsubscribed || row.bounced) return null;                       // suppression, in the selector
  if (row.sinceLastHours !== null && row.sinceLastHours < MIN_SPACING_HOURS) return null;

  // day7 — free plans only. An upgrade mid-flight cancels it.
  if (row.ageHours >= 7 * DAY && row.plan !== 'cloud') return 'day7';

  // marketing — the second trade. Behaviour-triggered elsewhere (on a kind-flip); this is the
  // day-5 fallback for people who never found it. Suppressed once they have a marketing room.
  if (row.ageHours >= 5 * DAY && !row.hasMarketingRoom) return 'marketing';

  // day3 — only ever sends with a real lesson to quote. No lesson, no email: the whole point
  // is showing the reader their own reviewer's words.
  if (row.ageHours >= 3 * DAY && row.lesson) return 'day3';

  // day1 — for the un-activated only. Any task past todo suppresses it.
  if (row.ageHours >= 1 * DAY && row.ageHours < 3 * DAY && !row.startedTask) return 'day1';

  return null;
}

/** Render the chosen template for a row. Kept beside `dueFor` so adding a stage touches one file. */
export function renderLifecycle(template: LifecycleTemplate, row: LifecycleRow): { subject: string; preheader: string; html: string; text: string } | null {
  const unsub = unsubscribeUrl(row.userId);
  switch (template) {
    case 'day1':
      return renderDay1({ openUrl: `${APP_URL}/downloads`, unsubscribeUrl: unsub });
    case 'day3': {
      if (!row.lesson) return null; // belt and braces: dueFor already required it
      return renderDay3({
        lesson: row.lesson.text, taskNumber: row.lesson.taskNumber, channel: row.lesson.channel,
        reviewer: row.lesson.reviewer, worker: row.lesson.worker,
        statAccepted: row.statAccepted, statReviews: row.statReviews, statLessons: row.statLessons,
        window: 'your first week', openUrl: `${APP_URL}/downloads`, unsubscribeUrl: unsub,
      });
    }
    case 'marketing':
      return renderMarketing({
        shippedThing: row.shippedThing, worker: 'patch', reviewer: 'scout',
        openUrl: `${APP_URL}/downloads`, unsubscribeUrl: unsub,
      });
    case 'day7':
      return renderDay7({
        seatsUsed: row.seatsUsed, seatCap: 3,
        billingUrl: `${APP_URL}/billing`, downloadUrl: `${APP_URL}/downloads`, unsubscribeUrl: unsub,
      });
  }
}

/**
 * The cron body: candidates → due? → render → outbox → send. One user failing never stops the
 * batch, and the outbox's UNIQUE dedupe_key means a double-fired cron is a no-op rather than a
 * double-send.
 */
export async function runLifecyclePass(store: Store, limit = 50): Promise<{ sent: number; skipped: number; failed: number }> {
  const out = { sent: 0, skipped: 0, failed: 0 };
  const rows = await store.lifecycleCandidates(limit);
  for (const row of rows) {
    try {
      const template = dueFor(row);
      if (!template) { out.skipped += 1; continue; }
      const rendered = renderLifecycle(template, row);
      if (!rendered) { out.skipped += 1; continue; }
      const status = await queueAndSend(store, {
        workspace: row.workspaceId, userId: row.userId, toEmail: row.email!,
        template, kind: 'lifecycle', dedupeKey: `${template}:${row.userId}`,
      }, rendered, unsubscribeUrl(row.userId));
      if (status === 'sent') out.sent += 1;
      else if (status === 'failed') out.failed += 1;
      else out.skipped += 1;
    } catch (e) {
      out.failed += 1;
      console.error(`lifecycle_row_failed user=${row.userId}:`, e instanceof Error ? e.message : e);
    }
  }
  if (out.sent || out.failed) console.log(`lifecycle_pass sent=${out.sent} skipped=${out.skipped} failed=${out.failed}`);
  return out;
}
