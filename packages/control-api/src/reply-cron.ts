// The reply queue's minute pass (docs/design/models-and-replies-2026-10/plan.md §2), riding
// /internal/publish-due like the review reminder, so there is no second cron to add or forget.
//   1. a routine whose Replies part names a gap: its run's reply card is queued here, server-side, for
//      the routine's owner. Queueing posts nothing, and the owner armed the gap on the draft card.
//   2. a queued row whose time has come: one push to its member, then the row is due and never sent again.
// One bad row never stops the rest, and a failed push never fails the cron (the publish pass shares it).
import { isReplyGap, parseReplies, reminderWords } from '@neuramesh/shared';
import { queueRows } from './handler/replies';
import type { PushService } from './push';
import type { Store } from './store';

/** how far back the pass looks for a routine card with no queue: the cron may skip a tick or two */
const LOOKBACK_MS = 60 * 60_000;

export async function queueRoutineReplies(store: Store, now: Date): Promise<number> {
  if (!store.replies) return 0;
  const cards = await store.replies.pendingRoutineCards(new Date(now.getTime() - LOOKBACK_MS).toISOString(), 20);
  let queued = 0;
  for (const c of cards) {
    try {
      const data = parseReplies(c.body);
      if (!data || !isReplyGap(c.gap)) continue;
      // the first reply goes out when the card lands, or now if the cron caught it late
      const rows = queueRows(data.items, Math.max(now.getTime(), Date.parse(c.createdAt)), c.gap);
      queued += await store.replies.queue({ workspaceId: c.workspaceId, threadId: c.threadId, messageId: c.messageId, memberId: c.memberId, rows });
    } catch (e) {
      console.error('routine reply queue failed:', c.messageId, e);
    }
  }
  return queued;
}

export async function remindDueReplies(store: Store, push: PushService | undefined, now: Date): Promise<number> {
  if (!store.replies) return 0;
  const at = now.toISOString();
  const rows = await store.replies.due(at, 50);
  for (const r of rows) {
    try {
      if (push) await push.notifyReplyDue({ ...r, words: reminderWords({ letter: r.letter, handle: r.handle, open_url: r.openUrl }) });
    } catch (e) {
      console.error('reply reminder failed:', r.id, e);
    }
    // due either way: the web reminds from the row itself, and a dead push must not repeat each minute
    await store.replies.markNotified(r.id, at).catch(() => undefined);
  }
  return rows.length;
}
