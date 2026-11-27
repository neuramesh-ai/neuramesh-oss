// A POST'S POSTIZ ROUTE (docs/design/postiz-connector-2026-11, P4 to P8): the rows the hosted Postiz lane reads
// and writes on content_items (0208), and each project's Postiz connector rows. A leaf of both stores, kept out
// of pgstore.ts and memory.ts on their ratchets' own terms. The public build never sets a route, because the
// Postiz commands and the tick are hosted only (src/private.ts), so these reads find nothing there.
import type postgres from 'postgres';
import { DomainError } from '../errors';

/** a content item as the Postiz lane needs it */
export interface PostizItem {
  id: string; workspace: string; channel: string; status: string; platform: string; body: string;
  scheduledAt: string | null;
  mediaId: string | null; mediaKind: 'image' | 'video' | null; mediaUrl: string | null;
  /** a picture or a film was meant and is not there yet (the publish pass's hold, content-reads.ts) */
  imageIntended: boolean;
  postizChannel: string | null; postizPostId: string | null; postizSettings: Record<string, unknown> | null;
}

export interface ConnectorRow { id: string; projectId: string | null; status: string; handle: string; ciphertext: string | null }

export interface PostizContentStore {
  /** every project's connector row for one provider in a workspace, with its secret */
  connectors(workspace: string, provider: string): Promise<ConnectorRow[]>;
  item(itemId: string): Promise<PostizItem | null>;
  /** the person's pick (P5). A draft only: a scheduled post keeps the route it was approved with */
  setRoute(itemId: string, channel: string | null, settings: Record<string, unknown> | null): Promise<void>;
  setPostId(itemId: string, postId: string | null): Promise<void>;
  /** the scheduled posts that Postiz holds, oldest time first */
  inFlight(limit: number): Promise<PostizItem[]>;
  /** a person changed the time in Postiz */
  moveTime(itemId: string, iso: string): Promise<void>;
  /** the post left Postiz's queue: the item is a draft again, with the reason */
  backToDraft(itemId: string, note: string): Promise<void>;
}

type Media = { image_url?: string; image_id?: string; video_id?: string; video_pending?: boolean; script?: string; brief?: string; thumb?: string; image_error?: string } | null;

function itemOf(r: Record<string, unknown>): PostizItem {
  const m = r['media'] as Media;
  // the same reading as dueContentItemsSql: a film means its film in flight, a picture its brief or preview
  const video = !!(m && (m.script || m.video_id || m.video_pending));
  return {
    id: r['id'] as string, workspace: r['workspace_id'] as string, channel: r['channel_id'] as string,
    status: r['status'] as string, platform: r['platform'] as string, body: r['body'] as string,
    scheduledAt: r['scheduled_at'] ? new Date(r['scheduled_at'] as string).toISOString() : null,
    mediaId: m?.video_id ?? m?.image_id ?? null, mediaKind: m?.video_id ? 'video' : m?.image_id ? 'image' : null, mediaUrl: m?.image_url ?? null,
    imageIntended: video ? !!m?.video_pending && !m?.video_id : !!(m && (m.brief || m.thumb || m.image_error)),
    postizChannel: (r['postiz_channel'] as string | null) ?? null, postizPostId: (r['postiz_post_id'] as string | null) ?? null,
    postizSettings: (r['postiz_settings'] as Record<string, unknown> | null) ?? null,
  };
}

export class PgPostizContent implements PostizContentStore {
  constructor(private readonly sql: postgres.Sql) {}
  async connectors(workspace: string, provider: string): Promise<ConnectorRow[]> {
    const rows = await this.sql`select c.id, c.project_id, c.status, c.handle, s.ciphertext from connectors c
      left join connector_secrets s on s.connector_id = c.id
      where c.workspace_id = ${workspace}::uuid and c.provider = ${provider}
      order by c.created_at`;
    return rows.map((row) => ({ id: row['id'] as string, projectId: (row['project_id'] as string | null) ?? null, status: row['status'] as string, handle: (row['handle'] as string) ?? '', ciphertext: (row['ciphertext'] as string | null) ?? null }));
  }
  async item(itemId: string): Promise<PostizItem | null> {
    const [r] = await this.sql`select id, workspace_id, channel_id, status, platform, body, scheduled_at, media, postiz_channel, postiz_post_id, postiz_settings
      from content_items where id = ${itemId}::uuid`;
    return r ? itemOf(r) : null;
  }
  async setRoute(itemId: string, channel: string | null, settings: Record<string, unknown> | null): Promise<void> {
    const [r] = await this.sql`update content_items set postiz_channel = ${channel}, postiz_settings = ${settings ? this.sql.json(settings as never) : null}
      where id = ${itemId}::uuid and status = 'draft' returning id`;
    if (!r) throw new DomainError('CONFLICT', 'Pick the route while the post is a draft. Unschedule it first.');
  }
  async setPostId(itemId: string, postId: string | null): Promise<void> {
    await this.sql`update content_items set postiz_post_id = ${postId} where id = ${itemId}::uuid`;
  }
  async inFlight(limit: number): Promise<PostizItem[]> {
    const rows = await this.sql`select id, workspace_id, channel_id, status, platform, body, scheduled_at, media, postiz_channel, postiz_post_id, postiz_settings
      from content_items where status = 'scheduled' and postiz_post_id is not null order by scheduled_at limit ${limit}`;
    return rows.map(itemOf);
  }
  async moveTime(itemId: string, iso: string): Promise<void> {
    await this.sql`update content_items set scheduled_at = ${iso} where id = ${itemId}::uuid and status = 'scheduled'`;
  }
  async backToDraft(itemId: string, note: string): Promise<void> {
    await this.sql`update content_items set status = 'draft', scheduled_at = null, approved_by = null, approved_at = null, postiz_post_id = null, last_error = ${note.slice(0, 500)}
      where id = ${itemId}::uuid and status in ('scheduled', 'failed')`;
  }
}

/** the in-memory twin. The routes live beside the rows, keyed by item id */
type MemItem = { id: string; workspace: string; channelId: string; platform: string; body: string; status: string; scheduledAt: string | null; approvedBy: string | null; mediaUrl: string | null; mediaId?: string | null; brief?: string | null; script?: string | null; videoPending?: boolean; lastError?: string | null };
type MemConnector = { id: string; workspace: string; projectId: string | null; provider: string; handle: string; status: string };

export class MemPostizContent implements PostizContentStore {
  private readonly routes = new Map<string, { channel: string | null; postId: string | null; settings: Record<string, unknown> | null }>();
  constructor(private readonly rows: () => { items: MemItem[]; connectors: MemConnector[]; secrets: Map<string, string>; mime: (mediaId: string) => string }) {}
  /** dueContentItems leaves a post with a Postiz route to Postiz */
  routed(itemId: string): boolean { return !!this.routes.get(itemId)?.channel; }
  async connectors(workspace: string, provider: string): Promise<ConnectorRow[]> {
    const { connectors, secrets } = this.rows();
    return connectors.filter((c) => c.workspace === workspace && c.provider === provider)
      .map((c) => ({ id: c.id, projectId: c.projectId, status: c.status, handle: c.handle, ciphertext: secrets.get(c.id) ?? null }));
  }
  async item(itemId: string): Promise<PostizItem | null> {
    const { items, mime } = this.rows();
    const i = items.find((x) => x.id === itemId);
    if (!i) return null;
    const r = this.routes.get(itemId);
    const mediaKind = i.mediaId ? (mime(i.mediaId).startsWith('video/') ? 'video' : 'image') : null;
    return {
      id: i.id, workspace: i.workspace, channel: i.channelId, status: i.status, platform: i.platform, body: i.body, scheduledAt: i.scheduledAt,
      mediaId: i.mediaId ?? null, mediaKind, mediaUrl: i.mediaUrl, imageIntended: i.script || i.videoPending ? !!i.videoPending && !i.mediaId : !!i.brief,
      postizChannel: r?.channel ?? null, postizPostId: r?.postId ?? null, postizSettings: r?.settings ?? null,
    };
  }
  async setRoute(itemId: string, channel: string | null, settings: Record<string, unknown> | null): Promise<void> {
    if (this.rows().items.find((x) => x.id === itemId)?.status !== 'draft') throw new DomainError('CONFLICT', 'Pick the route while the post is a draft. Unschedule it first.');
    this.routes.set(itemId, { channel, settings, postId: this.routes.get(itemId)?.postId ?? null });
  }
  async setPostId(itemId: string, postId: string | null): Promise<void> {
    const r = this.routes.get(itemId) ?? { channel: null, settings: null, postId: null };
    this.routes.set(itemId, { ...r, postId });
  }
  async inFlight(limit: number): Promise<PostizItem[]> {
    const ids = this.rows().items.filter((i) => i.status === 'scheduled' && this.routes.get(i.id)?.postId)
      .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '')).slice(0, limit).map((i) => i.id);
    return (await Promise.all(ids.map((id) => this.item(id)))).filter((x): x is PostizItem => !!x);
  }
  async moveTime(itemId: string, iso: string): Promise<void> {
    const i = this.rows().items.find((x) => x.id === itemId && x.status === 'scheduled');
    if (i) i.scheduledAt = iso;
  }
  async backToDraft(itemId: string, note: string): Promise<void> {
    const i = this.rows().items.find((x) => x.id === itemId && (x.status === 'scheduled' || x.status === 'failed'));
    if (!i) return;
    Object.assign(i, { status: 'draft', scheduledAt: null, approvedBy: null, lastError: note });
    await this.setPostId(itemId, null);
  }
}
