// the machine's own gh login, asked live (host/reporead.ts ghLive): a `gh auth login` made while the
// daemon runs counts for the readers and the readability check within a minute. They kept the first
// `gh auth status` answer until a restart, so the login the refusal advised never counted. The clock
// is a stub, and gh is a stand-in on PATH, the way orchturn-cloud.test.ts stands in a CLI.
// Run: pnpm exec tsx --test src/main/host/reporead-login.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liveCheck, makeRepoReader } from './reporead';
import { repoReadable } from './reponeed';

const GITHUB = { id: 'r2', org_name: 'acme', name: 'site', clone_url: 'https://github.com/acme/site.git', local_path: null, provider: 'github' };
// no connector: the room reads through this machine's gh, or not at all
const db = { getAll: async <T,>(sql: string): Promise<T[]> => (/from connectors/.test(sql) ? [{ n: 0 }] : /from repos/.test(sql) ? [GITHUB] : []) as T[] };
const apiGet = async (): Promise<never> => { throw new Error('the connector is not asked without a connector row'); };

test('the check is asked live and kept a minute: an answer stays for its minute, then it asks again', async () => {
  let now = 0;
  let asked = 0;
  let login = false;
  const check = liveCheck(async () => { asked++; return login; }, () => now);
  assert.equal(await check(), false);
  login = true; // the person runs `gh auth login`
  now = 59_000;
  assert.equal(await check(), false, 'the no stays for its minute');
  now = 60_001;
  assert.equal(await check(), true, 'the login counts once the minute ends');
  now = 200_000;
  await Promise.all([check(), check()]);
  assert.equal(asked, 3, 'two reads at once share one ask');
  assert.equal(await liveCheck(async () => { throw new Error('no gh here'); })(), false, 'a check that fails reads as no');
});

test('the readers and the readability check see a gh login made after their first read', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nm-gh-live-'));
  const flag = join(root, 'logged-in');
  // the stand-in: `auth status` passes once the flag file exists, and `api` answers one tree
  writeFileSync(join(root, 'gh'), `#!/bin/sh\nif [ "$1" = "auth" ]; then [ -f "${flag}" ]; exit $?; fi\necho '{"tree":[{"path":"README.md","type":"blob","size":12}],"truncated":false}'\n`);
  chmodSync(join(root, 'gh'), 0o755);
  const saved = { PATH: process.env['PATH'], NM_GH_FAKE: process.env['NM_GH_FAKE'] };
  process.env['PATH'] = `${root}:${saved.PATH ?? ''}`;
  delete process.env['NM_GH_FAKE'];
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  try {
    const reader = makeRepoReader({ apiGet, actor: { kind: 'agent', id: 'rex' }, db, channelId: 'ch' });
    assert.deepEqual(await repoReadable(db, 'ch'), { ok: false, repoName: 'site' });
    assert.match(await reader.tree({}), /this machine has no GitHub login/);
    writeFileSync(flag, ''); // the person runs `gh auth login` in a terminal
    skew = 60_001;
    assert.deepEqual(await repoReadable(db, 'ch'), { ok: true, repoName: 'site' });
    assert.equal(await reader.tree({}), 'acme/site · (root) @ HEAD · 1 entries\nREADME.md (12 B)');
  } finally {
    Date.now = realNow;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(root, { recursive: true, force: true });
  }
});
