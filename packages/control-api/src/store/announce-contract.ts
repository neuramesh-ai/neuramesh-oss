// Announcement and GitHub installation store contracts.
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
   *  the workspace whose member granted it, when the grant came through the app rather than the door.
   *  A workspace given wins over the one recorded, except with `keepWorkspace` (the owner proof's
   *  connect): then a recorded workspace stays, and only a record that names none takes the new one */
  upsertInstallation(input: { installationId: number; account: string; repos: string[]; selection?: 'all' | 'selected'; workspaceId?: string | null; keepWorkspace?: boolean }): Promise<void>;
  /** the installation that reads `owner/repo`: named in its list, or its account on an all-repositories grant.
   *  `unrecorded`: only a grant no workspace recorded (the public door's, or a read's repair) */
  installationForRepo(slug: string, opts?: { unrecorded?: boolean }): Promise<{ installationId: number } | null>;
  /** a row GitHub answers 404 for is dead: forgotten, so it never wins a lookup again */
  forgetInstallation(installationId: number): Promise<void>;
  /** the installations a member of this workspace granted through the app: what the pick lists (plan §7) */
  installationsForWorkspace(workspaceId: string): Promise<Installation[]>;
  /** the connector's repository for the room's project: the one the project's GitHub row names first
   *  while it is connected or waits for a new grant (a pick beside the primary is the one the reads
   *  use, and the reconnect words name it too), then the one with a GitHub address (a folder attached
   *  from a desktop is `local`, unreadable by the App), the primary among those, with the workspace
   *  the row belongs to. A revoked row names nothing. Null when the room has none. */
  repoForChannel(channelId: string, repoId?: string): Promise<PrimaryRepo | null>;
  /** the open GitHub cards in the rooms of this room's project, oldest first: what the grant resumes
   *  (github-resume.ts, docs/design/repo-connect-2026-10). A card is a row whose message holds the
   *  nmneed block, so an agent's own question with the same prefix never resumes. The card's message
   *  names its conversation, and a task card carries the reason of the task's last block. */
  openGitHubNeeds(channelId: string): Promise<GitHubNeed[]>;
}
export interface GitHubNeed { decisionId: string; channelId: string; taskId: string | null; threadId: string | null; blockReason: string | null }
/** what the memory twins read: the parent store's rows, lent by a closure */
export interface NeedWorld {
  decisions: Array<{ id: string; channel: string; taskId: string | null; messageId: string; question: string; status: string; createdAt: string }>;
  messages: Array<{ id: string; threadId?: string | null; body: string }>;
  channels: Array<{ id: string; workspace: string; projectId: string | null }>;
  connectors: Array<{ workspace: string; projectId: string | null; provider: string; handle: string; status: string }>;
  events: Array<{ type: string; target: string; workspace: string; payload: Record<string, unknown> }>;
  tasks: ReadonlyMap<string, { workspace: string; number: number }>;
}
/** the GitHub card's block, as the message carries it (shared needBlock) */
export const NEED_FENCE = '```nmneed';
export interface PrimaryRepo { workspaceId: string; projectId: string | null; repoId: string; orgName: string; name: string; cloneUrl: string | null; provider: string | null }
export interface Installation { installationId: number; account: string; repos: string[]; selection: 'all' | 'selected' }
/** a repository row the App could read: a GitHub provider or clone URL, or, with no clone URL, an org
 *  that is not the desktop's `local`. A clone URL alone is not enough: an uploaded bundle
 *  (`nm-bundle:<key>`, repo-bundles.ts) has one, and the App can never reach it. Its SQL twin is
 *  the order in PostgresAnnounceStore.repoForChannel. */
export const NOT_GITHUB_PROVIDERS: readonly string[] = ['local', 'bundle'];
export const hasGitHubAddress = (r: Pick<PrimaryRepo, 'orgName' | 'cloneUrl' | 'provider'>): boolean =>
  r.provider === 'github' || /github\.com[/:]/i.test(r.cloneUrl ?? '')
  || (!r.cloneUrl && r.orgName !== 'local' && !NOT_GITHUB_PROVIDERS.includes(r.provider ?? ''));

export const norm = (s: string): string => s.trim().toLowerCase();

// ── memory ─────────────────────────────────────────────────────────────────────────────────────
