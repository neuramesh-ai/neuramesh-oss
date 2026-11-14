// THE FEATURE SUITE (docs/cloud-run/feature-matrix.md). Every user-facing NeuraMesh feature the
// matrix names, proven on the Cloud Run sandbox: hq through IAP in a real Chromium, nm-api as the
// same person, and the replica rows behind what the page shows.
//
//   setup   person A (an IAP smoke account) loses the workspaces earlier runs left, then walks the
//           hq wizard into a fresh one. Person B (a second smoke account) leaves A's old workspaces
//           and declines old invites, so the invite scenario starts clean. SETUP=api makes the
//           workspace through workspace.create for a fresh e2e user instead (no browser, API
//           scenarios only), for quick runs.
//   each scenario in features/*.mjs, in order. A scenario records checks; a failed check fails the
//           scenario, never the run. `blocked` means an account the sandbox lacks (Stripe, Resend,
//           the GitHub App, a social API, APNs): it says what is missing and proves the disabled
//           state where there is one.
//   teardown the workspace's machines are drained to sleep (they bill while awake).
//
// Env:
//   HQ_URL, NM_API_URL                  the sandbox services (required)
//   FLEET_SECRET, NM_ACTOR_SECRET        the doors and the actor lane (required)
//   PERSON_A_EMAIL, IAP_JWT_FILE_A       person A, the owner (required unless SETUP=api)
//   PERSON_B_EMAIL, IAP_JWT_FILE_B       person B, the invitee (optional: the invite scenario needs it)
//   FEATURES                             comma list of scenario ids, or "all" (default: every scenario
//                                        but the opt-in ones, which run only when named)
//   SKIP                                 comma list of scenario ids to leave out
//   SETUP                                wizard (default) or api
//   E2E_EMAIL_PREFIX                     the prefix for e2e users the suite makes (default r6feat-)
//   KEEP_AWAKE=1                         do not drain the machines at the end
//   VIDEO=0                              no video (default on: one <scenario>.webm per scenario in OUT,
//                                        and <scenario>-b.webm for person B's browser)
//   OUT, PW_DIR                          the report directory, playwright-core's install
//
// Exit 0 when no scenario failed (blocked and skipped do not fail the run). report.json holds every
// check; the JWTs and secrets never reach it.
import { Blocked, Skip, api, at, cfg, cmd, door, env, firstLine, playwright, replica, results, scenarioCtx, signIapJwt, sleep, snap, until, videoOpts, watchPage, writeReport } from './features/lib.mjs';
import { join } from 'node:path';
import { walkWizard } from './features/wizard.mjs';
import { SCENARIOS } from './features/index.mjs';

// a scenario's stray promise must fail that scenario's check, never the whole run
process.on('unhandledRejection', (e) => console.log(`   (unhandled rejection, ignored: ${firstLine(e)})`));
const SETUP = env('SETUP', 'wizard');
const PREFIX = env('E2E_EMAIL_PREFIX', 'r6feat-');
const want = (env('FEATURES', 'all') || 'all').split(',').map((s) => s.trim()).filter(Boolean);
const skip = new Set((env('SKIP', '') || '').split(',').map((s) => s.trim()).filter(Boolean));
// an opt-in scenario changes the workspace for the rest of the run: it runs only when named
const picked = SCENARIOS.filter((s) => ((want.includes('all') && !s.optIn) || want.includes(s.id)) && !skip.has(s.id));

if (!cfg.api || !cfg.fleetSecret || !cfg.actorSecret || (SETUP === 'wizard' && (!cfg.hq || !cfg.people.a.jwt || !cfg.people.a.email))) {
  console.error('features: NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET, and for SETUP=wizard HQ_URL, PERSON_A_EMAIL and IAP_JWT_FILE_A are required');
  process.exit(2);
}

/** what every scenario shares */
const ctx = {
  cfg,
  prefix: PREFIX,
  tag: Date.now().toString(36),
  a: { ...cfg.people.a },
  b: { ...cfg.people.b },
  ws: null,
  browser: null,
  /** a fresh e2e user (API only), for scenarios that need a third person */
  async extraUser(label) {
    const email = `${PREFIX}${label}-${ctx.tag}@e2e.invalid`;
    const u = await door.user(email);
    return { email, userId: u.userId };
  },
};

/** leave or delete everything an earlier run left behind for these people */
async function cleanSlate(person, label) {
  const out = { left: [], deleted: [], declined: [] };
  const mine = await api('GET', '/v1/invites/mine', { as: person.userId }).catch(() => ({ invites: [] }));
  for (const inv of mine.invites ?? []) {
    await cmd(person.userId, { type: 'workspace.decline_invite', invite: inv.id ?? inv.inviteId }).then(() => out.declined.push(inv.id ?? inv.inviteId)).catch(() => {});
  }
  const { workspaces = [] } = await api('GET', '/v1/workspaces', { as: person.userId });
  for (const w of workspaces) {
    if (w.role === 'owner') continue;
    await cmd(person.userId, { type: 'workspace.leave', workspace: w.id }).then(() => out.left.push(w.slug)).catch((e) => console.log(`  ${label}: leave ${w.slug}: ${firstLine(e)}`));
  }
  return out;
}

async function deleteOwned(person, label) {
  const deleted = [];
  const { workspaces = [] } = await api('GET', '/v1/workspaces', { as: person.userId });
  for (const w of workspaces.filter((x) => x.role === 'owner')) {
    // members first: a workspace with other members refuses the delete
    const members = await api('GET', `/v1/sync/bootstrap`, { as: person.userId }).then((b) => b.changes.filter((c) => c.table === 'workspace_members' && c.row?.workspace_id === w.id)).catch(() => []);
    for (const m of members) {
      if (m.row.user_id && m.row.user_id !== person.userId) await cmd(person.userId, { type: 'workspace.remove_member', workspace: w.id, member: m.row.user_id }).catch(() => {});
    }
    await cmd(person.userId, { type: 'workspace.delete', workspace: w.id }).then(() => deleted.push(w.slug)).catch((e) => console.log(`  ${label}: delete ${w.slug}: ${firstLine(e)}`));
  }
  return deleted;
}

async function setupWizard(t) {
  const a = ctx.a;
  a.userId = (await door.user(a.email)).userId;
  t.note(`person A ${a.email} is nm user ${a.userId}`);
  if (ctx.b.email) {
    ctx.b.userId = (await door.user(ctx.b.email)).userId;
    const bClean = await cleanSlate(ctx.b, 'B');
    const bDeleted = await deleteOwned(ctx.b, 'B');
    t.note({ personB: ctx.b.userId, ...bClean, deleted: bDeleted });
  }
  await cleanSlate(a, 'A');
  const deleted = await deleteOwned(a, 'A');
  const left = (await api('GET', '/v1/workspaces', { as: a.userId })).workspaces ?? [];
  t.check('person A starts with no workspace (earlier runs cleaned up)', left.length === 0, { deleted, remaining: left.map((w) => w.slug) });

  const chromium = playwright();
  ctx.browser = await chromium.launch();
  a.context = await ctx.browser.newContext({ extraHTTPHeaders: { authorization: `Bearer ${a.jwt}` }, viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...videoOpts() });
  a.page = await a.context.newPage();
  a.seen = watchPage(a.page, 'A');
  const doc = await a.page.goto(`${cfg.hq}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  t.check('IAP lets person A in', doc?.status() === 200, `HTTP ${doc?.status()}`);
  await a.page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, null, { timeout: 60_000 });
  const wizard = await walkWizard(a.page, cfg.out, { name: `R6 Features ${ctx.tag}` }).catch((e) => ({ open: true, steps: [], error: firstLine(e) }));
  await snap(a.page, 'wizard-done');
  t.check('the hq wizard makes a fresh workspace and finishes', wizard.open === false && wizard.steps.length > 0, wizard);
  if (wizard.meetClick && wizard.meetClick !== 'click') t.note(`the wizard's last button took a ${wizard.meetClick} click: a plain click timed out`);
  const ws = await until('the wizard workspace in /v1/workspaces', async () => ((await api('GET', '/v1/workspaces', { as: a.userId })).workspaces ?? [])[0], { timeout: 60_000 });
  ctx.ws = { id: ws.id, slug: ws.slug, name: ws.name, plan: ws.plan };
  await afterWorkspace(t, a.userId);
  // the replica: the page sees its own workspace
  await a.page.waitForFunction(() => !!window.__nmDb?.currentStatus?.lastSyncedAt, null, { timeout: 120_000, polling: 500 }).catch(() => {});
  // the replica fills after its first sync: poll briefly instead of reading once (an empty read in c8af4201)
  const agents = await until('the crew in the replica', async () => { const r = await replica(a.page, 'SELECT name, role FROM agents WHERE workspace_id = ?', [ctx.ws.id]).catch(() => null); return r?.length ? r : null; }, { timeout: 60_000, every: 2_000 }).catch(() => null);
  t.check('the wizard crew reached the replica', (agents?.length ?? 0) > 0, agents);
}

async function setupApi(t) {
  const email = `${PREFIX}owner-${ctx.tag}@e2e.invalid`;
  ctx.a = { email, userId: (await door.user(email)).userId, api: true };
  t.note(`API setup: owner ${email} is nm user ${ctx.a.userId}`);
  const made = await cmd(ctx.a.userId, { type: 'workspace.create', name: `R6 features ${ctx.tag}`, slug: `r6f-${ctx.tag}` });
  ctx.ws = { id: made.workspaceId, slug: `r6f-${ctx.tag}`, channelId: made.channelId };
  await afterWorkspace(t, ctx.a.userId);
  // the crew the wizard would register: an orchestrator on the starter seat
  if (ctx.ws.runner && !ctx.ws.agents.some((x) => x.role === 'orchestrator')) {
    const r = await cmd(ctx.a.userId, { type: 'agent.register', workspace: ctx.ws.id, machineId: ctx.ws.runner, name: 'rex', role: 'orchestrator', model: 'gemini-3.5-flash-lite', runtime: 'gemini', channels: ['general'] });
    ctx.ws.agents.push({ id: r.agentId, name: 'rex', role: 'orchestrator' });
  }
}

/** what both setups learn about the new workspace */
async function afterWorkspace(t, owner) {
  const usage = await api('GET', `/v1/machines/usage?workspace=${ctx.ws.id}`, { as: owner }).catch(() => null);
  ctx.ws.runner = usage?.machines?.find((m) => m.kind === 'runner')?.id ?? null;
  t.check('the workspace was born with its Cloud Run runner', !!ctx.ws.runner, usage?.machines ?? usage);
  if (ctx.ws.runner) {
    const m = await door.machine(ctx.ws.runner).catch((e) => ({ error: firstLine(e) }));
    t.check('the runner is a cloudrun machine', m.substrate === 'cloudrun', { substrate: m.substrate, size: m.size_class, plan: m.plan });
  }
  const credits = Number(env('FEATURE_CREDITS', '3000'));
  await door.fund(ctx.ws.id, { credits });
  const boot = await api('GET', '/v1/sync/bootstrap', { as: owner });
  const rows = (table) => boot.changes.filter((c) => c.table === table && c.row?.workspace_id === ctx.ws.id).map((c) => c.row);
  ctx.ws.channels = rows('channels').map((c) => ({ id: c.id, slug: c.slug, kind: c.kind, project_id: c.project_id }));
  ctx.ws.channelId ??= ctx.ws.channels.find((c) => c.slug === 'general')?.id ?? ctx.ws.channels[0]?.id ?? null;
  ctx.ws.agents = rows('agents').map((x) => ({ id: x.id, name: x.name, role: x.role, model: x.model, runtime: x.runtime, machine_id: x.machine_id }));
  ctx.ws.tables = [...new Set(boot.changes.map((c) => c.table))].sort();
  t.note({ workspace: ctx.ws.id, slug: ctx.ws.slug, channels: ctx.ws.channels.map((c) => c.slug), agents: ctx.ws.agents.map((x) => `${x.name}:${x.role}:${x.model}:${x.runtime}`), syncedTables: ctx.ws.tables });
}

async function run(id, title, fn, { reopen = true } = {}) {
  const t = scenarioCtx(id, title);
  const s0 = Date.now();
  console.log(`== ${id}: ${title} (${at()}s)`);
  try {
    await fn(t, ctx);
  } catch (e) {
    if (e instanceof Blocked) { t.r.status = 'blocked'; t.r.blockedBy = String(e.message); console.log(`    BLOCKED  ${e.message}`); }
    else if (e instanceof Skip) { t.r.status = 'skipped'; t.r.skipReason = String(e.message); console.log(`    SKIP  ${e.message}`); }
    else { t.r.status = 'fail'; t.r.error = String(e?.stack ?? e).slice(0, 1200); console.log(`    ERROR  ${firstLine(e)}`); }
  }
  t.r.ms = Date.now() - s0;
  if (ctx.a.page) await snap(ctx.a.page, `${id}-end`).then((f) => { t.r.screenshot = f; });
  // the video: a page's recording is written when the page closes, so each scenario ends its
  // page and the next one starts on a fresh page at the same address
  if (videoOpts().recordVideo) {
    for (const [k, suffix] of [['a', ''], ['b', '-b']]) {
      const v = await keepVideo(ctx[k], `${id}${suffix}`, reopen).catch((e) => { console.log(`   (video for ${id}${suffix} not kept: ${firstLine(e)})`); return null; });
      if (v) (t.r.videos ??= []).push(v);
    }
  }
  console.log(`   ${id}: ${t.r.status.toUpperCase()} in ${(t.r.ms / 1000).toFixed(1)}s`);
  writeReport({ workspace: ctx.ws, setup: SETUP });
  return t.r;
}

/** close the person's page, save its recording as <name>.webm, and reopen their hq where it was */
async function keepVideo(p, name, reopen = true) {
  if (!p?.page || !p.context) return null;
  const old = p.page;
  const url = old.url();
  const video = old.video();
  await old.close();
  const file = `${name}.webm`;
  if (video) await video.saveAs(join(cfg.out, file));
  await video?.delete().catch(() => {});
  // after the last scenario nothing reopens: a loading hq page wakes the runner, and the
  // teardown below would then drain a machine that was still booting (run bf4aab14)
  if (!reopen) { p.page = null; return video ? file : null; }
  p.page = await p.context.newPage();
  if (p.seen) watchPage(p.page, p.seen.tag, p.seen);
  if (/^https?:/.test(url)) {
    await p.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    // the scenarios read the page's replica: wait for its first sync, as setup does
    await p.page.waitForFunction(() => !!window.__nmDb?.currentStatus?.lastSyncedAt, null, { timeout: 60_000, polling: 500 }).catch(() => {});
  }
  return video ? file : null;
}

console.log(`== feature suite against ${cfg.api} (hq ${cfg.hq || 'none'}), setup ${SETUP}, ${picked.length} scenarios: ${picked.map((s) => s.id).join(', ')}`);
// an IAP JWT lasts an hour: re-sign both every 40 minutes and hand the new one to each browser context
const refresher = setInterval(() => {
  for (const k of ['a', 'b']) {
    const p = ctx[k];
    if (!p?.email || p.api || !p.jwt) continue;
    void signIapJwt(p.email).then(async (jwt) => {
      p.jwt = jwt;
      await p.context?.setExtraHTTPHeaders({ authorization: `Bearer ${jwt}` });
      console.log(`   (re-signed the IAP JWT for person ${k.toUpperCase()})`);
    }).catch((e) => console.log(`   (could not re-sign the IAP JWT for person ${k.toUpperCase()}: ${firstLine(e)})`));
  }
}, 40 * 60_000);
refresher.unref();
const setup = await run('setup', SETUP === 'api' ? 'a fresh workspace through workspace.create' : 'a fresh workspace through the hq wizard', SETUP === 'api' ? setupApi : setupWizard);
if (setup.status !== 'pass' && !ctx.ws) {
  console.log('== setup failed with no workspace: the scenarios cannot run');
} else {
  for (const [i, s] of picked.entries()) {
    const reopen = i < picked.length - 1;
    if (s.needs?.includes('browser') && !ctx.a.page) { await run(s.id, s.title, (t) => t.skip('needs the browser (SETUP=wizard)'), { reopen }); continue; }
    if (s.needs?.includes('personB') && !ctx.b.jwt) { await run(s.id, s.title, (t) => t.skip('needs person B (PERSON_B_EMAIL, IAP_JWT_FILE_B)'), { reopen }); continue; }
    await run(s.id, s.title, s.run, { reopen });
  }
}

// teardown: the machines bill while awake. Close the browser first (an open hq page can wake the
// runner again), and drain twice: a machine still booting answers NOT_RUNNING to the first pass
await ctx.browser?.close().catch(() => {});
const drained = [];
if (ctx.ws && env('KEEP_AWAKE', '') !== '1') {
  for (const pass of [0, 1]) {
    if (pass) await sleep(30_000);
    const usage = await api('GET', `/v1/machines/usage?workspace=${ctx.ws.id}`, { as: ctx.a.userId }).catch(() => null);
    for (const m of usage?.machines ?? []) {
      await door.idleDrain(m.id).then(() => { if (!drained.includes(m.id)) drained.push(m.id); }).catch(() => {});
    }
  }
}
const pageNoise = ['a', 'b'].map((k) => ctx[k].seen).filter(Boolean).map((s) => ({
  tag: s.tag, pageErrors: s.errors.slice(0, 20), console: s.console.slice(0, 40),
  serverErrors: s.responses.filter((r) => r.same && r.status >= 500).slice(0, 30),
  notOk: s.responses.filter((r) => r.same && r.status >= 400).slice(0, 60),
}));
const report = writeReport({ workspace: ctx.ws, setup: SETUP, drained, pages: pageNoise });
console.log('== results');
for (const r of results) console.log(`  ${r.status.toUpperCase().padEnd(8)} ${r.id.padEnd(22)} ${r.checks.filter((c) => c.ok).length}/${r.checks.length} checks${r.blockedBy ? `  (${r.blockedBy.slice(0, 120)})` : ''}${r.error ? `  (${firstLine(r.error).slice(0, 160)})` : ''}`);
console.log(`== ${JSON.stringify(report.summary)} in ${report.seconds}s. FEATURES_WORKSPACE=${ctx.ws?.id ?? ''}`);
await sleep(100);
process.exit(results.some((r) => r.status === 'fail') ? 1 : 0);
