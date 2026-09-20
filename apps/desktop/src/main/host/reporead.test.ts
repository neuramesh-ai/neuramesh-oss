// The one repository reader (docs/design/github-connector-2026-09 §3.3): the connector door when
// the room's project holds a live github row, the machine's gh when it does not and gh can, the
// honest refusal that names the fix otherwise; the three renderers; the server's refusals mapped
// to the agent's words. GitHub and the API are fakes; gh is never spawned here.
// Run: pnpm exec tsx --test src/main/host/reporead.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepoReader, readSignalsViaConnector, renderChanges, renderTree } from './reporead';

const REPO = { id: 'r1', org_name: 'acme', name: 'site', clone_url: 'https://github.com/acme/site.git', local_path: null, provider: 'github' };
const CHANGES = {
  slug: 'acme/site', since: '2026-09-01T00:00:00.000Z',
  releases: [{ tag: 'v0.1.0', name: 'The first cut', body: 'One thread per customer.\n\nMore.', publishedAt: '2026-09-16T15:00:00Z', url: 'https://github.com/acme/site/releases/tag/v0.1.0' }],
  prs: [{ number: 7, title: 'The shared inbox', body: '', labels: ['feature'], mergedAt: '2026-09-16T10:00:00Z', url: 'https://github.com/acme/site/pull/7', author: 'maya' }],
  tags: [], commits: [{ sha: 'abc1234def', message: 'Ship the inbox', date: '2026-09-16T09:00:00Z', author: 'maya', url: '' }],
  repo: { defaultBranch: 'main', private: true },
};

function harness(opts: { connected?: boolean; repo?: unknown | null; capable?: boolean; api?: Record<string, { status: number; body: unknown }> } = {}) {
  const calls: string[] = [];
  const db = {
    getAll: async <T,>(sql: string) => {
      if (/from connectors/.test(sql)) return [{ n: opts.connected ? 1 : 0 }] as T[];
      if (/from repos/.test(sql)) return (opts.repo === null ? [] : [opts.repo ?? REPO]) as T[];
      return [] as T[];
    },
  };
  const apiGet = async (path: string) => {
    calls.push(path);
    const key = path.split('?')[0]!.replace('/v1/repo/', '');
    const hit = opts.api?.[key] ?? { status: 200, body: CHANGES };
    return { status: hit.status, ok: hit.status < 300, json: async () => hit.body, text: async () => JSON.stringify(hit.body) };
  };
  const reader = makeRepoReader({ apiGet, actor: { kind: 'agent', id: 'rex' }, db, channelId: 'ch', capable: async () => !!opts.capable });
  return { reader, calls, apiGet };
}

test('the connector door: a live github row sends every read to /v1/repo/*, rendered', async () => {
  const h = harness({ connected: true, api: {
    changes: { status: 200, body: CHANGES },
    file: { status: 200, body: { slug: 'acme/site', path: 'CHANGELOG.md', ref: null, size: 12, content: '# Changelog\n', truncated: false } },
    tree: { status: 200, body: { slug: 'acme/site', ref: 'HEAD', path: '', entries: [{ path: 'README.md', type: 'blob', size: 30 }, { path: 'docs', type: 'tree', size: null }], truncated: false } },
  } });
  const changes = await h.reader.changes({ since: '2026-09-01' });
  assert.match(changes, /acme\/site · default branch main · private/);
  assert.match(changes, /- v0\.1\.0 · The first cut · 2026-09-16\n  One thread per customer\. More\./);
  assert.match(changes, /- #7 The shared inbox · maya · merged 2026-09-16 · feature/);
  assert.match(changes, /- abc1234 Ship the inbox · maya · 2026-09-16/);
  assert.match(await h.reader.file({ path: 'CHANGELOG.md' }), /acme\/site · CHANGELOG\.md · 12 bytes\n\n# Changelog/);
  assert.match(await h.reader.tree({}), /2 entries\nREADME\.md \(30 B\)\ndocs\//);
  assert.deepEqual(h.calls.map((c) => c.split('?')[0]), ['/v1/repo/changes', '/v1/repo/file', '/v1/repo/tree']);
  assert.match(h.calls[0]!, /since=2026-09-01T00%3A00%3A00\.000Z/);
});

test('the server\'s refusals become the agent\'s words: reconnect, not connected, a missing path', async () => {
  const dead = harness({ connected: true, api: { changes: { status: 409, body: { code: 'RECONNECT_REQUIRED', error: 'x' } } } });
  assert.match(await dead.reader.changes({}), /grant ended on GitHub.*connect GitHub again/);
  const missing = harness({ connected: true, api: { file: { status: 400, body: { code: 'NOT_FOUND', error: 'no file at nope.md' } } } });
  assert.equal(await missing.reader.file({ path: 'nope.md' }), 'no file at nope.md');
  const gone = harness({ connected: true, api: { tree: { status: 409, body: { code: 'NOT_CONNECTED', error: 'x' } } } });
  assert.match(await gone.reader.tree({}), /Connections › GitHub/);
});

test('no row, no gh: the refusal names the fix; no repository: the attach; a local checkout: no remote', async () => {
  assert.match(await harness({ connected: false, capable: false }).reader.changes({}), /GitHub is not connected for this project and this machine has no GitHub login/);
  assert.match(await harness({ connected: false, repo: null, capable: true }).reader.file({ path: 'x' }), /no GitHub repository attached/);
  assert.match(await harness({ connected: false, capable: true, repo: { ...REPO, org_name: 'local', clone_url: '', local_path: null } }).reader.tree({}), /no GitHub remote/);
});

test('the release watch\'s connector read: the signals, or null when the room has no live grant', async () => {
  const h = harness({ connected: true });
  const signals = await readSignalsViaConnector(h.apiGet, { kind: 'human', id: 'george' }, 'ch', '2026-09-01T00:00:00Z');
  assert.deepEqual(signals?.releases.map((r) => r.tag), ['v0.1.0']);
  const none = harness({ api: { changes: { status: 409, body: { code: 'NOT_CONNECTED', error: 'x' } } } });
  assert.equal(await readSignalsViaConnector(none.apiGet, { kind: 'human', id: 'george' }, 'ch', '2026-09-01T00:00:00Z'), null);
  const broken = harness({ api: { changes: { status: 502, body: { code: 'GITHUB_ERROR', error: 'GitHub did not answer' } } } });
  await assert.rejects(readSignalsViaConnector(broken.apiGet, { kind: 'human', id: 'george' }, 'ch', '2026-09-01T00:00:00Z'), /GitHub did not answer/);
});

test('renderers: empty sets say so, a cut tree says to name a deeper path', () => {
  const quiet = renderChanges({ slug: 'a/b', since: '2026-09-01', releases: [], prs: [], tags: [{ name: 'v1', date: '2026-08-01', url: '' }], commits: [] });
  assert.match(quiet, /Releases \(newest first\): none published/);
  assert.match(quiet, /Tags \(no releases published\):\n- v1 · 2026-08-01/);
  assert.match(renderTree({ slug: 'a/b', ref: 'HEAD', path: 'src', entries: [], truncated: true }), /src @ HEAD · 0 entries \(cut: name a deeper path\)/);
});
