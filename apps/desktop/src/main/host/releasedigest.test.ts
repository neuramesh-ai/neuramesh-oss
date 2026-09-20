// The release digest at creation (docs/design/github-connector-2026-09 §3.4): read through the
// connector when the row is live, through gh when the machine can, nothing when neither; a named
// release picks its candidate, the newest otherwise; a thread that already carries a digest is left
// alone; the marker line never lands in a description.
// Run: pnpm exec tsx --test src/main/host/releasedigest.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseDigestFor } from './releasedigest';

const REPO = { id: 'r1', org_name: 'acme', name: 'site', clone_url: 'https://github.com/acme/site.git', local_path: null, provider: 'github' };
const NOW = new Date('2026-09-19T20:00:00Z');
const CHANGES = {
  releases: [
    { tag: 'v0.1.0', name: 'The first cut', body: 'One thread per customer.', publishedAt: '2026-09-10T15:00:00Z', url: 'https://github.com/acme/site/releases/tag/v0.1.0' },
    { tag: 'v0.2.0', name: 'The inbox', body: 'Replies drafted for you.', publishedAt: '2026-09-16T15:00:00Z', url: 'https://github.com/acme/site/releases/tag/v0.2.0' },
  ],
  prs: [{ number: 7, title: 'The shared inbox', mergedAt: '2026-09-15T10:00:00Z', labels: [], url: 'https://github.com/acme/site/pull/7', author: 'maya' }],
  tags: [], commits: [],
};

function harness(o: { connected?: boolean; marker?: boolean; capable?: boolean } = {}) {
  const db = { getAll: async <T,>(sql: string) => {
    if (/from connectors/.test(sql)) return [{ n: o.connected ? 1 : 0 }] as T[];
    if (/from repos/.test(sql)) return [REPO] as T[];
    if (/from messages/.test(sql)) return [{ n: o.marker ? 1 : 0 }] as T[];
    return [] as T[];
  } };
  const apiGet = async () => ({ status: 200, ok: true, json: async () => CHANGES, text: async () => '' });
  return (release: string | null, threadId: string | null = 'th') =>
    releaseDigestFor({ db, apiGet, actor: { kind: 'agent', id: 'rex' }, channelId: 'ch', threadId, release, now: NOW, capable: async () => !!o.capable });
}

test('the connector door: the newest release, its pull requests, no marker line', async () => {
  const out = await harness({ connected: true })(null);
  assert.ok(out);
  assert.match(out, /^Release digest, read at creation through the GitHub connection:\nRelease drafts · v0\.2\.0 · acme\/site/);
  assert.match(out, /\*\*v0\.2\.0\*\* · The inbox/);
  assert.doesNotMatch(out, /v0\.1\.0\*\*/);
  assert.doesNotMatch(out, /‹release:/);
});

test('a named release picks its own candidate, with or without the v', async () => {
  const out = await harness({ connected: true })('0.1.0');
  assert.match(out!, /\*\*v0\.1\.0\*\* · The first cut/);
  assert.doesNotMatch(out!, /v0\.2\.0\*\*/);
});

test('no connector and no gh: nothing is read, and the unit says so by carrying no digest', async () => {
  assert.equal(await harness({ connected: false, capable: false })(null), null);
});

test('a thread that already carries the routine\'s digest is left alone', async () => {
  assert.equal(await harness({ connected: true, marker: true })(null), null);
});
