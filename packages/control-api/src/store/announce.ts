// The announcements store (0139, the public door) AND the GitHub App's tables: a leaf of both
// stores on their ratchets' own terms. ONE interface, two implementations, and the Store carries
// it as a single property (`store.announcements`), so pgstore.ts and memory.ts each grow by one
// line. Bytes stay here (the release card) and never touch a replica: the row is public data plus
// an email. The GitHub connector (docs/design/github-connector-2026-09) reads its installation and
// the project's repository through the same leaf, for the same reason: the two store files are
// at their caps, and the App's tables already live here.
import type postgres from 'postgres';

export type AnnounceStatus = 'queued' | 'reading' | 'drafting' | 'ready' | 'failed';
export interface AnnouncePost { platform: 'x' | 'linkedin' | 'instagram' | 'tiktok'; body: string; imageBrief?: string }
export interface AnnouncementRow {
  id: string;
  repo: string;
  tag: string | null;
  website: string;
  email: string;
  status: AnnounceStatus;
  private: boolean;
  installationId: number | null;
  digest: unknown;
  brand: unknown;
  brief: string | null;
  posts: AnnouncePost[];
  imageMime: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  readyAt: string | null;
  claimedBy: string | null;
  claimedWorkspaceId: string | null;
  claimedThreadId: string | null;
}
export interface AnnounceCreate { repo: string; tag: string | null; website: string; email: string; private: boolean; installationId: number | null; ipHash: string | null }
export type AnnouncePatch = Partial<Pick<AnnouncementRow, 'status' | 'tag' | 'digest' | 'brand' | 'brief' | 'posts' | 'error' | 'startedAt' | 'readyAt'>>;

export interface AnnounceStore {
  /** null = the same (repo, tag, email) already exists: the caller serves that row instead */
  create(input: AnnounceCreate): Promise<{ id: string } | null>;
  find(input: { repo: string; tag: string; email: string }): Promise<AnnouncementRow | null>;
  get(id: string): Promise<AnnouncementRow | null>;
  /** queued → reading, oldest first: the cron's claim, so two ticks never draft one row twice */
  claimQueued(limit: number): Promise<AnnouncementRow[]>;
  update(id: string, patch: AnnouncePatch): Promise<void>;
  setImage(id: string, bytes: Uint8Array, mime: string): Promise<void>;
  image(id: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** the caps: how many rows this email, or this address, created since `sinceIso` */
  countSince(filter: { email?: string; ipHash?: string; sinceIso: string }): Promise<number>;
  claim(id: string, by: { userId: string; workspaceId: string; threadId: string }): Promise<void>;
  /** `selection: 'all'` = every repository of the account reads through it (0142); `workspaceId` names
   *  the workspace whose member granted it, when the grant came through the app rather than the door */
  upsertInstallation(input: { installationId: number; account: string; repos: string[]; selection?: 'all' | 'selected'; workspaceId?: string | null }): Promise<void>;
  /** the installation that reads `owner/repo`: named in its list, or its account on an all-repositories grant */
  installationForRepo(slug: string): Promise<{ installationId: number } | null>;
  /** a row GitHub answers 404 for is dead: forgotten, so it never wins a lookup again */
  forgetInstallation(installationId: number): Promise<void>;
  /** the installations a member of this workspace granted through the app: what the pick lists (plan §7) */
  installationsForWorkspace(workspaceId: string): Promise<Installation[]>;
  /** the connector's repository for the room's project: the one with a GitHub address first (a folder
   *  attached from a desktop is `local`, unreadable by the App), the primary among those, with the
   *  workspace the row belongs to. Null when the room has none. */
  repoForChannel(channelId: string): Promise<PrimaryRepo | null>;
}
export interface PrimaryRepo { workspaceId: string; projectId: string | null; repoId: string; orgName: string; name: string; cloneUrl: string | null; provider: string | null }
export interface Installation { installationId: number; account: string; repos: string[]; selection: 'all' | 'selected' }
/** a repository row the App could read: a clone URL, or an org that is not the desktop's `local` */
export const hasGitHubAddress = (r: Pick<PrimaryRepo, 'orgName' | 'cloneUrl' | 'provider'>): boolean => !!r.cloneUrl || (r.orgName !== 'local' && r.provider !== 'local');

const norm = (s: string): string => s.trim().toLowerCase();

// ── memory ─────────────────────────────────────────────────────────────────────────────────────
export class MemAnnounceStore implements AnnounceStore {
  rows: Array<AnnouncementRow & { ipHash: string | null; image?: { bytes: Uint8Array; mime: string } }> = [];
  installations: Array<{ installationId: number; account: string; repos: string[]; selection: 'all' | 'selected'; workspaceId: string | null }> = [];
  /** the memory world tracks no project_repos: a test seeds the room's repository here */
  repoLinks: Array<{ channelId: string } & PrimaryRepo> = [];
  seedRepo(link: { channelId: string } & PrimaryRepo): void { this.repoLinks.push(link); }
  /** the memory store's linkRepo lands here, once per room and repo */
  linkRoom(link: { channelId: string } & PrimaryRepo): void { if (!this.repoLinks.some((l) => l.channelId === link.channelId && l.repoId === link.repoId)) this.repoLinks.push(link); }
  async repoForChannel(channelId: string): Promise<PrimaryRepo | null> {
    const links = this.repoLinks.filter((r) => r.channelId === channelId);
    const hit = links.find(hasGitHubAddress) ?? links[0];
    return hit ? { workspaceId: hit.workspaceId, projectId: hit.projectId, repoId: hit.repoId, orgName: hit.orgName, name: hit.name, cloneUrl: hit.cloneUrl, provider: hit.provider } : null;
  }
  async create(input: AnnounceCreate): Promise<{ id: string } | null> {
    if (input.tag && this.rows.some((r) => r.repo === norm(input.repo) && r.tag === input.tag && r.email === norm(input.email))) return null;
    const id = crypto.randomUUID();
    this.rows.push({ id, repo: norm(input.repo), tag: input.tag, website: input.website, email: norm(input.email), status: 'queued', private: input.private, installationId: input.installationId, digest: null, brand: null, brief: null, posts: [], imageMime: null, error: null, createdAt: new Date().toISOString(), startedAt: null, readyAt: null, claimedBy: null, claimedWorkspaceId: null, claimedThreadId: null, ipHash: input.ipHash });
    return { id };
  }
  async find(input: { repo: string; tag: string; email: string }): Promise<AnnouncementRow | null> {
    return this.rows.find((r) => r.repo === norm(input.repo) && r.tag === input.tag && r.email === norm(input.email)) ?? null;
  }
  async get(id: string): Promise<AnnouncementRow | null> { return this.rows.find((r) => r.id === id) ?? null; }
  async claimQueued(limit: number): Promise<AnnouncementRow[]> {
    const due = this.rows.filter((r) => r.status === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit);
    for (const r of due) { r.status = 'reading'; r.startedAt = new Date().toISOString(); }
    return due;
  }
  async update(id: string, patch: AnnouncePatch): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
  }
  async setImage(id: string, bytes: Uint8Array, mime: string): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (r) { r.image = { bytes, mime }; r.imageMime = mime; }
  }
  async image(id: string): Promise<{ bytes: Uint8Array; mime: string } | null> { return this.rows.find((x) => x.id === id)?.image ?? null; }
  async countSince(filter: { email?: string; ipHash?: string; sinceIso: string }): Promise<number> {
    return this.rows.filter((r) => r.createdAt >= filter.sinceIso && (filter.email ? r.email === norm(filter.email) : true) && (filter.ipHash ? r.ipHash === filter.ipHash : true)).length;
  }
  async claim(id: string, by: { userId: string; workspaceId: string; threadId: string }): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (r) { r.claimedBy = by.userId; r.claimedWorkspaceId = by.workspaceId; r.claimedThreadId = by.threadId; }
  }
  async upsertInstallation(input: { installationId: number; account: string; repos: string[]; selection?: 'all' | 'selected'; workspaceId?: string | null }): Promise<void> {
    const repos = input.repos.map(norm);
    const hit = this.installations.find((i) => i.installationId === input.installationId);
    if (hit) { hit.account = input.account; hit.repos = repos; hit.selection = input.selection ?? hit.selection; if (input.workspaceId) hit.workspaceId = input.workspaceId; }
    else this.installations.push({ installationId: input.installationId, account: input.account, repos, selection: input.selection ?? 'selected', workspaceId: input.workspaceId ?? null });
  }
  async installationForRepo(slug: string): Promise<{ installationId: number } | null> {
    const s = norm(slug);
    const hit = this.installations.find((i) => i.repos.includes(s) || (i.selection === 'all' && norm(i.account) === s.split('/')[0]));
    return hit ? { installationId: hit.installationId } : null;
  }
  async forgetInstallation(installationId: number): Promise<void> { this.installations = this.installations.filter((i) => i.installationId !== installationId); }
  async installationsForWorkspace(workspaceId: string): Promise<Installation[]> {
    return this.installations.filter((i) => i.workspaceId === workspaceId).map(({ installationId, account, repos, selection }) => ({ installationId, account, repos, selection }));
  }
}

// ── postgres ───────────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const rowOf = (r: Row): AnnouncementRow => ({
  id: r['id'] as string, repo: r['repo'] as string, tag: (r['tag'] as string | null) ?? null, website: r['website'] as string, email: r['email'] as string,
  status: r['status'] as AnnounceStatus, private: !!r['private'], installationId: r['installation_id'] == null ? null : Number(r['installation_id']),
  digest: r['digest'] ?? null, brand: r['brand'] ?? null, brief: (r['brief'] as string | null) ?? null, posts: (r['posts'] as AnnouncePost[] | null) ?? [],
  imageMime: (r['image_mime'] as string | null) ?? null, error: (r['error'] as string | null) ?? null,
  createdAt: new Date(r['created_at'] as string).toISOString(), startedAt: r['started_at'] ? new Date(r['started_at'] as string).toISOString() : null,
  readyAt: r['ready_at'] ? new Date(r['ready_at'] as string).toISOString() : null,
  claimedBy: (r['claimed_by'] as string | null) ?? null, claimedWorkspaceId: (r['claimed_workspace_id'] as string | null) ?? null, claimedThreadId: (r['claimed_thread_id'] as string | null) ?? null,
});
const COLS = 'id, repo, tag, website, email, status, private, installation_id, digest, brand, brief, posts, image_mime, error, created_at, started_at, ready_at, claimed_by, claimed_workspace_id, claimed_thread_id';

export class PgAnnounceStore implements AnnounceStore {
  constructor(private readonly sql: postgres.Sql) {}
  async create(input: AnnounceCreate): Promise<{ id: string } | null> {
    const [row] = await this.sql`insert into announcements (repo, tag, website, email, private, installation_id, ip_hash)
      values (${norm(input.repo)}, ${input.tag}, ${input.website}, ${norm(input.email)}, ${input.private}, ${input.installationId}, ${input.ipHash})
      on conflict do nothing returning id`;
    return row ? { id: row['id'] as string } : null;
  }
  async find(input: { repo: string; tag: string; email: string }): Promise<AnnouncementRow | null> {
    const [row] = await this.sql.unsafe(`select ${COLS} from announcements where repo = $1 and tag = $2 and email = $3 limit 1`, [norm(input.repo), input.tag, norm(input.email)]);
    return row ? rowOf(row as Row) : null;
  }
  async get(id: string): Promise<AnnouncementRow | null> {
    const [row] = await this.sql.unsafe(`select ${COLS} from announcements where id = $1::uuid`, [id]);
    return row ? rowOf(row as Row) : null;
  }
  async claimQueued(limit: number): Promise<AnnouncementRow[]> {
    const rows = await this.sql.unsafe(`update announcements set status = 'reading', started_at = now()
      where id in (select id from announcements where status = 'queued' order by created_at limit $1 for update skip locked)
      returning ${COLS}`, [limit]);
    return rows.map((r) => rowOf(r as Row));
  }
  async update(id: string, patch: AnnouncePatch): Promise<void> {
    const sql = this.sql;
    const sets: Array<ReturnType<typeof sql>> = [];
    if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
    if (patch.tag !== undefined) sets.push(sql`tag = ${patch.tag}`);
    if (patch.digest !== undefined) sets.push(sql`digest = ${sql.json(patch.digest as never)}`);
    if (patch.brand !== undefined) sets.push(sql`brand = ${sql.json(patch.brand as never)}`);
    if (patch.brief !== undefined) sets.push(sql`brief = ${patch.brief}`);
    if (patch.posts !== undefined) sets.push(sql`posts = ${sql.json(patch.posts as never)}`);
    if (patch.error !== undefined) sets.push(sql`error = ${patch.error}`);
    if (patch.startedAt !== undefined) sets.push(sql`started_at = ${patch.startedAt}`);
    if (patch.readyAt !== undefined) sets.push(sql`ready_at = ${patch.readyAt}`);
    if (!sets.length) return;
    const joined = sets.reduce((acc, s, i) => (i === 0 ? s : sql`${acc}, ${s}`));
    await sql`update announcements set ${joined} where id = ${id}::uuid`;
  }
  async setImage(id: string, bytes: Uint8Array, mime: string): Promise<void> {
    await this.sql`update announcements set image = ${Buffer.from(bytes)}, image_mime = ${mime} where id = ${id}::uuid`;
  }
  async image(id: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
    const [row] = await this.sql`select image, image_mime from announcements where id = ${id}::uuid and image is not null`;
    return row ? { bytes: new Uint8Array(row['image'] as Buffer), mime: (row['image_mime'] as string) || 'image/png' } : null;
  }
  async countSince(filter: { email?: string; ipHash?: string; sinceIso: string }): Promise<number> {
    const [row] = await this.sql`select count(*)::int as n from announcements where created_at >= ${filter.sinceIso}::timestamptz
      and (${filter.email ? norm(filter.email) : null}::text is null or email = ${filter.email ? norm(filter.email) : null})
      and (${filter.ipHash ?? null}::text is null or ip_hash = ${filter.ipHash ?? null})`;
    return Number(row?.['n'] ?? 0);
  }
  async claim(id: string, by: { userId: string; workspaceId: string; threadId: string }): Promise<void> {
    await this.sql`update announcements set claimed_by = ${by.userId}::uuid, claimed_workspace_id = ${by.workspaceId}::uuid, claimed_thread_id = ${by.threadId}::uuid, claimed_at = now() where id = ${id}::uuid`;
  }
  async upsertInstallation(input: { installationId: number; account: string; repos: string[]; selection?: 'all' | 'selected'; workspaceId?: string | null }): Promise<void> {
    // a workspace named once is never forgotten by a later door callback that names none
    await this.sql`insert into github_installations (installation_id, account, repos, selection, workspace_id)
      values (${input.installationId}, ${input.account}, ${input.repos.map(norm)}, ${input.selection ?? 'selected'}, ${input.workspaceId ?? null})
      on conflict (installation_id) do update set account = excluded.account, repos = excluded.repos, selection = excluded.selection,
        workspace_id = coalesce(excluded.workspace_id, github_installations.workspace_id), updated_at = now()`;
  }
  async installationForRepo(slug: string): Promise<{ installationId: number } | null> {
    const s = norm(slug);
    const [row] = await this.sql`select installation_id from github_installations
      where ${s} = any(repos) or (selection = 'all' and lower(account) = ${s.split('/')[0] ?? ''})
      order by updated_at desc limit 1`;
    return row ? { installationId: Number(row['installation_id']) } : null;
  }
  async forgetInstallation(installationId: number): Promise<void> {
    await this.sql`delete from github_installations where installation_id = ${installationId}`;
  }
  async installationsForWorkspace(workspaceId: string): Promise<Installation[]> {
    const rows = await this.sql`select installation_id, account, repos, selection from github_installations where workspace_id = ${workspaceId}::uuid order by updated_at desc`;
    return rows.map((r) => ({ installationId: Number(r['installation_id']), account: r['account'] as string, repos: (r['repos'] as string[] | null) ?? [], selection: r['selection'] === 'all' ? 'all' as const : 'selected' as const }));
  }
  async repoForChannel(channelId: string): Promise<PrimaryRepo | null> {
    const [row] = await this.sql`select c.workspace_id, c.project_id, r.id as repo_id, r.org_name, r.name, r.clone_url, r.provider
      from channels c join project_repos pr on pr.project_id = c.project_id join repos r on r.id = pr.repo_id
      where c.id = ${channelId}::uuid
      order by (r.clone_url is not null or (r.org_name <> 'local' and r.provider <> 'local')) desc, pr.is_primary desc, r.org_name, r.name limit 1`;
    return row ? { workspaceId: row['workspace_id'] as string, projectId: (row['project_id'] as string | null) ?? null, repoId: row['repo_id'] as string, orgName: row['org_name'] as string, name: row['name'] as string, cloneUrl: (row['clone_url'] as string | null) || null, provider: (row['provider'] as string | null) ?? null } : null;
  }
}
