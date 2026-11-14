#!/usr/bin/env node
// THE SCRATCH WORKSPACE CHECK (round 9, 0177). A coding thread with no repository on a Cloud Run machine,
// driven the way hq drives it, with no intake: the root message births the thread with
// `threadKind: 'coding', threadWorkspace: 'scratch'` on a fresh workspace whose project has no repository.
//
//   setup     a fresh e2e person and workspace (born with its runner), no repo.link at all
//   birth     POST /v1/messages births a coding thread with workspace_mode scratch (read back from the
//             replica bootstrap the way a client reads it)
//   open      the engineering lane opens with repoId `scratch` and answers `ready` in a worktree under
//             /nm/work/brain/cache/worktrees/engineering-<actor>-scratch-...
//   repo      a box terminal sees a git repository with one first commit, no remote, and the thread id
//             in its config (nm.thread)
//   act       the starter brain makes index.html (a palindrome checker): a `changes` event names it
//   preview   preview_file returns the page (the door the hq preview frame reads)
//   reuse     a second channel on the same thread lands in the same worktree, with index.html
//   drain     (--drain) the machine parks: the work snapshot holds the scratch worktree with index.html.
//             It wakes: a reopen lands in the same worktree, and the file is still there
//   park      every machine this script woke is parked at the end (unless NM_KEEP_AWAKE=1)
//
//   NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET, NM_RELAY_URL, NM_RELAY_TOKEN_KEY  (cloudbuild-scratch-session.yaml)
//   OUT (default ./scratch-session-out)
//
// It needs nm-api and the machine image from r9-scratch or later. Node 24, no dependencies.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { RelayConnection } from './lib/relay.mjs';
import { Api, tarEntries } from './lib/api.mjs';

const env = (k, d) => process.env[k] ?? d;
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`scratch-session: set ${k}`); process.exit(2); } return v; };
const API = new Api({ url: need('NM_API_URL'), fleetSecret: need('FLEET_SECRET'), actorSecret: env('NM_ACTOR_SECRET', '') });
const RELAY = need('NM_RELAY_URL');
const KEY = need('NM_RELAY_TOKEN_KEY');
const OUT = resolve(env('OUT', 'scratch-session-out'));
const DRAIN = process.argv.includes('--drain');
mkdirSync(OUT, { recursive: true });

const tag = `r9scratch-${Date.now().toString(36)}`;
const nonce = randomBytes(3).toString('hex');
const t0 = Date.now();
const at = () => Number(((Date.now() - t0) / 1000).toFixed(1));
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, at: at(), ...(detail === undefined ? {} : { detail }) });
  const d = detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${d.length > 700 ? `${d.slice(0, 700)}…` : d}`);
  return !!ok;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = {};
let woke = false;
let relay = null;

const turnOver = (e) => e.type === 'ended' || (e.type === 'status' && e.status === 'idle');
const changedPaths = (s, from = 0) => s.events.slice(from).filter((e) => e.type === 'changes').flatMap((e) => e.changes.map((c) => c.path));
const boxPath = (p) => p.replace(/^\/nm\/work/, '/work');

async function openSession(meta) {
  for (let attempt = 1; ; attempt++) {
    const sent = Date.now();
    const s = relay.engineering(meta);
    const r = await s.waitFor((e) => e.type === 'ready' || e.type === 'error', 0, 180_000);
    if (r?.ev.type === 'ready') return { s, ready: r.ev, openMs: Date.now() - sent };
    const why = r?.ev ?? { closed: s.closed };
    if (attempt < 6 && /not in this project|SESSION_ACTIVE|still working/.test(JSON.stringify(why))) { s.close(); await sleep(10_000); continue; }
    throw new Error(`the session did not open: ${JSON.stringify(why).slice(0, 400)}`);
  }
}

async function prompt(s, text, ms = 240_000) {
  const from = s.events.length;
  s.command({ type: 'prompt', prompt: text });
  // approve what asks (edit approvals), up to 6, until the turn is over
  for (let cursor = from, n = 0; ;) {
    const r = await s.waitFor((e) => turnOver(e) || e.type === 'approval' || (e.type === 'error' && !e.recoverable), cursor, ms);
    if (!r || r.ev.type !== 'approval' || ++n > 6) return { from, end: r?.ev ?? null };
    s.command({ type: 'approval', approvalId: r.ev.approvalId, approved: true });
    cursor = r.index + 1;
  }
}

const report = { tag, nonce, startedAt: new Date().toISOString(), ids, checks };
try {
  // ---- setup and birth
  const w = await API.freshWorkspace(tag);
  Object.assign(ids, { user: w.userId, workspace: w.workspaceId, channel: w.channelId, machine: w.machineId });
  woke = true;
  const me = API.as(ids.user);
  ids.thread = randomUUID();
  const rootId = randomUUID();
  const ask = `Build a palindrome html app (${nonce}).`;
  await me.post('/v1/messages', { id: rootId, workspace: ids.workspace, channel: ids.channel, body: ask, threadId: ids.thread, rootMessageId: rootId, threadKind: 'coding', threadWorkspace: 'scratch', threadMachineId: ids.machine, threadOrigin: 'web' });
  let row = null;
  for (let i = 0; i < 6 && !row; i++) {
    const boot = await me.get(`/v1/brain/replica/bootstrap?workspace=${ids.workspace}`).catch(() => ({}));
    row = (boot.changes ?? []).find((c) => c.table === 'threads' && c.id === ids.thread)?.row ?? null;
    // the thread's project, as hq passes it when it opens the session (r9-002: the machine refused it)
    ids.project = row?.project_id ?? (boot.changes ?? []).find((c) => c.table === 'channels' && c.id === ids.channel)?.row?.project_id ?? null;
    if (!row) await sleep(3_000);
  }
  check('the root message births a coding thread with workspace_mode scratch, on a project with no repository', row?.kind === 'coding' && row?.workspace_mode === 'scratch', { kind: row?.kind, workspace_mode: row?.workspace_mode });
  const awake = await API.running(ids.machine);
  check('the machine runs on Cloud Run', awake.substrate === 'cloudrun' && awake.epoch >= 1, { epoch: awake.epoch });

  // ---- open
  relay = await RelayConnection.open({ url: RELAY, key: KEY, user: ids.user, machine: ids.machine });
  const PERM = { read: true, edit: true, command: false, web: false, mcp: false };
  const POLICY = { read: true, edit: true, command: true, web: true, mcp: true };
  // hq opens a scratch session with the scratch id AND the thread's project (CodingThread.tsx adopt)
  const meta = { threadId: ids.thread, ...(ids.project ? { projectId: ids.project } : {}), repoId: 'scratch', repoName: 'Scratch workspace', branch: 'main', mode: 'act', permissions: PERM, policy: POLICY, agentId: null, reasoningEffort: null, modelId: null, brainPack: null };
  let { s, ready, openMs } = await openSession(meta);
  ids.cwd = ready.cwd;
  check('the session opens with the thread\'s project set, as hq opens it', !!ids.project, { project: ids.project });
  check('the session opens in a scratch worktree under /nm/work', /^\/nm\/work\/brain\/cache\/worktrees\/engineering-.+-scratch-[a-z0-9-]+-[0-9a-f]{8}-/.test(ready.cwd ?? ''), { cwd: ready.cwd, openMs, provider: ready.provider });

  // ---- repo
  const b = boxPath(ids.cwd);
  let term = await relay.terminal();
  const facts = await term.run(`git -C ${b} rev-list --count HEAD; echo "remotes=[$(git -C ${b} remote)]"; git -C ${b} config --get nm.thread; git -C ${b} rev-parse --abbrev-ref HEAD; cat ${b}/.gitignore`);
  // the box's view of the host work path: a repository session's worktree has an absolute git pointer
  // (/nm/work/...) and needs this alias in the box. The scratch pointer is relative and does not (r9-002)
  const alias = await term.run('ls -ld /nm/work 2>&1; readlink /nm/work 2>&1 || true; head -c 200 ' + b + '/.git');
  report.boxAlias = alias.out.trim();
  term.close();
  check('a fresh git repository: one first commit, no remote, the thread id in its config, the engineering branch', /^1$/m.test(facts.out) && facts.out.includes('remotes=[]') && facts.out.includes(ids.thread) && facts.out.includes(`nm/engineering/`) && facts.out.includes('node_modules/'), { out: facts.out.trim(), boxAlias: report.boxAlias });

  // ---- act
  const act = await prompt(s, 'Create the file index.html: a palindrome checker page with one text input, a button and a result line. Put the CSS and the JavaScript inline in the same file. Use the editor tool.');
  if (!changedPaths(s, act.from).includes('index.html')) await prompt(s, 'Now create index.html with the editor tool, as asked.');
  check('the agent makes index.html (a changes event names it)', changedPaths(s).includes('index.html'), { changes: changedPaths(s), end: act.end?.type });

  // ---- preview
  const reqId = randomUUID();
  const pFrom = s.events.length;
  s.command({ type: 'preview_file', requestId: reqId, path: 'index.html' });
  const pv = await s.waitFor((e) => e.type === 'file_preview' && e.requestId === reqId, pFrom, 30_000);
  report.preview = { bytes: pv?.ev.content?.length ?? 0, error: pv?.ev.error ?? null };
  check('preview_file returns the page (the hq preview frame reads this door)', !!pv?.ev.content && /<html|<!doctype/i.test(pv.ev.content) && /palindrome/i.test(pv.ev.content), report.preview);
  s.close();
  await sleep(2_000);

  // ---- reuse
  ({ s, ready } = await openSession(meta));
  term = await relay.terminal();
  const again = await term.run(`test -f ${boxPath(ready.cwd)}/index.html && echo HAS-INDEX; git -C ${boxPath(ready.cwd)} rev-list --count HEAD`);
  term.close();
  check('a second open of the thread lands in the same worktree, with index.html', ready.cwd === ids.cwd && again.out.includes('HAS-INDEX'), { cwd: ready.cwd, out: again.out.trim() });
  s.close();

  // ---- drain
  if (DRAIN) {
    const parked = await API.park(ids.machine);
    const snap = await API.workSnapshot(ids.machine);
    const rel = ids.cwd.replace(/^\/nm\//, '');
    const files = tarEntries(snap.tar, (n) => n.startsWith(rel) && n.endsWith('index.html'));
    check('the parked work snapshot holds the scratch worktree with index.html', files.some((f) => f.name === `${rel}/index.html`), { key: snap.key, epoch: parked.epoch, files: files.map((f) => f.name) });
    await me.post('/v1/machines/wake', { workspace: ids.workspace, machineId: ids.machine });
    const back = await API.running(ids.machine, (m) => m.epoch > parked.epoch && m.drain_state === null && m.desired_replicas === 1);
    relay.close();
    relay = await RelayConnection.open({ url: RELAY, key: KEY, user: ids.user, machine: ids.machine });
    ({ s, ready } = await openSession(meta));
    term = await relay.terminal();
    const after = await term.run(`test -f ${boxPath(ready.cwd)}/index.html && echo HAS-INDEX; git -C ${boxPath(ready.cwd)} log --format=%s | tail -1`);
    term.close();
    check('after the wake a reopen lands in the same scratch worktree, with index.html', ready.cwd === ids.cwd && after.out.includes('HAS-INDEX'), { epoch: back.epoch, cwd: ready.cwd, out: after.out.trim() });
    s.close();
  }
} catch (e) {
  check('the scratch workspace check ran to the end', false, String(e?.stack ?? e).slice(0, 800));
} finally {
  relay?.close();
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
