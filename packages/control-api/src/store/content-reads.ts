// THE TWO READS OVER SCHEDULED CONTENT: what is due to publish, and what is about to.
//
// Deliberately not `dueContentItems`, which asks "past due, publish it". This asks "coming, tell
// somebody", and the difference is the whole point: the window is half-open and FORWARD-ONLY, so a
// post already past its time belongs to the publisher. Reminding a person about a post that has
// gone is the exact failure the feature guards against.
//
// A leaf of PostgresStore, kept out of pgstore.ts on its ratchet's own terms.
import type postgres from 'postgres';

export interface UpcomingItem {
  id: string; workspace: string; channel: string; threadId: string | null;
  platform: string; body: string; scheduledAt: string;
}

export async function upcomingContentItemsSql(sql: postgres.Sql, fromIso: string, toIso: string, limit: number): Promise<UpcomingItem[]> {
  const rows = await sql`select id, workspace_id, channel_id, thread_id, platform, body, scheduled_at from content_items
    where status = 'scheduled' and scheduled_at is not null and scheduled_at > ${fromIso} and scheduled_at <= ${toIso}
    order by scheduled_at limit ${limit}`;
  return rows.map((r) => ({
    id: r['id'] as string,
    workspace: r['workspace_id'] as string,
    channel: r['channel_id'] as string,
    threadId: (r['thread_id'] as string | null) ?? null,
    platform: r['platform'] as string,
    body: r['body'] as string,
    scheduledAt: new Date(r['scheduled_at'] as string).toISOString(),
  }));
}

export interface DueItem {
  id: string; workspace: string; channel: string; platform: string; body: string;
  mediaUrl?: string | null; mediaId?: string | null;
  /** the hosted media's kind: a film takes the one slot a picture would (the video rung) */
  mediaKind?: 'image' | 'video' | null;
  /** media was MEANT and is not on the row yet: the publish pass holds rather than sends text-only */
  imageIntended: boolean;
}

/** past due, publish it. `channel_id` rides along because it is what names the item's PROJECT, and
 *  the project decides which connected account posts it (0106). content_items.channel_id is NOT
 *  NULL, so this is always resolvable. */
export async function dueContentItemsSql(sql: postgres.Sql, nowIso: string, limit: number): Promise<DueItem[]> {
  const rows = await sql`select id, workspace_id, channel_id, platform, body, media from content_items
    where status = 'scheduled' and scheduled_at is not null and scheduled_at <= ${nowIso}
    order by scheduled_at limit ${limit}`;
  return rows.map((r) => {
    const m = r['media'] as { image_url?: string; image_id?: string; video_id?: string; video_pending?: boolean; script?: string; brief?: string; thumb?: string; image_error?: string } | null;
    // an image was MEANT (a brief was written, a preview rendered, or generation errored) — the
    // publish pass holds such a post rather than send it text-only if no publishable copy is on it.
    // A VIDEO post (the video rung) means its film: its brief is the shot direction, never a
    // picture, so the hold is the film in flight (video_pending) and nothing else. A video post with
    // no film and none in flight posts its caption, which the preview said before the approve.
    const video = !!(m && (m.script || m.video_id || m.video_pending));
    const imageIntended = video ? !!m?.video_pending && !m?.video_id : !!(m && (m.brief || m.thumb || m.image_error));
    return {
      id: r['id'] as string, workspace: r['workspace_id'] as string, channel: r['channel_id'] as string,
      platform: r['platform'] as string, body: r['body'] as string,
      mediaUrl: m?.image_url ?? null, mediaId: m?.video_id ?? m?.image_id ?? null, mediaKind: m?.video_id ? 'video' : m?.image_id ? 'image' : null, imageIntended,
    };
  });
}
