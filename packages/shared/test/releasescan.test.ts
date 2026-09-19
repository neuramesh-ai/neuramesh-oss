// The release scan (plan §4.2): pure. Releases first, tags without releases second, a window of
// merged pull requests only for a repository with neither. Noise never reaches the digest, the
// cursor advances to the scan instant, and the marker names the newest candidate.
import { describe, expect, it } from 'vitest';
import { isNoisePr, parseReleaseRef, releaseDigest, releaseLogNote, releaseMarker, releaseTitle, scanWindow, type ScanPr } from '../src/releasescan';

const pr = (n: number, title: string, mergedAt: string, extra: Partial<ScanPr> = {}): ScanPr => ({ number: n, title, mergedAt, labels: [], url: `https://github.com/o/r/pull/${n}`, ...extra });
const NOW = '2026-09-17T09:00:00Z';
const CURSOR = { at: '2026-09-16T09:00:00Z', tag: 'v0.133.0' };

describe('isNoisePr, the pre-filter', () => {
  it('drops bots, noise labels, conventional noise prefixes and publish merges', () => {
    expect(isNoisePr(pr(1, 'Bump vitest from 3 to 4', NOW, { author: 'dependabot[bot]' }))).toBe(true);
    expect(isNoisePr(pr(2, 'Speed up the build', NOW, { labels: ['CI'] }))).toBe(true);
    expect(isNoisePr(pr(3, 'chore(deps): bump hono', NOW))).toBe(true);
    expect(isNoisePr(pr(4, 'docs: the runbook', NOW))).toBe(true);
    expect(isNoisePr(pr(5, 'Publish main@ad9f87a9', NOW))).toBe(true);
    expect(isNoisePr(pr(9, 'Version 0.134.0: Marketing OS is one page with one bar', NOW))).toBe(true);
    expect(isNoisePr(pr(10, 'v0.135.0', NOW))).toBe(true);
    expect(isNoisePr(pr(11, 'v2 of the editor lands', NOW))).toBe(false);
  });
  it('keeps features and fixes for the agent to judge', () => {
    expect(isNoisePr(pr(6, 'The browser terminal: a shell on your cloud machine', NOW))).toBe(false);
    expect(isNoisePr(pr(7, 'fix: pty bytes split across frames', NOW))).toBe(false);
    expect(isNoisePr(pr(8, 'feat(relay): health checks', NOW, { author: 'galonge' }))).toBe(false);
  });
});

describe('scanWindow', () => {
  const prs = [
    pr(385, 'nm-relay: the rendezvous both sides dial out to', '2026-09-14T10:00:00Z'),
    pr(387, 'The terminal pane', '2026-09-15T10:00:00Z'),
    pr(390, 'Relay health checks', '2026-09-16T10:00:00Z'),
    pr(391, 'fix: pty bytes split across frames', '2026-09-16T12:00:00Z'),
    pr(392, 'chore: bump deps', '2026-09-16T13:00:00Z'),
    pr(393, 'Something merged after the release', '2026-09-16T20:00:00Z'),
  ];
  const releases = [
    { tag: 'v0.133.0', name: 'v0.133.0', body: 'Open source.', publishedAt: '2026-09-15T02:00:00Z' },
    { tag: 'v0.134.0', name: 'The browser terminal', body: 'A shell on your cloud machine from any browser.', publishedAt: '2026-09-16T15:00:00Z', url: 'https://github.com/o/r/releases/tag/v0.134.0' },
    { tag: 'v0.135.0-rc.1', name: 'rc', body: '', publishedAt: '2026-09-16T18:00:00Z', prerelease: true },
    { tag: 'v0.135.0', name: 'draft', body: '', publishedAt: '2026-09-16T19:00:00Z', draft: true },
  ];

  it('a release in the window is the candidate, with the pull requests that built it, noise dropped', () => {
    const r = scanWindow({ releases, prs, cursor: CURSOR, now: NOW });
    expect(r.candidates.map((c) => c.key)).toEqual(['v0.134.0']);
    const c = r.candidates[0]!;
    expect(c.source).toBe('release');
    // #385 merged before v0.133.0 was published, so it belongs to that release, not this one
    expect(c.prs.map((p) => p.number)).toEqual([387, 390, 391]);
    expect(r.skipped.map((p) => p.number)).toEqual([392]);
    expect(r.cursor).toEqual({ at: NOW, tag: 'v0.134.0' });
  });

  it('a quiet window: nothing new, the cursor still advances, the tag is kept', () => {
    const r = scanWindow({ releases, prs, cursor: { at: '2026-09-16T23:00:00Z', tag: 'v0.134.0' }, now: NOW });
    expect(r.candidates).toEqual([]);
    expect(r.cursor).toEqual({ at: NOW, tag: 'v0.134.0' });
  });

  it('drafts and prereleases never count', () => {
    const r = scanWindow({ releases, prs, cursor: { at: '2026-09-16T16:00:00Z', tag: 'v0.134.0' }, now: NOW });
    expect(r.candidates).toEqual([]);
  });

  it('a pull request merged AFTER the release waits for the next one', () => {
    const r = scanWindow({ releases, prs, cursor: CURSOR, now: NOW });
    expect(r.candidates[0]!.prs.some((p) => p.number === 393)).toBe(false);
  });

  it('a repository with tags but no releases: the tag is the candidate', () => {
    const r = scanWindow({ releases: [], tags: [{ name: 'v0.133.0', date: '2026-09-16T15:00:00Z' }], prs, cursor: CURSOR, now: NOW });
    expect(r.candidates.map((c) => [c.key, c.source])).toEqual([['v0.133.0', 'tag']]);
    expect(r.candidates[0]!.prs.map((p) => p.number)).toEqual([390, 391]);
  });

  it('tags: the window starts at the PREVIOUS tag, whatever the cursor (the one-shot scans from the epoch)', () => {
    const tags = [{ name: 'v0.132.0', date: '2026-09-13T15:00:00Z' }, { name: 'v0.133.0', date: '2026-09-15T02:00:00Z' }, { name: 'v0.134.0', date: '2026-09-16T15:00:00Z' }];
    const r = scanWindow({ releases: [], tags, prs, cursor: { at: '1970-01-01T00:00:00Z', tag: null }, now: NOW });
    expect(r.candidates.map((c) => [c.key, c.prs.map((p) => p.number)])).toEqual([['v0.132.0', []], ['v0.133.0', [385]], ['v0.134.0', [387, 390, 391]]]);
  });

  it('a repository with neither: the window of merged pull requests is one candidate, keyed by the day', () => {
    const r = scanWindow({ releases: [], tags: [], prs, cursor: CURSOR, now: NOW });
    expect(r.candidates).toHaveLength(1);
    const c = r.candidates[0]!;
    expect(c.source).toBe('prs');
    expect(c.key).toBe('merged-2026-09-16');
    expect(c.tag).toBeNull();
    expect(c.prs.map((p) => p.number)).toEqual([390, 391, 393]);
    expect(r.cursor.tag).toBe('v0.133.0');
  });

  it('a repository with neither and only noise in the window is quiet', () => {
    const r = scanWindow({ releases: [], tags: [], prs: [pr(1, 'chore: bump', '2026-09-16T12:00:00Z')], cursor: CURSOR, now: NOW });
    expect(r.candidates).toEqual([]);
    expect(r.skipped).toHaveLength(1);
  });

  it('two releases in one window: both, in order, each with its own pull requests', () => {
    const r = scanWindow({ releases, prs, cursor: { at: '2026-09-14T00:00:00Z', tag: 'v0.132.0' }, now: NOW });
    expect(r.candidates.map((c) => c.key)).toEqual(['v0.133.0', 'v0.134.0']);
    expect(r.candidates[0]!.prs.map((p) => p.number)).toEqual([385]);
    expect(r.candidates[1]!.prs.map((p) => p.number)).toEqual([387, 390, 391]);
  });
});

describe('the marker and the digest', () => {
  it('round-trips the marker', () => {
    const m = releaseMarker('neuramesh-ai/neuramesh-oss', 'v0.134.0');
    expect(m).toBe('‹release:neuramesh-ai/neuramesh-oss@v0.134.0›');
    expect(parseReleaseRef(`hello\n${m}`)).toEqual({ slug: 'neuramesh-ai/neuramesh-oss', key: 'v0.134.0' });
    expect(parseReleaseRef(releaseMarker('o/r', 'merged-2026-09-16'))).toEqual({ slug: 'o/r', key: 'merged-2026-09-16' });
    expect(parseReleaseRef('no marker')).toBeNull();
    // by index, so a body of many openers costs the input once (CodeQL, 2026-09-19); shape still strict
    expect(parseReleaseRef('‹release:o/r@v1 x›')).toBeNull();
    expect(parseReleaseRef('‹release:o r@v1›')).toBeNull();
    expect(parseReleaseRef('‹release:bad› ‹release:o/r@v2›')).toEqual({ slug: 'o/r', key: 'v2' });
    const t0 = performance.now();
    expect(parseReleaseRef('‹release:-/-@'.repeat(20_000))).toBeNull();
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('writes the fire message: the head, one line per candidate, the pull requests, the noise count, the marker last', () => {
    const scan = scanWindow({
      releases: [{ tag: 'v0.134.0', name: 'The browser terminal', body: 'A shell on your cloud machine.\n\nThe machine never listens.', publishedAt: '2026-09-16T15:00:00Z' }],
      prs: [pr(385, 'nm-relay', '2026-09-16T10:00:00Z'), pr(392, 'chore: bump deps', '2026-09-16T13:00:00Z')],
      cursor: CURSOR, now: NOW,
    });
    const d = releaseDigest('o/r', scan, { since: 'v0.133.0', checkedAt: '09:00' });
    const lines = d.split('\n');
    expect(lines[0]).toBe('**New since v0.133.0** · o/r · checked 09:00');
    expect(lines[1]).toBe('- **v0.134.0** · The browser terminal · published Sep 16 · *A shell on your cloud machine. · The machine never listens.*');
    expect(lines[2]).toBe('- 1 merged: [PR 385](https://github.com/o/r/pull/385) nm-relay');
    expect(lines[3]).toBe('- 1 skipped as noise: bots, chores, dependencies, CI and docs');
    expect(lines[4]).toBe('‹release:o/r@v0.134.0›');
    expect(d).not.toMatch(/—|;/);
  });
});

describe('the title line and the ledger note', () => {
  const scan = scanWindow({ releases: [{ tag: 'v0.134.0', name: 'x', body: '', publishedAt: '2026-09-16T15:00:00Z' }], prs: [pr(1, 'a', '2026-09-16T10:00:00Z')], cursor: CURSOR, now: NOW });
  it('names the newest tag and the repository', () => {
    expect(releaseTitle('o/r', scan)).toBe('Release drafts · v0.134.0 · o/r');
    expect(releaseLogNote(scan, 'v0.133.0')).toBe('v0.134.0 · 1 release · 1 merged');
  });
  it('a quiet window says so', () => {
    const quiet = scanWindow({ releases: [], tags: [], prs: [], cursor: CURSOR, now: NOW });
    expect(releaseTitle('o/r', quiet)).toBe('Release drafts · nothing new · o/r');
    expect(releaseLogNote(quiet, 'v0.133.0')).toBe('nothing new since v0.133.0');
  });
});
