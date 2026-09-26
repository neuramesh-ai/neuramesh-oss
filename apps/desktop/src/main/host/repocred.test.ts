// host/repocred.ts: who writes to GitHub with what. A login-less cloud machine takes the App's
// one-hour token for ONE repository; everything else keeps its own login. The token must reach
// only the daemon's own git and gh processes, so the env it hands out is the whole custody story.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appCredEnv, makeRepoCred } from './repocred';

const SLUG = 'neuramesh-ai/release-drafts-test';
const HOUR = 60 * 60_000;

/** a token route that records its calls and answers from a script */
function route(answer: (n: number) => { status: number; body: unknown } | Error) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    const a = answer(calls.length);
    if (a instanceof Error) throw a;
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

const mint = (expiresAt: string, slug = SLUG) => ({ status: 200, body: { slug, token: 'ghs_run_1', expiresAt } });

function cred(o: { cloud: boolean; runner?: boolean; login?: boolean; fetchFn: typeof fetch; now?: () => number; slept?: number[] }) {
  return makeRepoCred({
    apiUrl: 'http://api.test',
    cloud: o.cloud,
    runner: o.runner ?? true,
    ownLogin: async () => o.login ?? false,
    bearer: async () => ({ authorization: 'Bearer nmm_machine' }),
    fetchFn: o.fetchFn,
    now: o.now,
    sleep: async (ms) => { o.slept?.push(ms); },
    graceMs: 60_000,
  });
}

test('a laptop and a machine with its own login never mint: their own credentials serve', async () => {
  const r = route(() => mint(new Date(Date.now() + HOUR).toISOString()));
  assert.deepEqual(await cred({ cloud: false, fetchFn: r.fetchFn }).forRepo(SLUG, 'ch1'), { ok: true, env: {}, lane: 'own' });
  assert.deepEqual(await cred({ cloud: true, login: true, fetchFn: r.fetchFn }).forRepo(SLUG, 'ch1'), { ok: true, env: {}, lane: 'own' });
  // a non-GitHub repository has no slug, and there is nothing to mint for
  assert.deepEqual(await cred({ cloud: true, fetchFn: r.fetchFn }).forRepo('', 'ch1'), { ok: true, env: {}, lane: 'own' });
  assert.equal(r.calls.length, 0);
});

test('a login-less cloud machine mints with its machine bearer, for the room, and hands out env only', async () => {
  const r = route(() => mint(new Date(Date.now() + HOUR).toISOString()));
  const got = await cred({ cloud: true, fetchFn: r.fetchFn }).forRepo(SLUG, 'ch1');
  assert.equal(got.ok, true);
  assert.equal(r.calls[0]!.url, 'http://api.test/v1/repo/token');
  assert.equal(r.calls[0]!.headers['authorization'], 'Bearer nmm_machine');
  assert.deepEqual(r.calls[0]!.body, { channel: 'ch1' });
  if (!got.ok) return;
  assert.equal(got.lane, 'app');
  assert.equal(got.env['GH_TOKEN'], 'ghs_run_1');
  assert.equal(got.env['GIT_CONFIG_KEY_0'], 'http.https://github.com/.extraheader');
  assert.equal(got.env['GIT_CONFIG_VALUE_0'], `AUTHORIZATION: basic ${Buffer.from('x-access-token:ghs_run_1').toString('base64')}`);
});

test('the token is reused while it has time left, and minted again before a wait could outlive it', async () => {
  let t = Date.parse('2026-09-26T12:00:00Z');
  const r = route(() => mint(new Date(t + HOUR).toISOString()));
  const c = cred({ cloud: true, fetchFn: r.fetchFn, now: () => t });
  await c.forRepo(SLUG, 'ch1');
  t += 20 * 60_000; // 40 minutes left: reused
  await c.forRepo(SLUG, 'ch1');
  assert.equal(r.calls.length, 1);
  t += 15 * 60_000; // 25 minutes left: a 25-minute release wait could outlive it
  await c.forRepo(SLUG, 'ch1');
  assert.equal(r.calls.length, 2);
});

test('a refusal carries the server\'s code and words, and a token for another repository is refused', async () => {
  const refused = route(() => ({ status: 409, body: { code: 'APP_NEEDS_WRITE', error: 'The neuramesh GitHub App needs these permissions for a pull request.' } }));
  assert.deepEqual(await cred({ cloud: true, fetchFn: refused.fetchFn }).forRepo(SLUG, 'ch1'),
    { ok: false, code: 'APP_NEEDS_WRITE', error: 'The neuramesh GitHub App needs these permissions for a pull request.' });
  const other = route(() => mint(new Date(Date.now() + HOUR).toISOString(), 'acme/other'));
  const got = await cred({ cloud: true, fetchFn: other.fetchFn }).forRepo(SLUG, 'ch1');
  assert.equal(got.ok ? '' : got.code, 'OTHER_REPO');
  const down = route(() => new Error('ECONNREFUSED'));
  const unreachable = await cred({ cloud: true, fetchFn: down.fetchFn }).forRepo(SLUG, 'ch1');
  assert.equal(unreachable.ok ? '' : unreachable.code, 'UNREACHABLE');
});

test('the watches: an own login, or the runner\'s App lane; a member machine without a login stays out', async () => {
  const r = route(() => mint(new Date(Date.now() + HOUR).toISOString()));
  assert.equal(await cred({ cloud: true, runner: true, fetchFn: r.fetchFn }).watches(), true);
  assert.equal(await cred({ cloud: true, runner: false, fetchFn: r.fetchFn }).watches(), false);
  assert.equal(await cred({ cloud: true, runner: false, login: true, fetchFn: r.fetchFn }).watches(), true);
  // a laptop with no gh login skips them, as before: it used to post a failed-merge warning per sweep
  assert.equal(await cred({ cloud: false, runner: false, fetchFn: r.fetchFn }).watches(), false);
});

test('a merge through the App waits the grace first, so a machine with its own login merges first', async () => {
  const r = route(() => mint(new Date(Date.now() + HOUR).toISOString()));
  const slept: number[] = [];
  const got = await cred({ cloud: true, runner: true, fetchFn: r.fetchFn, slept }).forMerge(SLUG, 'ch1');
  assert.equal(got.ok, true);
  assert.deepEqual(slept, [60_000]);
  const own: number[] = [];
  await cred({ cloud: true, login: true, fetchFn: r.fetchFn, slept: own }).forMerge(SLUG, 'ch1');
  assert.deepEqual(own, [], 'an own login merges at once');
  const member = await cred({ cloud: true, runner: false, fetchFn: r.fetchFn }).forMerge(SLUG, 'ch1');
  assert.equal(member.ok ? '' : member.code, 'NOT_RUNNER');
});

test('appCredEnv appends to a config count the process already has, and writes no file', () => {
  const env = appCredEnv('ghs_x', { GIT_CONFIG_COUNT: '2' });
  assert.equal(env['GIT_CONFIG_COUNT'], '3');
  assert.equal(env['GIT_CONFIG_KEY_2'], 'http.https://github.com/.extraheader');
  assert.equal(env['GIT_CONFIG_KEY_0'], undefined, 'the process\'s own entries stay as they are');
});

test('the own login is asked live, at most once a minute: a login made in the terminal lands while the daemon runs', async () => {
  let t = Date.parse('2026-09-26T12:00:00Z');
  let asked = 0;
  let loggedIn = false;
  const r = route(() => mint(new Date(t + HOUR).toISOString()));
  const c = makeRepoCred({ apiUrl: 'http://api.test', cloud: true, runner: true, ownLogin: async () => { asked++; return loggedIn; }, bearer: async () => ({}), fetchFn: r.fetchFn, now: () => t });
  assert.equal((await c.forRepo(SLUG, 'ch1')).ok && (await c.forRepo(SLUG, 'ch1')).ok, true);
  assert.equal(asked, 1, 'twice in one minute asks once');
  loggedIn = true; // the owner signs in through the terminal
  t += 61_000;
  const got = await c.forRepo(SLUG, 'ch1');
  assert.equal(got.ok ? got.lane : '', 'own');
  assert.equal(asked, 2);
});

test('the App lane carries the bot identity the route names, so a cloud machine can commit', async () => {
  const bot = { name: 'neuramesh[bot]', email: '331048932+neuramesh[bot]@users.noreply.github.com' };
  const r = route(() => ({ status: 200, body: { slug: SLUG, token: 'ghs_run_1', expiresAt: new Date(Date.now() + HOUR).toISOString(), identity: bot } }));
  const c = cred({ cloud: true, fetchFn: r.fetchFn });
  for (const round of [1, 2]) { // minted, then from the cache
    const got = await c.forRepo(SLUG, 'ch1');
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.env['GIT_AUTHOR_NAME'], bot.name, `round ${round}`);
    assert.equal(got.env['GIT_AUTHOR_EMAIL'], bot.email);
    assert.equal(got.env['GIT_COMMITTER_EMAIL'], bot.email);
  }
  assert.equal(r.calls.length, 1);
});

