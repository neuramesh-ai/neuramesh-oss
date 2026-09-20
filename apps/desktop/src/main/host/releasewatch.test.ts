// The release routine's tick branch: the preflight stops before the claim, the fire opens one
// session with the digest and moves the cursor, a quiet window leaves a ledger line, a duplicate
// key never fires twice, a failed read leaves the cursor where it was.
// Run: pnpm exec tsx --test src/main/host/releasewatch.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeReleaseWatch, type RepoSignals } from './releasewatch';

const REPO = { id: 'r1', org_name: 'neuramesh-ai', name: 'neuramesh-oss', clone_url: 'https://github.com/neuramesh-ai/neuramesh-oss.git', local_path: null, provider: 'github' };
const SLOT = { id: 'sch-1', workspace_id: 'ws', channel_id: 'ch', title: 'Release drafts', at_time: '09:00' };
const NOW = new Date('2026-09-17T09:00:00Z');
const SIGNALS: RepoSignals = {
  releases: [{ tag: 'v0.134.0', name: 'The browser terminal', body: 'A shell on your cloud machine.', publishedAt: '2026-09-16T15:00:00Z', url: 'https://github.com/neuramesh-ai/neuramesh-oss/releases/tag/v0.134.0' }],
  prs: [{ number: 385, title: 'nm-relay', mergedAt: '2026-09-16T10:00:00Z', labels: [], url: 'https://github.com/neuramesh-ai/neuramesh-oss/pull/385', author: 'galonge' }, { number: 392, title: 'chore: deps', mergedAt: '2026-09-16T12:00:00Z', labels: [], url: null, author: 'dependabot[bot]' }],
  tags: [],
};

function harness(opts: { repoRows?: unknown[]; seen?: number; capable?: boolean; read?: () => Promise<RepoSignals>; postStatus?: number; connected?: boolean; readViaConnector?: () => Promise<RepoSignals | null> } = {}) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const db = {
    getAll: async <T,>(sql: string) => {
      if (/from repos/.test(sql)) return (opts.repoRows ?? [REPO]) as T[];
      if (/count\(\*\)/.test(sql)) return [{ n: opts.seen ?? 0 }] as T[];
      return [] as T[];
    },
  };
  const w = makeReleaseWatch({
    db, ownerActorId: 'george',
    post: async (path, _actor, body) => { posts.push({ path, body: body as Record<string, unknown> }); return new Response('{"ok":true}', { status: opts.postStatus ?? 200 }); },
    read: opts.read ?? (async () => SIGNALS),
    capable: async () => opts.capable ?? true,
    connected: async () => opts.connected ?? false,
    ...(opts.readViaConnector ? { readViaConnector: opts.readViaConnector } : {}),
    now: () => NOW,
    threadId: () => 'thread-1',
  });
  return { w, posts };
}

test('preflight: no repository, no remote, no gh login each leave the row due with a reason', async () => {
  const none = harness({ repoRows: [] });
  const a = await none.w.preflight(SLOT, {});
  assert.equal(a.ok, false); assert.match((a as { reason: string }).reason, /no repository/);
  const noRemote = harness({ repoRows: [{ ...REPO, clone_url: '', local_path: null, org_name: 'local', name: 'flowe' }] });
  const b = await noRemote.w.preflight(SLOT, {});
  assert.equal(b.ok, false); assert.match((b as { reason: string }).reason, /no GitHub remote/);
  const noGh = harness({ capable: false });
  const c = await noGh.w.preflight(SLOT, { repo: 'r1' });
  assert.equal(c.ok, false); assert.match((c as { reason: string }).reason, /connect GitHub from Connections, or sign in with gh/);
  const ok = await harness().w.preflight(SLOT, { repo: 'r1' });
  assert.deepEqual(ok, { ok: true, slug: 'neuramesh-ai/neuramesh-oss', repo: REPO, door: 'gh' });
});

test('the connector door (github-connector round): a live github row reads through the API, no gh needed, and falls back to gh when the read answers null', async () => {
  const viaApi: string[] = [];
  const h = harness({ capable: false, connected: true, readViaConnector: async () => { viaApi.push('read'); return SIGNALS; } });
  const pre = await h.w.preflight(SLOT, { repo: 'r1' });
  assert.deepEqual(pre, { ok: true, slug: 'neuramesh-ai/neuramesh-oss', repo: REPO, door: 'connector' });
  const cursor = { at: '2026-09-16T09:00:00.000Z', tag: 'v0.133.0' };
  const out = await h.w.fire(SLOT, { repo: 'r1', cursor }, pre as Extract<typeof pre, { ok: true }>);
  assert.equal(out.outcome, 'fired');
  assert.deepEqual(viaApi, ['read']);
  assert.ok(h.posts.some((p) => p.path === '/v1/messages' && String(p.body['body']).includes('‹release:neuramesh-ai/neuramesh-oss@v0.134.0›')));
  // the row died between the preflight and the read: gh on this machine answers instead
  let ghReads = 0;
  const fallback = harness({ capable: true, connected: true, readViaConnector: async () => null, read: async () => { ghReads++; return SIGNALS; } });
  const pre2 = await fallback.w.preflight(SLOT, { repo: 'r1' });
  assert.equal((await fallback.w.fire(SLOT, { repo: 'r1', cursor }, pre2 as Extract<typeof pre2, { ok: true }>)).outcome, 'fired');
  assert.equal(ghReads, 1);
});

test('fire: a release in the window opens one session with the digest and the marker, then moves the cursor', async () => {
  const { w, posts } = harness();
  const out = await w.fire(SLOT, { repo: 'r1', cursor: { at: '2026-09-16T09:00:00.000Z', tag: 'v0.133.0' } }, { ok: true, slug: 'neuramesh-ai/neuramesh-oss', repo: REPO, door: 'gh' });
  assert.deepEqual(out, { outcome: 'fired', error: null });
  assert.equal(posts.length, 2);
  const msg = posts[0]!;
  assert.equal(msg.path, '/v1/messages');
  assert.equal(msg.body['scheduleId'], 'sch-1');
  assert.equal(msg.body['threadId'], 'thread-1');
  const body = String(msg.body['body']);
  assert.ok(body.startsWith('Release drafts · v0.134.0 · neuramesh-ai/neuramesh-oss\n\n**New since v0.133.0** · neuramesh-ai/neuramesh-oss · checked 09:00'), body);
  assert.match(body, /\[PR 385\]\(https:\/\/github\.com\/neuramesh-ai\/neuramesh-oss\/pull\/385\) nm-relay/);
  assert.match(body, /1 skipped as noise/);
  assert.ok(body.endsWith('‹release:neuramesh-ai/neuramesh-oss@v0.134.0›'));
  const cur = posts[1]!;
  assert.equal(cur.path, '/v1/commands');
  assert.deepEqual(cur.body, { type: 'schedule.set_cursor', schedule: 'sch-1', cursor: { at: NOW.toISOString(), tag: 'v0.134.0' }, log: { at: NOW.toISOString(), key: 'v0.134.0', note: 'v0.134.0 · 1 release · 1 merged' } });
});

test('fire: a quiet window opens nothing and leaves one ledger line', async () => {
  const { w, posts } = harness({ read: async () => ({ releases: [], prs: [], tags: [] }) });
  const out = await w.fire(SLOT, { repo: 'r1', cursor: { at: '2026-09-16T09:00:00.000Z', tag: 'v0.133.0' } }, { ok: true, slug: 'o/r', repo: REPO, door: 'gh' });
  assert.deepEqual(out, { outcome: 'quiet', error: null });
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.path, '/v1/commands');
  assert.equal((posts[0]!.body['log'] as { note: string }).note, 'nothing new since v0.133.0');
  assert.deepEqual(posts[0]!.body['cursor'], { at: NOW.toISOString(), tag: 'v0.133.0' });
});

test('fire: a key that already heads a session of this routine never fires twice', async () => {
  const { w, posts } = harness({ seen: 1 });
  const out = await w.fire(SLOT, { repo: 'r1', cursor: { at: '2026-09-16T09:00:00.000Z', tag: 'v0.133.0' } }, { ok: true, slug: 'o/r', repo: REPO, door: 'gh' });
  assert.equal(out.outcome, 'quiet');
  assert.equal(posts.filter((p) => p.path === '/v1/messages').length, 0);
});

test('fire: the one-shot takes the newest release whatever the cursor says, and keeps the cursor', async () => {
  const { w, posts } = harness();
  const out = await w.fire(SLOT, { repo: 'r1', latest: true, cursor: { at: '2026-09-17T08:00:00.000Z', tag: 'v0.134.0' } }, { ok: true, slug: 'o/r', repo: REPO, door: 'gh' });
  assert.equal(out.outcome, 'fired');
  assert.match(String(posts[0]!.body['body']), /^Release drafts · v0\.134\.0 · o\/r/);
  assert.deepEqual(posts[1]!.body['cursor'], { at: '2026-09-17T08:00:00.000Z', tag: 'v0.134.0' });
});

test('fire: a failed read leaves the cursor where it was and says why', async () => {
  const { w, posts } = harness({ read: async () => { throw new Error('gh could not read o/r: HTTP 401'); } });
  const out = await w.fire(SLOT, { repo: 'r1', cursor: { at: '2026-09-16T09:00:00.000Z', tag: null } }, { ok: true, slug: 'o/r', repo: REPO, door: 'gh' });
  assert.deepEqual(out, { outcome: 'failed', error: 'gh could not read o/r: HTTP 401' });
  assert.equal(posts.length, 0);
});
