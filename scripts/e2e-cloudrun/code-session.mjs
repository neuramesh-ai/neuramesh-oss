#!/usr/bin/env node
// THE CODE SESSION CHECK (round 6). A Code (engineering) session on a Cloud Run machine, driven the way
// hq drives it: a relay token for one person, the engineering lane, the starter brain (no keys).
//
//   setup     a fresh e2e person and workspace (or the ones named in the env), a public repo linked
//             (repo.link, anonymous clone), the coding thread born from its root message (POST /v1/messages)
//   open      the lane answers `ready` on the starter brain, in a worktree under /nm/work
//   plan      a Plan turn ends with text and no file changes
//   act       Controls to Act, then a prompt: the edit lands (a `changes` event names the file)
//   approve   the command asks (an `approval` for run_commands, category command), the approval goes in,
//             and the command runs in the Code shell lane: the file it wrote shows in `changes`
//   brain     after the close, the brain checkpoint is in nm-api (GET /v1/brain/threads/:id revision >= 1,
//             with the approval in its events and the command output in its runtime messages)
//   reload    a new channel on the same thread answers `ready` with recordedRevision >= that revision,
//             and a follow-up prompt shows the model kept the context (it names the file it made)
//   resize    (--resize) a grow drain to the next size: a reopen lands in the same worktree with the edit
//   worktree  (--drain) the machine parks: the work snapshot holds the worktree with both files. It wakes:
//             a reopen lands in the same worktree, and the edit is still there (git status through the lane)
//   park      every machine this script woke is parked at the end (unless NM_KEEP_AWAKE=1)
//
//   NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET, NM_RELAY_URL, NM_RELAY_TOKEN_KEY   (cloudbuild-code-session.yaml)
//   CODE_USER_ID, CODE_WORKSPACE_ID, CODE_CHANNEL_ID, CODE_MACHINE_ID             reuse a workspace (optional)
//   CODE_REPO_URL (default https://github.com/octocat/Hello-World), CODE_REPO_BRANCH (default master)
//   CODE_REPO_ID                                                                  an existing repos row instead of repo.link
//   OUT (default ./code-session-out)
//
// Node 24, no dependencies. The report never holds a secret.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { RelayConnection } from './lib/relay.mjs';
import { Api, tarEntries } from './lib/api.mjs';

const env = (k, d) => process.env[k] ?? d;
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`code-session: set ${k}`); process.exit(2); } return v; };
const API = new Api({ url: need('NM_API_URL'), fleetSecret: need('FLEET_SECRET'), actorSecret: env('NM_ACTOR_SECRET', '') });
const RELAY = need('NM_RELAY_URL');
const KEY = need('NM_RELAY_TOKEN_KEY');
const OUT = resolve(env('OUT', 'code-session-out'));
const DRAIN = process.argv.includes('--drain');
const RESIZE = process.argv.includes('--resize');
mkdirSync(OUT, { recursive: true });

const tag = `r6mach-code-${Date.now().toString(36)}`;
const nonce = randomBytes(3).toString('hex');
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
const BAD = new Set(['ENGINEERING_START_FAILED', 'ENGINEERING_GITHUB_REQUIRED', 'MODEL_REFUSED', 'BRAIN_SYNC_PENDING', 'ENGINEERING_UNAVAILABLE', 'SESSION_ACTIVE']);
const ids = {};
let woke = false;
let relay = null;

/** the text the model wrote in a turn, from the projected agent events after `from` */
const turnText = (s, from) => s.events.slice(from).filter((e) => e.type === 'agent_event' && e.event?.payload?.event?.type === 'content_end' && e.event.payload.event.contentType === 'text')
  .map((e) => e.event.payload.event.text ?? '').join('\n');
const errorsIn = (s, from = 0) => s.events.slice(from).filter((e) => e.type === 'error');
const changedPaths = (s, from = 0) => s.events.slice(from).filter((e) => e.type === 'changes').flatMap((e) => e.changes.map((c) => c.path));
/** a turn is over at `ended`, or an idle status after it ran */
const turnOver = (e) => e.type === 'ended' || (e.type === 'status' && e.status === 'idle');

async function prompt(s, text, ms = 240_000) {
  const from = s.events.length;
  s.command({ type: 'prompt', prompt: text });
  const r = await s.waitFor((e) => turnOver(e) || e.type === 'approval' || (e.type === 'error' && !e.recoverable), from, ms);
  return { from, end: r?.ev ?? null };
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
    throw new Error(`the session did not open: ${JSON.stringify(why).slice(0, 400)}`);
  }
}

async function brainHead(sinceRevision = -1) {
  return API.as(ids.user).get(`/v1/brain/threads/${ids.thread}?workspace=${ids.workspace}&format=compact-decoded`).catch((e) => ({ error: e.message, revision: sinceRevision }));
}

const report = { tag, startedAt: new Date().toISOString(), ids, checks };
try {
  // ---- setup
  if (env('CODE_USER_ID')) Object.assign(ids, { user: env('CODE_USER_ID'), workspace: need('CODE_WORKSPACE_ID'), channel: need('CODE_CHANNEL_ID'), machine: need('CODE_MACHINE_ID') });
  else {
    const w = await API.freshWorkspace(tag);
    Object.assign(ids, { user: w.userId, workspace: w.workspaceId, channel: w.channelId, machine: w.machineId });
  }
  const me = API.as(ids.user);
  const repoName = env('CODE_REPO_URL', 'https://github.com/octocat/Hello-World').split('/').pop().replace(/\.git$/, '');
  const branch = env('CODE_REPO_BRANCH', 'master');
  ids.repo = env('CODE_REPO_ID') || (await me.cmd({ type: 'repo.link', workspace: ids.workspace, channel: ids.channel, url: env('CODE_REPO_URL', 'https://github.com/octocat/Hello-World'), defaultBranch: branch })).repoId;
  check('a repo is linked to the workspace', !!ids.repo, { repo: ids.repo, name: repoName, branch });
  const before = await API.machine(ids.machine);
  if (before.desired_replicas !== 1) { await me.post('/v1/machines/wake', { workspace: ids.workspace, machineId: ids.machine }); woke = true; }
  else woke = !env('CODE_USER_ID'); // a fresh runner is born awake: this script woke it
  const awake = await API.running(ids.machine);
  check('the machine runs on Cloud Run', awake.substrate === 'cloudrun' && awake.epoch >= 1, { epoch: awake.epoch, size: awake.size_class });
  // the boot reports the runtimes the machine can run (machines.runtimes), and the replica carries the row
  // to every client: read it the way a client does, from the replica bootstrap
  {
    let row = null;
    for (let i = 0; i < 3 && !row; i++) {
      const boot = await me.get(`/v1/brain/replica/bootstrap?workspace=${ids.workspace}`).catch(() => me.get(`/v1/sync/bootstrap?workspace=${ids.workspace}`)).catch((e) => ({ error: e.message }));
      row = (boot.changes ?? []).find((c) => c.table === 'machines' && c.id === ids.machine)?.row ?? row;
      if (!row) await sleep(5_000);
    }
    const runtimes = typeof row?.runtimes === 'string' ? (() => { try { return JSON.parse(row.runtimes); } catch { return row.runtimes; } })() : row?.runtimes;
    // a fresh workspace has no key and no login, so the honest report is an empty list (the starter brain
    // is no runtime); agy-box.mjs sets a workspace key and sees the list fill at the next boot
    check('the boot reported its runtimes, and the replica carries the machines row to the client (empty: no key, no login)', !!row && Array.isArray(runtimes), { runtimes, columns: row ? Object.keys(row).length : 0 });
  }
  ids.thread = randomUUID();
  const rootId = randomUUID();
  const planPrompt = `Plan only, do not edit yet: I want a file NOTES-${nonce}.md with one line, then a command that writes ran-${nonce}.txt. Say in two short sentences what you will do.`;
  await me.post('/v1/messages', { id: rootId, workspace: ids.workspace, channel: ids.channel, body: planPrompt, threadId: ids.thread, rootMessageId: rootId, threadKind: 'coding', threadMachineId: ids.machine, threadOrigin: 'web' });
  check('the coding thread is born from its root message', true, { thread: ids.thread });

  // ---- open
  relay = await RelayConnection.open({ url: RELAY, key: KEY, user: ids.user, machine: ids.machine });
  check('the relay attaches with the engineering and resume lanes', relay.lanes.has('engineering') && relay.lanes.has('resume'), [...relay.lanes]);
  const PERM = { read: true, edit: true, command: false, web: false, mcp: false };
  const POLICY = { read: true, edit: true, command: true, web: true, mcp: true };
  const meta = { threadId: ids.thread, repoId: ids.repo, repoName, branch, mode: 'plan', permissions: PERM, policy: POLICY, agentId: null, reasoningEffort: null, modelId: null, brainPack: null };
  let { s, ready } = await openSession(meta);
  ids.cwd = ready.cwd;
  check('the session is ready on the starter brain, in a worktree under /nm/work', ready.provider === 'gemini' && /flash-lite/.test(ready.model ?? '') && /^\/nm\/work\/brain\/cache\/worktrees\//.test(ready.cwd ?? ''),
    { provider: ready.provider, model: ready.model, cwd: ready.cwd, recordedRevision: ready.recordedRevision });

  // ---- plan
  const plan = await prompt(s, planPrompt);
  const planText = turnText(s, plan.from);
  check('a Plan turn ends with text and changes no file', !!plan.end && turnOver(plan.end) && planText.length > 0 && changedPaths(s, plan.from).length === 0 && !errorsIn(s, plan.from).some((e) => BAD.has(e.code)),
    { end: plan.end?.type, text: planText.slice(0, 200), changes: changedPaths(s, plan.from), errors: errorsIn(s, plan.from) });

  // ---- act: the edit, then the command that asks
  s.command({ type: 'controls', controls: { mode: 'act', permissions: PERM, policy: POLICY } });
  await sleep(500);
  const actFrom = s.events.length;
  let act = await prompt(s, `Act now. Step 1: create the file NOTES-${nonce}.md containing exactly the line "nm-e2e ${nonce}". Step 2: use the run_commands tool to run exactly: echo ran-${nonce} > ran-${nonce}.txt`);
  // the starter model sometimes stops after the edit: one nudge for the command
  if (act.end?.type !== 'approval' && !s.events.slice(actFrom).some((e) => e.type === 'approval')) {
    act = await prompt(s, `Now use the run_commands tool to run exactly: echo ran-${nonce} > ran-${nonce}.txt`);
  }
  const ask = await s.waitFor((e) => e.type === 'approval', actFrom, 60_000);
  const askOk = check('the command asks first (an approval for run_commands, category command)', ask?.ev.toolName === 'run_commands' && ask?.ev.category === 'command',
    ask?.ev ? { toolName: ask.ev.toolName, category: ask.ev.category, approvalId: ask.ev.approvalId, input: ask.ev.input } : { last: s.events.slice(-3) });
  if (askOk) {
    const from = s.events.length;
    s.command({ type: 'approval', approvalId: ask.ev.approvalId, approved: true });
    const resolved = await s.waitFor((e) => e.type === 'approval_resolved' && e.approvalId === ask.ev.approvalId, from, 30_000);
    const ran = await s.waitFor((e) => e.type === 'changes' && e.changes.some((c) => c.path === `ran-${nonce}.txt` && String(c.after).includes(`ran-${nonce}`)), from, 120_000);
    // the model may ask again in the same turn (an `ls` to look): each later ask is approved too, up to 4
    let done = null; let more = 0;
    for (let cursor = from; ;) {
      const r = await s.waitFor((e) => turnOver(e) || (e.type === 'approval' && e.approvalId !== ask.ev.approvalId), cursor, 180_000);
      if (!r || turnOver(r.ev)) { done = r; break; }
      if (++more > 4) break;
      s.command({ type: 'approval', approvalId: r.ev.approvalId, approved: true });
      cursor = r.index + 1;
    }
    check('the approval goes in, and the command runs in the Code shell lane (its file shows in changes)', !!resolved?.ev.approved && !!ran && !!done,
      { resolved: resolved?.ev ?? null, ranFile: !!ran, ended: done?.ev.type ?? null, laterAsks: more, errors: errorsIn(s, from) });
  }
  // the starter model may run the command before it edits: the edit is judged over the whole Act phase,
  // with one nudge if it never came
  if (!changedPaths(s, actFrom).includes(`NOTES-${nonce}.md`)) await prompt(s, `Now create the file NOTES-${nonce}.md containing exactly the line "nm-e2e ${nonce}". Use the editor tool.`);
  check('the edit lands in the worktree (a changes event names the file)', changedPaths(s, actFrom).includes(`NOTES-${nonce}.md`), { changes: changedPaths(s, actFrom), errors: errorsIn(s, actFrom) });
  check('no lane error a person would see (start, model, brain sync)', !errorsIn(s).some((e) => BAD.has(e.code)), errorsIn(s));

  // ---- brain: close, then the checkpoint
  s.close();
  let head = null;
  for (let i = 0; i < 30; i++) { head = await brainHead(); if ((head?.revision ?? 0) >= 1 && (head.events ?? []).some((e) => e.type === 'approval.resolved')) break; await sleep(2_000); }
  const types = [...new Set((head?.events ?? []).map((e) => e.type))];
  const runtimeHasOutput = JSON.stringify(head?.runtimeMessages ?? []).includes(`ran-${nonce}`) || JSON.stringify(head?.runtimeMessages ?? []).includes(`NOTES-${nonce}`);
  check('the brain checkpoint is in nm-api (revision >= 1, the approval in its events, the work in its runtime messages)',
    (head?.revision ?? 0) >= 1 && types.includes('tool.approval') && types.includes('approval.resolved') && runtimeHasOutput,
    { revision: head?.revision, commitId: head?.commitId, types, runtimeHasOutput, error: head?.error });
  report.brain = { revision: head?.revision, commitId: head?.commitId, types };

  // ---- reload: a new channel on the same thread
  await sleep(3_000);
  ({ s, ready } = await openSession({ ...meta, mode: 'act' }));
  check('a reload answers ready on the same worktree, at or past the stored revision', ready.cwd === ids.cwd && (ready.recordedRevision ?? -1) >= (head?.revision ?? 1),
    { cwd: ready.cwd, recordedRevision: ready.recordedRevision, stored: head?.revision });
  const recall = await prompt(s, 'Answer with the file name only: which .md file did you create earlier in this conversation?');
  const recallText = turnText(s, recall.from);
  check('the restored thread keeps its context (the model names the file it made)', recallText.includes(`NOTES-${nonce}`), recallText.slice(0, 200));
  s.close();
  await sleep(2_000);

  // ---- the worktree across a live resize (a grow drain, then the next size)
  if (RESIZE) {
    const before = await API.machine(ids.machine);
    const asked = await API.door('POST', `/internal/machines/${ids.machine}/resize`, {});
    const grown = await API.running(ids.machine, (m) => m.epoch > before.epoch && m.drain_state === null && m.size_class === asked.to, 600_000);
    relay.close();
    relay = await RelayConnection.open({ url: RELAY, key: KEY, user: ids.user, machine: ids.machine });
    ({ s, ready } = await openSession({ ...meta, mode: 'act' }));
    const term = await relay.terminal();
    const cat = await term.run(`cat ${ids.cwd.replace(/^\/nm\/work/, '/work')}/NOTES-${nonce}.md`);
    term.close();
    check(`after a resize (${asked.from} to ${asked.to}) a reopen lands in the same worktree, with the edit`, ready.cwd === ids.cwd && cat.out.includes(`nm-e2e ${nonce}`),
      { epoch: grown.epoch, size: grown.size_class, limitMiB: grown.limit_mib, cwd: ready.cwd, file: cat.out.trim() });
    s.close();
    await sleep(2_000);
  }

  // ---- the worktree across a park and a wake
  if (DRAIN) {
    const parked = await API.park(ids.machine);
    const snap = await API.workSnapshot(ids.machine);
    const rel = ids.cwd.replace(/^\/nm\//, '');
    const files = tarEntries(snap.tar, (n) => n.startsWith(rel) && (n.endsWith(`NOTES-${nonce}.md`) || n.endsWith(`ran-${nonce}.txt`)));
    check('the parked work snapshot holds the worktree with the edit and the command output', files.length === 2,
      { key: snap.key, epoch: parked.epoch, files: files.map((f) => ({ name: f.name, text: f.data.toString().trim() })) });
    await me.post('/v1/machines/wake', { workspace: ids.workspace, machineId: ids.machine });
    const back = await API.running(ids.machine, (m) => m.epoch > parked.epoch && m.drain_state === null && m.desired_replicas === 1);
    relay.close();
    relay = await RelayConnection.open({ url: RELAY, key: KEY, user: ids.user, machine: ids.machine });
    ({ s, ready } = await openSession({ ...meta, mode: 'act' }));
    check('after the wake a reopen lands in the same worktree', ready.cwd === ids.cwd, { epoch: back.epoch, cwd: ready.cwd });
    const term = await relay.terminal();
    const ls = await term.run(`cat ${ids.cwd.replace(/^\/nm\/work/, '/work')}/NOTES-${nonce}.md; git -C ${ids.cwd.replace(/^\/nm\/work/, '/work')} status --porcelain | head`);
    term.close();
    check('the edit is still in the worktree after the wake (seen from a box terminal)', ls.out.includes(`nm-e2e ${nonce}`), ls);
    s.close();
  }
} catch (e) {
  check('the Code session check ran to the end', false, String(e?.stack ?? e).slice(0, 800));
} finally {
  relay?.close();
  if (woke && ids.machine && env('NM_KEEP_AWAKE') !== '1') {
    try { const m = await API.park(ids.machine); report.parked = { epoch: m.epoch, snapshot: m.snapshot_work }; console.log(`  parked ${ids.machine} at epoch ${m.epoch}`); }
    catch (e) { console.log(`  WARN the machine did not park: ${e.message}`); report.parked = { error: e.message }; }
  }
}
report.seconds = at();
writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const failed = checks.filter((c) => !c.ok).length;
console.log(`== ${checks.length - failed} passed, ${failed} failed (${at()}s)`);
process.exit(failed ? 1 : 0);
