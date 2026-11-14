#!/usr/bin/env node
// THE REPOSITORY BUNDLE CHECK (round 6). A repository that is not on GitHub reaches a Cloud Run machine
// as a `git bundle` in GCS (control-api repo-bundles.ts, NM_REPO_BUNDLES=1), and a Code session works on
// it with no GitHub App. It drives the product path the way a client does:
//
//   fixture   a small repository made here (git init, one commit with a nonce, a pnpm lockfile), and
//             `git bundle create --all` of it
//   setup     a fresh e2e person and workspace (born with its runner), funded
//   sign      POST /v1/repos/bundles/sign as the member: a signed PUT under the workspace's repos/
//             prefix. A person outside the workspace is refused.
//   upload    PUT the bundle file to the signed URL, with the signed content type
//   link      repo.link {url: nm-bundle:<key>} records the row. A key with no upload is refused.
//   open      a Code session on that repository answers `ready` in a worktree under /nm/work, with no
//             GitHub card (ENGINEERING_GITHUB_REQUIRED)
//   clone     a box terminal reads the nonce from the worktree's README, and the cache clone names
//             nm-bundle:<key> as its origin
//   park      every machine this script woke is parked at the end
//
// Env:
//   NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET, NM_RELAY_URL, NM_RELAY_TOKEN_KEY   (cloudbuild-repo-bundle.yaml)
//   OUT (default ./repo-bundle-out)
//
// It needs a deploy with NM_REPO_BUNDLES=1 and NM_SNAPSHOT_GCS_BUCKET on nm-api (scripts/e2e-cloudrun/README.md).
// Node 24 and git, no dependencies. The report never holds a secret or a signed URL.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { RelayConnection } from './lib/relay.mjs';
import { Api } from './lib/api.mjs';

const env = (k, d) => process.env[k] ?? d;
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`repo-bundle: set ${k}`); process.exit(2); } return v; };
const API = new Api({ url: need('NM_API_URL'), fleetSecret: need('FLEET_SECRET'), actorSecret: env('NM_ACTOR_SECRET', '') });
const RELAY = need('NM_RELAY_URL');
const KEY = need('NM_RELAY_TOKEN_KEY');
const OUT = resolve(env('OUT', 'repo-bundle-out'));
mkdirSync(OUT, { recursive: true });

const tag = `r6repos-bundle-${Date.now().toString(36)}`;
const nonce = randomBytes(4).toString('hex');
const t0 = Date.now();
const at = () => Number(((Date.now() - t0) / 1000).toFixed(1));
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, at: at(), ...(detail === undefined ? {} : { detail }) });
  const d = detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${d.length > 600 ? `${d.slice(0, 600)}…` : d}`);
  return !!ok;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = {};
let woke = false;
let relay = null;

/** a repository with one commit, as a person's laptop holds it, and its bundle file */
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'nm-fixture-'));
  const src = join(root, 'fixture');
  mkdirSync(src);
  const git = (...args) => execFileSync('git', args, { cwd: src, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'e2e@neuramesh.invalid');
  git('config', 'user.name', 'NeuraMesh e2e');
  writeFileSync(join(src, 'README.md'), `# bundle fixture\n\nnonce ${nonce}\n`);
  writeFileSync(join(src, 'package.json'), `${JSON.stringify({ name: 'nm-bundle-fixture', version: '1.0.0', private: true }, null, 2)}\n`);
  // a lockfile with no dependencies: the dependency cache keys on it, and nothing needs the network
  writeFileSync(join(src, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .: {}\n");
  writeFileSync(join(src, '.gitignore'), 'node_modules/\n');
  git('add', '-A');
  git('commit', '-m', `fixture ${nonce}`);
  const sha = git('rev-parse', 'HEAD');
  const file = join(root, 'fixture.bundle');
  git('bundle', 'create', file, '--all');
  git('bundle', 'verify', file);
  return { root, file, sha };
}

/** open a session on the thread; resolves the ready event (or throws with the lane's error) */
async function openSession(meta) {
  for (let attempt = 1; ; attempt++) {
    const s = relay.engineering(meta);
    const r = await s.waitFor((e) => e.type === 'ready' || e.type === 'error', 0, 180_000);
    if (r?.ev.type === 'ready') return { s, ready: r.ev };
    const why = r?.ev ?? { closed: s.closed };
    // the replica may not carry the new repo row yet ("is not in this project on this machine")
    if (attempt < 6 && /not in this project|SESSION_ACTIVE|still working/.test(JSON.stringify(why))) { s.close(); await sleep(10_000); continue; }
    throw Object.assign(new Error(`the session did not open: ${JSON.stringify(why).slice(0, 400)}`), { why });
  }
}

const report = { tag, startedAt: new Date().toISOString(), ids, checks };
let fixture = null;
try {
  // ---- fixture
  fixture = makeFixture();
  const bytes = readFileSync(fixture.file);
  check('a fixture repository is bundled', bytes.length > 0, { sha: fixture.sha, bytes: bytes.length });

  // ---- setup
  const w = await API.freshWorkspace(tag);
  Object.assign(ids, { user: w.userId, workspace: w.workspaceId, channel: w.channelId, machine: w.machineId });
  woke = true; // a fresh runner is born awake: this script woke it
  const me = API.as(ids.user);

  // ---- sign
  const { userId: strangerId } = await API.door('POST', '/internal/e2e/users', { email: `${tag}-stranger@e2e.invalid` });
  const refused = await API.as(strangerId).call('POST', '/v1/repos/bundles/sign', { body: { workspace: ids.workspace, name: 'fixture' }, ok: false });
  check('a person outside the workspace cannot sign an upload into it', refused.status === 403, { status: refused.status, code: refused.json?.code });
  const signed = await me.post('/v1/repos/bundles/sign', { workspace: ids.workspace, name: 'fixture' });
  ids.key = signed.key;
  const object = new URL(signed.url).pathname;
  check('the member gets a signed PUT under the workspace\'s repos/ prefix', signed.method === 'PUT' && object.endsWith(`/v1/workspaces/${ids.workspace}/repos/${signed.key}.bundle`) && signed.cloneUrl === `nm-bundle:${signed.key}`,
    { key: signed.key, cloneUrl: signed.cloneUrl, object, headers: signed.headers });

  // ---- upload
  const put = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body: bytes, signal: AbortSignal.timeout(120_000) });
  check('the bundle uploads to GCS through the signed URL', put.ok, { status: put.status, body: put.ok ? undefined : (await put.text()).slice(0, 300) });

  // ---- link
  const ghost = await me.call('POST', '/v1/commands', { body: { type: 'repo.link', workspace: ids.workspace, channel: ids.channel, url: `nm-bundle:${signed.key}x`, name: 'ghost' }, ok: false });
  check('repo.link refuses a key with no upload', ghost.status >= 400, { status: ghost.status, code: ghost.json?.code });
  ids.repo = (await me.cmd({ type: 'repo.link', workspace: ids.workspace, channel: ids.channel, url: signed.cloneUrl, name: 'fixture', defaultBranch: 'main' })).repoId;
  check('repo.link records the bundle row', !!ids.repo, { repo: ids.repo });

  // ---- open
  const awake = await API.running(ids.machine);
  check('the machine runs on Cloud Run', awake.substrate === 'cloudrun' && awake.epoch >= 1, { epoch: awake.epoch, size: awake.size_class });
  ids.thread = randomUUID();
  const rootId = randomUUID();
  await me.post('/v1/messages', { id: rootId, workspace: ids.workspace, channel: ids.channel, body: `Read README.md of the fixture (${nonce}).`, threadId: ids.thread, rootMessageId: rootId, threadKind: 'coding', threadMachineId: ids.machine, threadOrigin: 'web' });
  relay = await RelayConnection.open({ url: RELAY, key: KEY, user: ids.user, machine: ids.machine });
  const meta = {
    threadId: ids.thread, repoId: ids.repo, repoName: 'fixture', branch: 'main', mode: 'plan',
    permissions: { read: true, edit: false, command: false, web: false, mcp: false },
    policy: { read: true, edit: true, command: true, web: true, mcp: true },
    agentId: null, reasoningEffort: null, modelId: null, brainPack: null,
  };
  let opened = null;
  try { opened = await openSession(meta); } catch (e) {
    check('a Code session opens on the bundle repository, with no GitHub card', false, { error: e.message, githubCard: /ENGINEERING_GITHUB_REQUIRED/.test(JSON.stringify(e.why ?? '')) });
  }
  if (opened) {
    ids.cwd = opened.ready.cwd;
    check('a Code session opens on the bundle repository, in a worktree under /nm/work', /^\/nm\/work\/brain\/cache\/worktrees\//.test(ids.cwd ?? ''), { cwd: ids.cwd, provider: opened.ready.provider });

    // ---- clone
    // the box sees the machine's /nm/work at /work (cloudrun/box-terminal.ts)
    const boxCwd = ids.cwd.replace(/^\/nm\/work/, '/work');
    const clone = `/work/brain/cache/repos/${ids.repo}`;
    const term = await relay.terminal();
    const readme = await term.run(`cat ${boxCwd}/README.md`);
    const config = await term.run(`cat ${clone}/.git/config`);
    const head = await term.run(`cat ${clone}/.git/refs/remotes/origin/main 2>/dev/null || grep refs/remotes/origin/main ${clone}/.git/packed-refs`);
    term.close();
    check('the worktree holds the uploaded commit (the README nonce)', readme.out.includes(`nonce ${nonce}`), { out: readme.out.slice(-300) });
    check('the cache clone names nm-bundle:<key> as origin, at the uploaded commit', config.out.includes(`nm-bundle:${ids.key}`) && head.out.includes(fixture.sha),
      { origin: config.out.includes(`nm-bundle:${ids.key}`), head: head.out.trim().slice(-80), sha: fixture.sha });
    opened.s.close();
  }
} catch (e) {
  check('the repository bundle check ran to the end', false, String(e?.stack ?? e).slice(0, 800));
} finally {
  relay?.close();
  if (fixture) rmSync(fixture.root, { recursive: true, force: true });
  if (woke && ids.machine && env('NM_KEEP_AWAKE') !== '1') {
    try { const m = await API.park(ids.machine); report.parked = { epoch: m.epoch }; console.log(`  parked ${ids.machine} at epoch ${m.epoch}`); }
    catch (e) { console.log(`  WARN the machine did not park: ${e.message}`); report.parked = { error: e.message }; }
  }
}
report.seconds = at();
writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const failed = checks.filter((c) => !c.ok).length;
console.log(`== ${checks.length - failed} passed, ${failed} failed (${at()}s)`);
process.exit(failed ? 1 : 0);
