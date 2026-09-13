// Replies (docs/31) — the Slack-shaped footer under a message that started a thread.
//
// A room message can be the ROOT of a thread: the message stays in the feed and grows a
// "3 replies · last 4m ago" line that opens the thread. The root is REFERENCED
// (threads.root_message_id), never moved into the thread — moving it would take it out of the
// feed, which is the opposite of what the affordance promises.
//
// Pure so the counting + phrasing are testable without a renderer.

export interface ReplySummary {
  /** replies in the thread (messages carrying its thread_id) — the root is not one of them */
  count: number;
  /** ISO time of the most recent reply, or null when there are none */
  lastAt: string | null;
  /** replies newer than the reader's last read of this room */
  unread: number;
}

/** "3 replies · last 4m ago" · "1 reply · last 1m ago" · "2 new · 3 replies" when unread */
export function replyFooter(s: ReplySummary, now = Date.now()): string {
  if (s.count <= 0) return '';
  const plural = `${s.count} ${s.count === 1 ? 'reply' : 'replies'}`;
  const when = s.lastAt ? `last ${shortAgo(s.lastAt, now)}` : '';
  // unread leads, because that is the reason to look; the total still shows, so the line never
  // loses the thread's size
  if (s.unread > 0) return `${s.unread} new · ${plural}`;
  return when ? `${plural} · ${when}` : plural;
}

/** compact relative time for a one-line footer: 12s · 4m · 3h · 2d · Jul 12 */
export function shortAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 45) return `${Math.max(1, secs)}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days <= 6) return `${days}d ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Summarize one root message's thread from the raw reply rows.
 * `lastReadAt` is the reader's last read of the ROOM (the existing per-channel mark) — replies
 * after it are new. A reader's own replies never count as unread.
 */
export function summarizeReplies(
  rows: ReadonlyArray<{ createdAt: string; authorKind: string; authorId: string }>,
  opts: { lastReadAt?: string | null; selfId?: string | null } = {},
): ReplySummary {
  if (!rows.length) return { count: 0, lastAt: null, unread: 0 };
  let lastAt = rows[0]!.createdAt;
  let unread = 0;
  const read = opts.lastReadAt ? Date.parse(opts.lastReadAt) : NaN;
  for (const r of rows) {
    if (r.createdAt > lastAt) lastAt = r.createdAt;
    const mine = opts.selfId && r.authorKind === 'human' && r.authorId === opts.selfId;
    if (!mine && Number.isFinite(read) && Date.parse(r.createdAt) > read) unread += 1;
  }
  return { count: rows.length, lastAt, unread };
}

/** the quoted preview inside the composer's reply pill — one line, never a wall */
export function replyPreview(body: string, max = 90): string {
  const flat = body
    .replace(/```[\s\S]*?```/g, ' ')          // fenced transport blocks are not a preview
    .replace(/‹[^›]*›/g, ' ')                 // internal markers (skill/revised/gen-image)
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
