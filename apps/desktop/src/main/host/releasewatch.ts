// The release routine's tick branch (docs/design/release-drafts-2026-09 §5.1). A schedule whose
// payload carries `release` watches a repository: the tick reads it through the room's GitHub
// connector when the project holds one (docs/design/github-connector-2026-09: the App reads
// server-side, which is what lets a cloud machine with no login run the watch), else with the
// MACHINE's own gh; hands the rows to the pure scan, opens ONE session with the digest when there
// is something to read, and moves the cursor only after the scan completed. A quiet window opens
// nothing and leaves one ledger line. Path selection and the preflight run BEFORE the claim (the
// schedules.ts rule: the claim consumes the slot); the fire runs after it.
import {
  isNoisePr, releaseDigest, releaseLogNote, releaseMarker, releaseTitle, scanWindow,
  type ReleasePayload, type ScanPr, type ScanRelease, type ScanTag,
} from '@neuramesh/shared';
import { ghCapable, ghRaw, repoSlugFor } from './gh';

export interface RepoSignals { releases: ScanRelease[]; prs: ScanPr[]; tags: ScanTag[] }
type ReplicaDb = { getAll<T>(sql: string, params?: unknown[]): Promise<T[]> };
type Post = (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => Promise<Response>;
interface RepoRow { id: string; org_name: string; name: string; clone_url: string | null; local_path: string | null; provider: string | null }
export interface SlotRow { id: string; workspace_id: string; channel_id: string; title: string; at_time: string; tz?: string | null }
export type Preflight = { ok: true; slug: string; repo: RepoRow; door: 'connector' | 'gh' } | { ok: false; reason: string };

const day = (iso: string): string => iso.slice(0, 10);

/** The read, through gh: releases, merged pull requests since the cursor's day, and tags when the
 *  repository publishes no releases. NM_GH_FAKE=1 answers from NM_GH_FAKE_RELEASES (JSON) or one
 *  canned release, so the echo lane proves the whole fire without GitHub. */
export async function readRepoSignals(slug: string, since: string): Promise<RepoSignals> {
  if (process.env['NM_GH_FAKE'] === '1') {
    const raw = process.env['NM_GH_FAKE_RELEASES'];
    if (raw) return JSON.parse(raw) as RepoSignals;
    return { releases: [{ tag: 'v0.1.0', name: 'v0.1.0: the shared inbox', body: 'A shared inbox for support replies.', publishedAt: new Date().toISOString(), url: `https://github.com/${slug}/releases/tag/v0.1.0` }], prs: [], tags: [] };
  }
  const rel = await ghRaw(['api', `repos/${slug}/releases?per_page=15`]);
  if (!rel.ok) throw new Error(`gh could not read ${slug}: ${rel.stderr.split('\n')[0] || `exit ${rel.code}`}`);
  const releases = (JSON.parse(rel.stdout || '[]') as Array<{ tag_name: string; name: string | null; body: string | null; published_at: string | null; html_url: string; draft: boolean; prerelease: boolean }>)
    .filter((r) => r.published_at)
    .map((r) => ({ tag: r.tag_name, name: r.name, body: r.body, publishedAt: r.published_at!, url: r.html_url, draft: r.draft, prerelease: r.prerelease }));
  const prRes = await ghRaw(['pr', 'list', '-R', slug, '--state', 'merged', '--search', `merged:>=${day(since)}`, '--limit', '100', '--json', 'number,title,body,labels,mergedAt,url,author']);
  const prs = prRes.ok
    ? (JSON.parse(prRes.stdout || '[]') as Array<{ number: number; title: string; body: string | null; labels: Array<{ name: string }>; mergedAt: string; url: string; author: { login?: string } | null }>)
      .map((p) => ({ number: p.number, title: p.title, body: p.body, labels: (p.labels ?? []).map((l) => l.name), mergedAt: p.mergedAt, url: p.url, author: p.author?.login ?? null }))
    : [];
  const tags: ScanTag[] = [];
  if (!releases.length) {
    const tg = await ghRaw(['api', `repos/${slug}/tags?per_page=5`]);
    const rows = tg.ok ? (JSON.parse(tg.stdout || '[]') as Array<{ name: string; commit: { sha: string } }>) : [];
    for (const t of rows) {
      const c = await ghRaw(['api', `repos/${slug}/commits/${t.commit.sha}`, '--jq', '.commit.committer.date']);
      tags.push({ name: t.name, date: c.ok ? c.stdout.trim() : null, url: `https://github.com/${slug}/releases/tag/${t.name}` });
    }
  }
  return { releases, prs, tags };
}

export function makeReleaseWatch(ctx: {
  db: ReplicaDb;
  ownerActorId: string;
  post: Post;
  read?: (slug: string, since: string) => Promise<RepoSignals>;
  capable?: () => Promise<boolean>;
  /** the connector door: is the room's project's GitHub row live, and the read through it (host/reporead.ts) */
  connected?: (channelId: string) => Promise<boolean>;
  readViaConnector?: (channelId: string, since: string) => Promise<RepoSignals | null>;
  now?: () => Date;
  threadId?: () => string;
}) {
  const read = ctx.read ?? readRepoSignals;
  const capable = ctx.capable ?? ghCapable;
  const connected = ctx.connected ?? (async () => false);
  const now = ctx.now ?? (() => new Date());
  const mintThread = ctx.threadId ?? (() => crypto.randomUUID());
  const owner = { kind: 'human', id: ctx.ownerActorId };

  /** before the claim: which repository, and can this machine read it */
  async function preflight(s: SlotRow, payload: ReleasePayload): Promise<Preflight> {
    const byId = payload.repo
      ? await ctx.db.getAll<RepoRow>(`select id, org_name, name, clone_url, local_path, provider from repos where id = ? limit 1`, [payload.repo]).catch(() => [] as RepoRow[])
      : [];
    const [repo] = byId.length ? byId : await ctx.db.getAll<RepoRow>(
      `select r.id, r.org_name, r.name, r.clone_url, r.local_path, r.provider from repos r
         join project_repos pr on pr.repo_id = r.id
         join channels c on c.project_id = pr.project_id
        where c.id = ? order by coalesce(pr.is_primary, 0) desc, r.org_name, r.name limit 1`,
      [s.channel_id],
    ).catch(() => [] as RepoRow[]);
    if (!repo) return { ok: false, reason: 'this room’s project has no repository to watch. Attach one in the project.' };
    const slug = await repoSlugFor(repo);
    // a locally attached checkout stores org_name 'local' and no clone_url: gh cannot read `local/<name>`
    if (!slug || slug.startsWith('local/')) return { ok: false, reason: `${repo.name} has no GitHub remote to read` };
    if (await connected(s.channel_id)) return { ok: true, slug, repo, door: 'connector' };
    if (!(await capable())) return { ok: false, reason: `nothing can read ${slug}: connect GitHub from Connections, or sign in with gh on a machine that hosts this room.` };
    return { ok: true, slug, repo, door: 'gh' };
  }

  /** after the claim: read, scan, dedupe, open the session or leave a quiet line, move the cursor */
  async function fire(s: SlotRow, payload: ReleasePayload, pre: Extract<Preflight, { ok: true }>): Promise<{ outcome: 'fired' | 'quiet'; error: null } | { outcome: 'failed'; error: string }> {
    const at = now();
    const cursorAt = payload.latest ? '1970-01-01T00:00:00.000Z' : (payload.cursor?.at ?? at.toISOString());
    const sinceTag = payload.cursor?.tag ?? null;
    let signals: RepoSignals;
    const since = payload.latest ? new Date(at.getTime() - 120 * 86_400_000).toISOString() : cursorAt;
    try {
      // the connector first when the preflight chose it; a row that died between the two reads falls
      // back to gh on this machine, and to the honest failure where there is none
      const viaConnector = pre.door === 'connector' && ctx.readViaConnector ? await ctx.readViaConnector(s.channel_id, since) : null;
      signals = viaConnector ?? await read(pre.slug, since);
    } catch (e) {
      // the cursor stays: tomorrow's window covers today, and the row says why the bar lit
      return { outcome: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
    const scan = scanWindow({ ...signals, cursor: { at: cursorAt, tag: sinceTag }, now: at.toISOString() });
    if (payload.latest) scan.candidates = scan.candidates.slice(-1);
    // the second lock: a key that already heads a session of this routine is never fired twice
    const fresh = [];
    for (const c of scan.candidates) {
      const marker = releaseMarker(pre.slug, c.key);
      const hit = await ctx.db.getAll<{ n: number }>(
        `select count(*) as n from messages m join threads t on t.id = m.thread_id where t.schedule_id = ? and m.body like ?`,
        [s.id, `%${marker}%`],
      ).catch(() => [{ n: 0 }]);
      if (!(hit[0]?.n ?? 0)) fresh.push(c);
    }
    scan.candidates = fresh;
    const note = releaseLogNote(scan, sinceTag);
    const cursor = payload.latest ? (payload.cursor ?? { at: at.toISOString(), tag: scan.cursor.tag }) : scan.cursor;
    const setCursor = async () => {
      const r = await ctx.post('/v1/commands', owner, { type: 'schedule.set_cursor', schedule: s.id, cursor: { at: cursor.at, tag: cursor.tag ?? null }, log: { at: at.toISOString(), key: scan.candidates[scan.candidates.length - 1]?.key ?? null, note } });
      if (!r.ok) throw new Error(`the server refused the cursor (${r.status})`);
    };
    if (!scan.candidates.length) {
      try { await setCursor(); } catch (e) { return { outcome: 'failed', error: e instanceof Error ? e.message : String(e) }; }
      return { outcome: 'quiet', error: null };
    }
    // the head names the time this check RAN, in the routine's own zone (never at_time: the one-shot
    // fires at planting, and read "checked 09:00" at 22:14 on the live harness)
    let checkedAt = at.toISOString().slice(11, 16);
    try { checkedAt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: s.tz || 'UTC' }).format(at); } catch { /* an unknown zone reads as UTC */ }
    const body = `${releaseTitle(pre.slug, scan)}\n\n${releaseDigest(pre.slug, scan, { since: sinceTag, checkedAt })}`;
    try {
      const r = await ctx.post('/v1/messages', owner, { workspace: s.workspace_id, channel: s.channel_id, threadId: mintThread(), scheduleId: s.id, body });
      if (!r.ok) throw new Error(`the server refused the release session (${r.status})`);
      await setCursor();
    } catch (e) {
      return { outcome: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
    return { outcome: 'fired', error: null };
  }

  return { preflight, fire };
}

export { isNoisePr };
