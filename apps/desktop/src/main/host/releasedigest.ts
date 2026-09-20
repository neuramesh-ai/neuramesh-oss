// The release digest at creation (docs/design/github-connector-2026-09 §3.4): what run_playbook
// ('release') reads BEFORE it mints the unit, so plume starts with the notes and the pull requests
// instead of an empty page. One read through the same two doors the agents' tools use (the GitHub
// connector, else this machine's gh), the pure scan (shared/releasescan.ts), the same digest the
// routine's tick writes as a session's first message. A thread the routine opened already carries
// its digest (the `‹release:` marker) and is left alone. Null = nothing read, and the unit says why.
import { releaseDigest, releaseTitle, scanWindow } from '@neuramesh/shared';
import { ghCapable, repoSlugFor } from './gh';
import { readRepoSignals } from './releasewatch';
import { githubConnected, primaryRepoRow, readSignalsViaConnector } from './reporead';
import type { ApiGetFn } from './searchx';

type ReplicaDb = { getAll<T>(sql: string, params?: unknown[]): Promise<T[]> };
const WINDOW_DAYS = 120;

export async function releaseDigestFor(i: { db: ReplicaDb; apiGet: ApiGetFn; actor: { kind: string; id: string; role?: string }; channelId: string; threadId: string | null; release: string | null; now?: Date; capable?: () => Promise<boolean> }): Promise<string | null> {
  const { db, apiGet, actor, channelId } = i;
  if (i.threadId) {
    const [hit] = await db.getAll<{ n: number }>(`select count(*) as n from messages where (thread_id = ? or task_id = ?) and body like '%‹release:%'`, [i.threadId, i.threadId]).catch(() => [{ n: 0 }]);
    if ((hit?.n ?? 0) > 0) return null;
  }
  const repo = await primaryRepoRow(db, channelId);
  const slug = repo ? await repoSlugFor(repo) : '';
  if (!slug || slug.startsWith('local/')) return null;
  const now = i.now ?? new Date();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  let signals = await githubConnected(db, channelId) ? await readSignalsViaConnector(apiGet, actor, channelId, since) : null;
  let door: 'the GitHub connection' | 'this machine\'s gh' = 'the GitHub connection';
  if (!signals) {
    if (!(await (i.capable ?? ghCapable)())) return null;
    signals = await readRepoSignals(slug, since);
    door = 'this machine\'s gh';
  }
  const scan = scanWindow({ ...signals, cursor: { at: since, tag: null }, now: now.toISOString() });
  // a named release picks its own candidate; otherwise the newest one is the release
  const wanted = (i.release ?? '').trim();
  const named = wanted ? scan.candidates.find((c) => c.key === wanted || c.name === wanted || c.key.replace(/^v/, '') === wanted.replace(/^v/, '')) : null;
  scan.candidates = named ? [named] : scan.candidates.slice(-1);
  const head = scan.candidates.length ? releaseTitle(slug, scan) : `Nothing shipped in ${slug} in the last ${WINDOW_DAYS} days`;
  // the marker line stays out of a description: it is the thread's dedupe lock, not a fact for plume
  const body = releaseDigest(slug, scan, { since: null, checkedAt: now.toISOString().slice(11, 16) }).split('\n').filter((l) => !l.startsWith('‹release:')).join('\n');
  return `Release digest, read at creation through ${door}:\n${head}\n\n${body}`;
}
