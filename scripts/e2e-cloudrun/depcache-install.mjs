#!/usr/bin/env node
// THE HOST INSTALL CHECK (D17, round 8). On a dependency cache miss a Cloud Run machine installs the
// worktree's lockfile in the supervisor (scripts off, a scrubbed env, inside Bubblewrap), runs the
// lifecycle scripts in the box (`rebuild`), and stores the tree, so the next session hits. This drives
// the product path the way a client does, with one fixture repository per package manager:
//
//   fixture   a small repository made here for each manager (pnpm, npm, yarn): a package.json, a
//             lockfile that the cache has never seen (a nonce in it), a local tarball dependency
//             `nm-marker` whose postinstall records where it ran, and root lifecycle scripts that
//             record where they ran. The pnpm one also has esbuild, a real native postinstall.
//             Each is a `git bundle`, uploaded and linked like repo-bundle.mjs does
//   miss      a Code session opens: the tab hears `installing_dependencies` and then
//             `dependencies_ready`, both BEFORE `ready`
//   tree      a box terminal sees node_modules in the worktree
//   rebuild   the marker's postinstall ran IN THE BOX (its record names a /work cwd and no NM_ variable),
//             and for pnpm esbuild runs
//   scripts   no lifecycle script ran on the host: no record names an /nm/ cwd (the host path). The
//             root scripts would print the env if they ran on the host. They do run IN THE BOX: pnpm
//             rebuild and npm rebuild run the root project's install scripts too, as an install in the box
//             does (measured on r8-002: 4 root records for pnpm, 3 for npm, every one with a /work cwd)
//   envbox    (pnpm) the .npmrc env probe: pnpm expands the env in a scoped registry and records it in
//             node_modules/.modules.yaml. The box rebuild rewrites that file, so it shows the REBUILD's
//             env (no machine variable, HOME /tmp/nm-deps/home), not the host install's
//   logs      the machine's own log lines (Cloud Logging, the build's service account): each install,
//             its store, each hit with its time, and the sandbox probe (NM_E2E_MARKER=1): no NM_
//             variable, PID 1 is Bubblewrap's, no capability, none of machined's places visible
//   hit       a second session on the same lockfile (a new thread, a new worktree) opens with no install
//             status, and its worktree has node_modules: the first install was stored
//   park      every machine this script woke is parked at the end (unless NM_KEEP_AWAKE=1)
//
// Env:
//   NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET, NM_RELAY_URL, NM_RELAY_TOKEN_KEY  (cloudbuild-depcache-install.yaml)
//   DEPS_MANAGERS (default pnpm,npm,yarn)   OUT (default ./depcache-install-out)
//
// It needs NM_DEPCACHE=1 on the machines, NM_REPO_BUNDLES=1 on nm-api, and the machine image with pnpm
// and yarn (r8 or later). Node 24, git, npm and npx (for the lockfiles), no dependencies. The report
// never holds a secret or a signed URL.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { RelayConnection } from './lib/relay.mjs';
import { Api } from './lib/api.mjs';

const env = (k, d) => process.env[k] ?? d;
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`depcache-install: set ${k}`); process.exit(2); } return v; };
// --fixtures-only: make each fixture and install it here with the flags the machine uses (no machine,
// no secret). It proves the lockfiles install frozen with scripts off and that the rebuild runs the marker
const FIXTURES_ONLY = process.argv.includes('--fixtures-only');
const API = FIXTURES_ONLY ? null : new Api({ url: need('NM_API_URL'), fleetSecret: need('FLEET_SECRET'), actorSecret: env('NM_ACTOR_SECRET', '') });
const RELAY = FIXTURES_ONLY ? '' : need('NM_RELAY_URL');
const KEY = FIXTURES_ONLY ? '' : need('NM_RELAY_TOKEN_KEY');
const OUT = resolve(env('OUT', 'depcache-install-out'));
const MANAGERS = env('DEPS_MANAGERS', 'pnpm,npm,yarn').split(',').map((m) => m.trim()).filter(Boolean);
mkdirSync(OUT, { recursive: true });

const tag = `r8deps-${Date.now().toString(36)}`;
const nonce = randomBytes(4).toString('hex');
const t0 = Date.now();
const at = () => Number(((Date.now() - t0) / 1000).toFixed(1));
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, at: at(), ...(detail === undefined ? {} : { detail }) });
  const d = detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${d.length > 900 ? `${d.slice(0, 900)}…` : d}`);
  return !!ok;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = {};
let woke = false;
let relay = null;

// the record a lifecycle script writes: where it ran, how many NM_ variables it saw (never their
// values), and what PID 1 is. A host run shows an /nm/work cwd, a box run shows /work
const RECORD_JS = `const fs = require('fs');
const out = process.argv[2];
let pid1 = ''; try { pid1 = fs.readFileSync('/proc/1/cmdline', 'utf8').split('\\0').join(' ').trim().slice(0, 120); } catch (e) { pid1 = 'unreadable'; }
const nm = Object.keys(process.env).filter((k) => k.startsWith('NM_'));
fs.writeFileSync(out, JSON.stringify({ cwd: process.cwd(), nmVars: nm.length, nmNames: nm.slice(0, 8), pid1, home: process.env.HOME || '', event: process.env.npm_lifecycle_event || '' }) + '\\n');
`;

/** one fixture repository for a manager, with its lockfile made here, and its bundle file */
function makeFixture(pm) {
  const root = mkdtempSync(join(tmpdir(), `nm-deps-${pm}-`));
  const src = join(root, 'fixture');
  const marker = join(root, 'nm-marker');
  mkdirSync(src); mkdirSync(marker); mkdirSync(join(src, 'vendor'));
  const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_update_notifier: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  // the marker: a tarball dependency whose postinstall records where it ran
  writeFileSync(join(marker, 'package.json'), `${JSON.stringify({ name: 'nm-marker', version: '1.0.0', scripts: { postinstall: 'node record.js built.json' } }, null, 2)}\n`);
  writeFileSync(join(marker, 'record.js'), RECORD_JS);
  sh('npm', ['pack', '--pack-destination', join(src, 'vendor')], marker);
  const deps = { 'nm-marker': 'file:vendor/nm-marker-1.0.0.tgz', 'is-number': '7.0.0', ...(pm === 'pnpm' ? { esbuild: '0.25.0' } : {}) };
  // root lifecycle scripts: each records its env if it runs. On the host none may run
  const scripts = Object.fromEntries(['preinstall', 'install', 'postinstall', 'prepare'].map((s) => [s, `node record.js LEAK-${s}.json`]));
  const pkg = { name: `nm-deps-${pm}-${nonce}`, version: '1.0.0', private: true, scripts, dependencies: deps, ...(pm === 'pnpm' ? { pnpm: { onlyBuiltDependencies: ['esbuild', 'nm-marker'] } } : {}) };
  writeFileSync(join(src, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(join(src, 'record.js'), RECORD_JS);
  writeFileSync(join(src, 'README.md'), `# depcache fixture (${pm})\n\nnonce ${nonce}\n`);
  writeFileSync(join(src, '.gitignore'), 'node_modules/\n');
  // THE ENV PROBE (pnpm): pnpm expands the env in .npmrc and records the hoist pattern in
  // node_modules/.modules.yaml, so the install's own env shows there: HOME and PATH as the installer set
  // them, and whether a machine secret was present (`unset` when it was not). The check reads only
  // `unset` or not, never a value
  // a scoped registry nothing is fetched from: pnpm replaces the env in its value and records it in
  // .modules.yaml (`registries`)
  if (pm === 'pnpm') writeFileSync(join(src, '.npmrc'), `@nmprobe:registry=https://nmprobe.invalid/nmprobe-home=\${HOME}-path=\${PATH}-token=\${NM_MACHINE_TOKEN:-unset}-boot=\${NM_BOOT_CREDENTIAL:-unset}-api=\${NM_API_URL:-unset}-end/\n`);
  let lockfile;
  if (pm === 'pnpm') {
    sh('npx', ['-y', 'pnpm@10.8.1', 'install', '--lockfile-only', '--ignore-scripts'], src);
    lockfile = 'pnpm-lock.yaml';
    appendFileSync(join(src, lockfile), `# nm-e2e ${nonce}\n`); // a key the cache has never seen
  } else if (pm === 'npm') {
    sh('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], src);
    lockfile = 'package-lock.json'; // the name carries the nonce
  } else if (pm === 'yarn') {
    sh('npx', ['-y', 'yarn@1.22.22', 'install', '--ignore-scripts', '--no-default-rc', '--non-interactive'], src);
    rmSync(join(src, 'node_modules'), { recursive: true, force: true });
    lockfile = 'yarn.lock';
    appendFileSync(join(src, lockfile), `# nm-e2e ${nonce}\n`);
  } else throw new Error(`no fixture for ${pm}`);
  const git = (...args) => execFileSync('git', args, { cwd: src, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'e2e@neuramesh.invalid');
  git('config', 'user.name', 'NeuraMesh e2e');
  git('add', '-A');
  git('commit', '-m', `depcache fixture ${pm} ${nonce}`);
  const file = join(root, 'fixture.bundle');
  git('bundle', 'create', file, '--all');
  return { pm, root, file, lockfile, lockBytes: readFileSync(join(src, lockfile)).length, sha: git('rev-parse', 'HEAD') };
}

/** open a session on a new thread of the repo; resolves the ready event and the timed events before it */
async function openTimed(me, repo, label) {
  const thread = randomUUID();
  const rootId = randomUUID();
  await me.post('/v1/messages', { id: rootId, workspace: ids.workspace, channel: ids.channel, body: `Look at the ${label} fixture (${nonce}).`, threadId: thread, rootMessageId: rootId, threadKind: 'coding', threadMachineId: ids.machine, threadOrigin: 'web' });
  const meta = {
    threadId: thread, repoId: repo.id, repoName: repo.name, branch: 'main', mode: 'plan',
    permissions: { read: true, edit: false, command: false, web: false, mcp: false },
    policy: { read: true, edit: true, command: true, web: true, mcp: true },
    agentId: null, reasoningEffort: null, modelId: null, brainPack: null,
  };
  for (let attempt = 1; ; attempt++) {
    const sent = Date.now();
    const s = relay.engineering(meta);
    const timed = [];
    s.listeners.add((ev) => timed.push({ ms: Date.now() - sent, type: ev.type, ...(ev.type === 'status' ? { status: ev.status } : {}), ...(ev.type === 'error' ? { code: ev.code, message: String(ev.message).slice(0, 200) } : {}) }));
    const r = await s.waitFor((e) => e.type === 'ready' || e.type === 'error', 0, 420_000);
    if (r?.ev.type === 'ready') return { s, ready: r.ev, timed, thread, openMs: Date.now() - sent };
    const why = r?.ev ?? { closed: s.closed };
    if (attempt < 6 && /not in this project|SESSION_ACTIVE|still working/.test(JSON.stringify(why))) { s.close(); await sleep(10_000); continue; }
    throw new Error(`the ${label} session did not open: ${JSON.stringify(why).slice(0, 400)} events=${JSON.stringify(timed).slice(0, 400)}`);
  }
}

/** the machine's own log lines since `since` that match `text` (Cloud Logging, the build's service account) */
async function machineLogs(machine, text, since) {
  const project = env('PROJECT_ID', '');
  if (!project) return { error: 'no PROJECT_ID' };
  const tok = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } }).then((r) => r.json()).catch((e) => ({ error: e.message }));
  if (!tok.access_token) return { error: `no token: ${tok.error ?? 'none'}` };
  const filter = `resource.type="cloud_run_worker_pool" AND resource.labels.worker_pool_name="m-${machine}" AND textPayload:"${text}" AND timestamp>="${since}"`;
  const lines = [];
  let pageToken;
  do {
    const res = await fetch('https://logging.googleapis.com/v2/entries:list', { method: 'POST', headers: { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ resourceNames: [`projects/${project}`], filter, orderBy: 'timestamp asc', pageSize: 500, ...(pageToken ? { pageToken } : {}) }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { error: `HTTP ${res.status}: ${JSON.stringify(j).slice(0, 200)}` };
    for (const e of j.entries ?? []) lines.push(`${e.timestamp} ${e.textPayload ?? ''}`);
    pageToken = j.nextPageToken;
  } while (pageToken);
  return { lines };
}

const boxPath = (p) => p.replace(/^\/nm\/work/, '/work');
/** what the env probe recorded in .modules.yaml: the HOME and PATH of the install, and whether each
 *  machine variable was unset. A value that is not `unset` is reported as `PRESENT`, never as itself */
function envProbe(modulesYaml) {
  const m = /nmprobe-home=(.*?)-path=(.*?)-token=(.*?)-boot=(.*?)-api=(.*?)-end/.exec(modulesYaml);
  if (!m) return { read: false };
  const seen = (v) => (v === 'unset' ? 'unset' : 'PRESENT');
  return { read: true, home: m[1], path: m[2], NM_MACHINE_TOKEN: seen(m[3]), NM_BOOT_CREDENTIAL: seen(m[4]), NM_API_URL: seen(m[5]) };
}
const parseJson = (s) => { try { return JSON.parse(s.trim().split('\n').filter(Boolean).pop() ?? ''); } catch { return null; } };

const report = { tag, nonce, managers: MANAGERS, startedAt: new Date().toISOString(), ids, runs: {}, checks };
const fixtures = [];

/** the machine's install, without Bubblewrap: the flags of cloudrun/depinstall.ts planInstall (keep in step) */
function localInstall(f) {
  const dir = join(f.root, 'clone');
  execFileSync('git', ['clone', '-q', f.file, dir]);
  const scratch = join(f.root, 'scratch');
  for (const d of ['home', 'store', 'cache']) mkdirSync(join(scratch, d), { recursive: true });
  const clean = { PATH: process.env.PATH, HOME: join(scratch, 'home'), CI: '1', npm_config_ignore_scripts: 'true', npm_config_update_notifier: 'false', npm_config_manage_package_manager_versions: 'false', YARN_IGNORE_PATH: '1' };
  const run = (cmd, args, e = clean) => execFileSync(cmd, args, { cwd: dir, env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // the box's rebuild env (depinstall.ts boxRebuilder): scripts are on there
  const boxEnv = { PATH: process.env.PATH, HOME: join(scratch, 'box-home'), CI: '1', npm_config_update_notifier: 'false' };
  const store = join(scratch, 'store'); const cache = join(scratch, 'cache');
  const t = Date.now();
  if (f.pm === 'pnpm') run('npx', ['-y', 'pnpm@10.8.1', 'install', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile', '--reporter=append-only', '--store-dir', store, '--config.modules-dir=node_modules', '--config.virtual-store-dir=node_modules/.pnpm', '--config.manage-package-manager-versions=false', '--config.package-manager-strict=false', '--config.side-effects-cache=false']);
  if (f.pm === 'npm') run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--no-update-notifier', '--cache', cache, '--git=/bin/false', '--loglevel=warn']);
  if (f.pm === 'yarn') run('npx', ['-y', 'yarn@1.22.22', 'install', '--frozen-lockfile', '--ignore-scripts', '--non-interactive', '--no-progress', '--no-default-rc', '--cache-folder', cache]);
  const installMs = Date.now() - t;
  const leaksAfterInstall = execFileSync('bash', ['-c', `find ${dir} -name 'LEAK-*.json' -o -name built.json | grep -v /.git/ || true`], { encoding: 'utf8' }).trim();
  const hasTree = execFileSync('bash', ['-c', `test -d ${dir}/node_modules/is-number && echo yes || echo no`], { encoding: 'utf8' }).trim() === 'yes';
  // the rebuild the box runs
  const probe = f.pm === 'pnpm' ? envProbe(readFileSync(join(dir, 'node_modules', '.modules.yaml'), 'utf8')) : null;
  if (f.pm === 'pnpm') run('npx', ['-y', 'pnpm@10.8.1', 'rebuild', '--store-dir', store, '--config.side-effects-cache=false', '--config.manage-package-manager-versions=false'], boxEnv);
  else run('npm', ['rebuild', '--no-audit', '--no-fund'], boxEnv);
  let marker = null; try { marker = JSON.parse(readFileSync(join(dir, 'node_modules', 'nm-marker', 'built.json'), 'utf8')); } catch { /* none */ }
  return { installMs, hasTree, leaksAfterInstall, marker, probe };
}

if (FIXTURES_ONLY) {
  for (const pm of MANAGERS) {
    try {
      const f = makeFixture(pm);
      fixtures.push(f);
      const r = localInstall(f);
      report.runs[pm] = r;
      check(`${pm}: the fixture installs frozen with scripts off (no script ran), and the rebuild runs the marker`, r.hasTree && r.leaksAfterInstall === '' && !!r.marker && (pm !== 'pnpm' || (r.probe?.read === true && r.probe.NM_MACHINE_TOKEN === 'unset' && !r.probe.home.includes('$'))), r);
    } catch (e) { check(`${pm}: the fixture installs frozen with scripts off`, false, String(e?.stderr ?? e?.message ?? e).slice(0, 900)); }
  }
  for (const f of fixtures) rmSync(f.root, { recursive: true, force: true });
  writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`== ${checks.length - failed} passed, ${failed} failed (${at()}s)`);
  process.exit(failed ? 1 : 0);
}

try {
  // ---- fixtures
  for (const pm of MANAGERS) {
    try {
      const f = makeFixture(pm);
      fixtures.push(f);
      check(`${pm}: a fixture repository with a fresh lockfile is bundled`, true, { lockfile: f.lockfile, lockBytes: f.lockBytes, sha: f.sha });
    } catch (e) { check(`${pm}: a fixture repository with a fresh lockfile is bundled`, false, String(e?.stderr ?? e?.message ?? e).slice(0, 600)); }
  }

  // ---- setup: a fresh person and workspace, born with its runner
  const w = await API.freshWorkspace(tag);
  Object.assign(ids, { user: w.userId, workspace: w.workspaceId, channel: w.channelId, machine: w.machineId });
  woke = true;
  const me = API.as(ids.user);
  const repos = [];
  for (const f of fixtures) {
    const name = `deps-${f.pm}`;
    const signed = await me.post('/v1/repos/bundles/sign', { workspace: ids.workspace, name });
    const put = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body: readFileSync(f.file), signal: AbortSignal.timeout(120_000) });
    if (!put.ok) { check(`${f.pm}: the bundle uploads`, false, { status: put.status }); continue; }
    const id = (await me.cmd({ type: 'repo.link', workspace: ids.workspace, channel: ids.channel, url: signed.cloneUrl, name, defaultBranch: 'main' })).repoId;
    repos.push({ pm: f.pm, id, name, lockfile: f.lockfile });
  }
  check('every fixture is uploaded and linked', repos.length === fixtures.length && repos.length > 0, repos.map((r) => ({ pm: r.pm, repo: r.id })));
  const awake = await API.running(ids.machine);
  check('the machine runs on Cloud Run', awake.substrate === 'cloudrun' && awake.epoch >= 1, { epoch: awake.epoch, size: awake.size_class });
  ids.epoch = awake.epoch;
  relay = await RelayConnection.open({ url: RELAY, key: KEY, user: ids.user, machine: ids.machine });

  // ---- miss: the first session per manager installs on the host
  for (const repo of repos) {
    const run = (report.runs[repo.pm] = {});
    let opened;
    try { opened = await openTimed(me, repo, repo.pm); } catch (e) { check(`${repo.pm}: the first session opens`, false, e.message); continue; }
    const { s, ready, timed } = opened;
    const cwd = ready.cwd;
    const idx = (pred) => timed.findIndex(pred);
    const iStart = idx((e) => e.type === 'status' && e.status === 'installing_dependencies');
    const iEnd = idx((e) => e.type === 'status' && e.status === 'dependencies_ready');
    const iReady = idx((e) => e.type === 'ready');
    run.miss = { openMs: opened.openMs, installMs: iStart >= 0 && iEnd >= 0 ? timed[iEnd].ms - timed[iStart].ms : null, cwd, events: timed.slice(0, iReady + 1) };
    check(`${repo.pm}: the tab hears installing_dependencies, then dependencies_ready, before ready`, iStart >= 0 && iStart < iEnd && iEnd < iReady,
      { installMs: run.miss.installMs, openMs: opened.openMs, events: timed.slice(0, iReady + 1).map((e) => `${e.ms}ms ${e.type}${e.status ? `:${e.status}` : ''}`) });
    // the box sees the worktree at /work
    const term = await relay.terminal();
    const b = boxPath(cwd);
    const ls = await term.run(`ls ${b}/node_modules | head -20; test -d ${b}/node_modules/is-number && echo HAS-IS-NUMBER`);
    check(`${repo.pm}: node_modules is in the worktree, seen from the box`, ls.out.includes('HAS-IS-NUMBER'), { out: ls.out.trim().slice(0, 300) });
    const built = await term.run(`cat ${b}/node_modules/nm-marker/built.json 2>&1`);
    const rec = parseJson(built.out);
    run.marker = rec;
    check(`${repo.pm}: the rebuild ran the dependency's postinstall in the box (a /work cwd, no NM_ variable)`, !!rec && rec.cwd.startsWith('/work/') && rec.nmVars === 0, rec ?? built.out.slice(0, 300));
    const leaks = await term.run(`for f in $(find ${b} -name 'LEAK-*.json' -not -path '*/.git/*' 2>/dev/null); do echo "$f $(cat $f)"; done; echo LEAKS-END`);
    const leakLines = leaks.out.split('\n').filter((l) => l.includes('LEAK-'));
    const hostRuns = leakLines.filter((l) => /"cwd":"\/nm\//.test(l));
    run.rootScripts = leakLines.map((l) => l.slice(0, 300));
    check(`${repo.pm}: no lifecycle script ran on the host (no record with an /nm/ cwd)`, hostRuns.length === 0 && !(rec && rec.cwd.startsWith('/nm/')),
      { hostRuns, boxRootScripts: leakLines.length });
    if (repo.pm === 'pnpm') {
      const yaml = await term.run(`grep -o 'nmprobe-.*-end' ${b}/node_modules/.modules.yaml | head -1`);
      const probe = envProbe(yaml.out);
      run.envProbe = probe;
      // the box rebuild rewrites .modules.yaml, so this is the rebuild's env (the host's is in the probe log line)
      check('pnpm: the rebuild in the box saw no machine variable (the .npmrc env probe, HOME /tmp/nm-deps/home)',
        probe.read && probe.NM_MACHINE_TOKEN === 'unset' && probe.NM_BOOT_CREDENTIAL === 'unset' && probe.NM_API_URL === 'unset' && probe.home === '/tmp/nm-deps/home', probe);
      const es = await term.run(`${b}/node_modules/.bin/esbuild --version 2>&1; head -c 4 ${b}/node_modules/esbuild/bin/esbuild | od -c | head -1`);
      run.esbuild = es.out.trim().slice(0, 200);
      check('pnpm: esbuild (a native postinstall) runs in the box', /\b0\.25\.0\b/.test(es.out), { out: run.esbuild });
    }
    term.close();
    s.close();
  }

  // ---- hit: the stored tree comes back for a new worktree, with no install
  await sleep(45_000); // the store runs behind the first session
  for (const repo of repos) {
    const run = report.runs[repo.pm] ?? (report.runs[repo.pm] = {});
    let opened;
    try { opened = await openTimed(me, repo, `${repo.pm} (second)`); } catch (e) { check(`${repo.pm}: the second session opens`, false, e.message); continue; }
    const { s, ready, timed } = opened;
    const iReady = timed.findIndex((e) => e.type === 'ready');
    const installed = timed.slice(0, iReady).some((e) => e.type === 'status' && /installing_dependencies/.test(e.status ?? ''));
    const term = await relay.terminal();
    const b = boxPath(ready.cwd);
    const ls = await term.run(`test -d ${b}/node_modules/is-number && echo HAS-IS-NUMBER; cat ${b}/node_modules/nm-marker/built.json 2>/dev/null | head -c 200`);
    term.close();
    run.hit = { openMs: opened.openMs, cwd: ready.cwd, installed };
    check(`${repo.pm}: a second session on the same lockfile hits the cache (no install status, node_modules there)`, !installed && ready.cwd !== run.miss?.cwd && ls.out.includes('HAS-IS-NUMBER'),
      { openMs: opened.openMs, missOpenMs: run.miss?.openMs, installMs: run.miss?.installMs, newWorktree: ready.cwd !== run.miss?.cwd, marker: ls.out.includes('"cwd"'), events: timed.slice(0, iReady + 1).map((e) => `${e.ms}ms ${e.type}${e.status ? `:${e.status}` : ''}`) });
    s.close();
  }

  // ---- logs: what the machine itself said (ingestion lags a few seconds)
  let logs = { lines: [] };
  // complete when each manager has its install, its store and its later hit. Cloud Logging makes a line
  // queryable some seconds after it is received, so the hits of the second sessions come last (r8-003:
  // the first read had 19 of 22 lines, with no hit)
  const want = (l) => repos.every((r) => {
    const key = l.map((x) => x.match(new RegExp(`depcache installed (\\S+): ${r.pm}, `))?.[1]).find(Boolean);
    return !!key && l.some((x) => x.includes(`depcache saved ${key}:`)) && l.some((x) => x.includes(`depcache hit ${key}:`));
  });
  for (let i = 0; i < 18; i++) { logs = await machineLogs(ids.machine, 'depcache', report.startedAt); if (logs.error || want(logs.lines ?? [])) break; await sleep(5_000); }
  report.machineLogs = logs.lines ?? logs;
  check('the machine\'s depcache log lines are readable', !logs.error, logs.error ?? { lines: logs.lines.length });
  const L = logs.lines ?? [];
  for (const repo of repos) {
    const installed = L.find((l) => new RegExp(`depcache installed \\S+: ${repo.pm}, `).test(l));
    const key = installed?.match(/depcache installed (\S+):/)?.[1];
    const saved = key ? L.find((l) => l.includes(`depcache saved ${key}:`)) : null;
    const hit = key ? L.find((l) => l.includes(`depcache hit ${key}:`)) : null;
    const run = report.runs[repo.pm] ?? (report.runs[repo.pm] = {});
    const body = (l) => l?.replace(/^\S+ /, '');
    run.log = { key, installed: body(installed), saved: body(saved), hit: body(hit),
      installMs: Number(installed?.match(/ in (\d+)ms, rebuild/)?.[1] ?? NaN), savedBytes: Number(saved?.match(/, (\d+) bytes/)?.[1] ?? NaN), hitMs: Number(hit?.match(/tree\(s\) in (\d+)ms/)?.[1] ?? NaN) };
    check(`${repo.pm}: the machine logged the install with the rebuild ok, the store, and the later hit`, !!installed && /rebuild ok/.test(installed) && !!saved && !!hit, run.log);
  }
  const probes = L.filter((l) => l.includes('depcache install sandbox probe:'));
  const bad = probes.filter((l) => !/exit 0 nm_vars=0 /.test(l) || !/ pid1=\S*bwrap/.test(l) || !/ capeff=0+ /.test(l) || / sees=\/(app|nm\/home|nm\/state|nm\/secrets|secrets|root|sys)/.test(l));
  report.sandboxProbe = probes.map((l) => l.replace(/^\S+ /, ''));
  check('the install sandbox probe (NM_E2E_MARKER): no NM_ variable, PID 1 is bwrap, no capability, none of machined\'s places', probes.length >= repos.length && bad.length === 0,
    { probes: probes.length, bad: bad.map((l) => l.replace(/^\S+ /, '').slice(0, 700)), first: probes[0]?.replace(/^\S+ /, '').slice(0, 700) });
} catch (e) {
  check('the host install check ran to the end', false, String(e?.stack ?? e).slice(0, 800));
} finally {
  relay?.close();
  for (const f of fixtures) rmSync(f.root, { recursive: true, force: true });
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
