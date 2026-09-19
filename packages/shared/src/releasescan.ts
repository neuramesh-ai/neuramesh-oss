// Release scan (docs/design/release-drafts-2026-09, plan §4.2 and §5.1): the PURE half of the
// release-drafts routine. The daemon's tick fetches a repository's releases, tags and merged pull
// requests with the machine's own gh, the server does the same for the public door, and BOTH hand
// the rows here. This module decides what is new since the cursor, drops the noise a person would
// never announce (bots, chores, dependency bumps, CI, docs), attaches each release's pull requests,
// and writes the digest that opens the release session. It never calls a model: detection is code,
// the feature call is the agent's, in the thread (the docs/19 rule).
//
// The cursor is the schedule's own (`schedules.payload.release.cursor`): it advances only after a
// completed scan, so a scan that dies after the claim leaves it and the next window covers today.
// The `‹release:owner/repo@key›` marker in the fire message is the second lock: a key that already
// heads a thread of the schedule is never fired twice.

import { markerSpans } from './linear';
export interface ScanRelease {
  tag: string;
  name?: string | null;
  body?: string | null;
  publishedAt: string;
  url?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}
export interface ScanPr {
  number: number;
  title: string;
  body?: string | null;
  labels?: string[];
  mergedAt: string;
  url?: string | null;
  author?: string | null;
}
/** a tag without a release: the caller resolves its commit date */
export interface ScanTag { name: string; date?: string | null; url?: string | null }
export interface ScanCursor { at: string; tag?: string | null }
export interface ScanInput {
  releases: ScanRelease[];
  prs: ScanPr[];
  tags?: ScanTag[];
  cursor: ScanCursor;
  /** the scan instant; the cursor lands here */
  now: string;
}
export interface ReleaseCandidate {
  /** the dedupe key: the tag, or `merged-YYYY-MM-DD` for a window of pull requests with no release */
  key: string;
  tag: string | null;
  name: string;
  notes: string;
  publishedAt: string;
  url: string | null;
  source: 'release' | 'tag' | 'prs';
  prs: ScanPr[];
}
export interface ScanResult {
  candidates: ReleaseCandidate[];
  /** pull requests the pre-filter dropped (named in the digest as a count, never listed) */
  skipped: ScanPr[];
  cursor: { at: string; tag: string | null };
}

const NOISE_LABELS = new Set(['chore', 'chores', 'deps', 'dependencies', 'dependency', 'ci', 'build', 'docs', 'documentation', 'test', 'tests', 'testing', 'infra', 'internal', 'refactor', 'release', 'skip-changelog', 'no-changelog']);
const NOISE_PREFIX = /^\s*(?:chore|ci|build|docs|test|tests|refactor|deps|style|bump|release)(?:\([^)]*\))?\s*[:!]/i;
const BOT_AUTHOR = /(?:\[bot\]$|^dependabot|^renovate|^github-actions$|^greenkeeper)/i;
const PUBLISH_TITLE = /^publish main@[0-9a-f]{6,}/i;
// the version bump is the release's own paperwork, never a feature (`Version 0.134.0: …` sat first in
// the v0.135.0 digest on the live harness, 2026-09-18)
const VERSION_TITLE = /^\s*(?:v|version\s+)\d+\.\d+(?:\.\d+)?(?:\s*[:·(-]|\s*$)/i;

/** the pre-filter: what a person would never announce. Judgment stays with the agent. */
export function isNoisePr(pr: ScanPr): boolean {
  if (pr.author && BOT_AUTHOR.test(pr.author)) return true;
  if ((pr.labels ?? []).some((l) => NOISE_LABELS.has(l.toLowerCase().trim()))) return true;
  if (NOISE_PREFIX.test(pr.title)) return true;
  if (PUBLISH_TITLE.test(pr.title) || VERSION_TITLE.test(pr.title)) return true;
  return false;
}

const t = (iso: string | null | undefined): number => { const n = iso ? new Date(iso).getTime() : NaN; return Number.isNaN(n) ? 0 : n; };
const day = (iso: string): string => iso.slice(0, 10);

/**
 * What is new since the cursor. Releases first (drafts and prereleases never), then tags without
 * a release, then, for a repository with neither, the window's merged pull requests as ONE
 * candidate. Every release takes the pull requests merged after the previous release (or the
 * cursor, whichever is earlier) and up to its own publish time, so the digest names what built it.
 */
export function scanWindow(input: ScanInput): ScanResult {
  const since = t(input.cursor.at);
  const now = t(input.now);
  const kept = input.prs.filter((p) => !isNoisePr(p));
  const skipped = input.prs.filter((p) => isNoisePr(p));
  const byMerge = (a: ScanPr, b: ScanPr) => t(a.mergedAt) - t(b.mergedAt);
  const releases = input.releases
    .filter((r) => !r.draft && !r.prerelease && t(r.publishedAt) > 0)
    .sort((a, b) => t(a.publishedAt) - t(b.publishedAt));
  const fresh = releases.filter((r) => t(r.publishedAt) > since && t(r.publishedAt) <= now);
  const candidates: ReleaseCandidate[] = [];
  if (fresh.length) {
    for (const r of fresh) {
      const prev = releases.filter((x) => t(x.publishedAt) < t(r.publishedAt)).pop();
      // the window that BUILT this release: after the previous release (or the cursor when none is
      // known), up to its own publish time. A pull request merged before the previous release
      // belongs to that one, however far back the cursor sits.
      const from = prev ? t(prev.publishedAt) : since;
      const prs = kept.filter((p) => t(p.mergedAt) > from && t(p.mergedAt) <= t(r.publishedAt)).sort(byMerge);
      candidates.push({ key: r.tag, tag: r.tag, name: (r.name ?? '').trim() || r.tag, notes: (r.body ?? '').trim(), publishedAt: r.publishedAt, url: r.url ?? null, source: 'release', prs });
    }
  } else if (!releases.length && (input.tags ?? []).some((x) => t(x.date) > since && t(x.date) <= now)) {
    const dated = (input.tags ?? []).filter((x) => t(x.date) > 0).sort((a, b) => t(a.date) - t(b.date));
    const tags = dated.filter((x) => t(x.date) > since && t(x.date) <= now);
    for (const x of tags) {
      // the same window rule as a release: after the PREVIOUS tag, whatever the cursor. Without it the
      // newest tag of a tags-only repository owned every pull request the read returned (94 on the
      // live harness, 2026-09-18, for a window of five).
      const prev = dated.filter((y) => t(y.date) < t(x.date)).pop();
      const from = prev ? t(prev.date) : since;
      const prs = kept.filter((p) => t(p.mergedAt) > from && t(p.mergedAt) <= t(x.date)).sort(byMerge);
      candidates.push({ key: x.name, tag: x.name, name: x.name, notes: '', publishedAt: x.date!, url: x.url ?? null, source: 'tag', prs });
    }
  } else if (!releases.length && !(input.tags ?? []).length) {
    const prs = kept.filter((p) => t(p.mergedAt) > since && t(p.mergedAt) <= now).sort(byMerge);
    if (prs.length) {
      const last = prs[prs.length - 1]!;
      candidates.push({ key: `merged-${day(last.mergedAt)}`, tag: null, name: `${prs.length} merged pull request${prs.length === 1 ? '' : 's'}`, notes: '', publishedAt: last.mergedAt, url: null, source: 'prs', prs });
    }
  }
  const newestTag = candidates.filter((c) => c.tag).map((c) => c.tag!).pop() ?? input.cursor.tag ?? null;
  return { candidates, skipped, cursor: { at: input.now, tag: newestTag } };
}

/** `‹release:owner/repo@v1.2.0›`: the fire message's identity, and the dedupe lock */
export function releaseMarker(slug: string, key: string): string {
  return `‹release:${slug}@${key}›`;
}
export function parseReleaseRef(body: string | null | undefined): { slug: string; key: string } | null {
  // the marker by index (a body of many `‹release:` costs the input once): `owner/repo@key›`
  for (const sp of markerSpans(body ?? '', '‹release:', '›')) {
    const at = sp.inner.indexOf('@');
    if (at === -1) continue;
    const slug = sp.inner.slice(0, at);
    const key = sp.inner.slice(at + 1);
    if (!key || /\s/.test(key) || !/^[\w.-]+\/[\w.-]+$/.test(slug)) continue;
    return { slug, key };
  }
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
const excerpt = (s: string, n: number): string => { const one = s.replace(/\r/g, '').replace(/\n{2,}/g, ' · ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(); return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one; };

/**
 * The fire message's body: what is new, in STE, ending in the marker of the NEWEST candidate (one
 * session per window; the agent reads every candidate in it). The tick puts the session's title line
 * above it (`releaseTitle`), because the first line of a routine's message becomes the thread title.
 */
export function releaseDigest(slug: string, scan: ScanResult, opts: { since: string | null; checkedAt: string }): string {
  const lines: string[] = [];
  const since = opts.since ? `New since ${opts.since}` : 'The first check';
  lines.push(`**${since}** · ${slug} · checked ${opts.checkedAt}`);
  for (const c of scan.candidates) {
    const head = c.source === 'prs' ? `**${c.name}**` : `**${c.tag}**${c.name && c.name !== c.tag ? ` · ${c.name}` : ''}`;
    const when = `published ${shortDate(c.publishedAt)}`;
    const notes = c.notes ? ` · *${excerpt(c.notes, 400)}*` : '';
    lines.push(`- ${head} · ${when}${notes}`);
    if (c.prs.length) {
      // `PR 385`, never `#385`: the thread renders `#N` as a TASK reference, and 385 is not a task here
      const list = c.prs.slice(0, 12).map((p) => `${p.url ? `[PR ${p.number}](${p.url})` : `PR ${p.number}`} ${excerpt(p.title, 90)}`).join(' · ');
      lines.push(`- ${c.prs.length} merged: ${list}${c.prs.length > 12 ? ` · and ${c.prs.length - 12} more` : ''}`);
    }
  }
  if (scan.skipped.length) lines.push(`- ${scan.skipped.length} skipped as noise: bots, chores, dependencies, CI and docs`);
  const newest = scan.candidates[scan.candidates.length - 1];
  if (newest) lines.push(releaseMarker(slug, newest.key));
  return lines.join('\n');
}

// ── the routine's own state: payload.release ───────────────────────────────────────────────────
// Both stores write it through THIS helper (read, merge, write), so the memory lane and postgres
// can never disagree on the shape. The log is the Routines ledger's quiet rows: capped, newest last.
export interface ReleaseLogRow { at: string; key: string | null; note: string }
export interface ReleasePayload {
  /** the repository id (repos.id) the routine watches, and its owner/name for the digest */
  repo?: string | null;
  slug?: string | null;
  /** a one-shot "draft the latest release now": the scan takes the newest release whatever the cursor */
  latest?: boolean;
  cursor?: { at: string; tag?: string | null } | null;
  log?: ReleaseLogRow[];
}
export const RELEASE_LOG_CAP = 12;
export function mergeReleaseCursor(payload: Record<string, unknown> | null | undefined, cursor: { at: string; tag: string | null }, log: ReleaseLogRow | null): Record<string, unknown> {
  const base = payload && typeof payload === 'object' ? payload : {};
  const prev = base['release'] && typeof base['release'] === 'object' ? (base['release'] as ReleasePayload) : {};
  const rel: ReleasePayload = { ...prev, cursor };
  if (log) rel.log = [...(Array.isArray(prev.log) ? prev.log : []), log].slice(-RELEASE_LOG_CAP);
  return { ...base, release: rel };
}
export function isReleasePayload(payload: Record<string, unknown> | null | undefined): boolean {
  return !!payload && typeof payload === 'object' && !!payload['release'] && typeof payload['release'] === 'object';
}

/** the session's title line: `Release drafts · v0.134.0 · owner/repo` (a window with no tag names its day) */
export function releaseTitle(slug: string, scan: ScanResult): string {
  const newest = scan.candidates[scan.candidates.length - 1];
  const what = newest ? (newest.tag ?? `merged ${shortDate(newest.publishedAt)}`) : 'nothing new';
  return `Release drafts · ${what} · ${slug}`;
}
/** the ledger line for a window: `v0.134.0 · 1 release · 3 merged` or `nothing new since v0.133.0` */
export function releaseLogNote(scan: ScanResult, sinceTag: string | null): string {
  if (!scan.candidates.length) return `nothing new since ${sinceTag ?? 'the start'}`;
  const newest = scan.candidates[scan.candidates.length - 1]!;
  const prs = scan.candidates.reduce((n, c) => n + c.prs.length, 0);
  const rel = scan.candidates.filter((c) => c.source !== 'prs').length;
  const head = newest.tag ?? `merged ${shortDate(newest.publishedAt)}`;
  return `${head} · ${rel ? `${rel} release${rel === 1 ? '' : 's'} · ` : ''}${prs} merged`;
}
