#!/usr/bin/env node
// THE INTAKE EVAL (round 9). Each labelled first message (evals/intake/cases.json) goes to intake, and
// the eval scores the decision's kind and workspace (lib/intake-score.mjs):
//
//   clear coding (greenfield and a named repository)   95% or more, kind AND workspace right
//   questions                                          0 coding routes
//   content, research, board, ambiguous                reported
//
// Both live modes make a fresh e2e person and workspace (the API setup: workspace.create registers no
// crew) and link one repository to its default project (the e2e repo door, a file:// URL that is never
// fetched), so a named-repo ask can route to it.
//
//   (default)  the intake DOOR, POST /internal/e2e/intake { workspace, text, projectId }: the decision
//              and the effects a first message gets, with no thread written, so no agent answers and no
//              coding session runs. It scores decision.kind, and for coding effects.workspaceMode (and
//              effects.repoId against the linked repository). With no decision (the starter brain was
//              unavailable: `why`), the rule's hit decides, as nm-api does.
//   --threads  each case is posted the way hq's Home posts it: a fresh thread through POST /v1/messages
//              (no threadKind) in a QUIET ROOM with no agent, and `threads.intake` is read from the
//              person's feed. A coding decision can open a coding session on the runner: use --cases
//              for a smaller run. Messages go out a few at a time (EVAL_CONCURRENCY, default 4)
//
//   --offline        no network: score the deterministic build rule alone. It loads --rule=<module>, else
//                    packages/shared/src/intake-rules.ts (the service's own rule, when the tree has it),
//                    else evals/intake/reference-rule.mjs, and says which. A rule exports
//                    `intakeRule(text, { repos })`
//   --rule=<module>  the rule module for --offline (a .mjs, or a .ts with no imports: Node 24 strips types)
//   --cases=<ids>    only these case ids (comma list)
//
// Env (live): NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET (cloudbuild-intake-evals.yaml)
//   EVAL_TIMEOUT_S (--threads: how long to wait for every decision, default 120)   OUT (default ./intake-evals-out)
//   NM_KEEP_AWAKE=1  do not park the runner at the end
//
// Exit 0 when the gates pass. report.json holds every case, its decision and the time intake took.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Api } from './lib/api.mjs';
import { fill, score, scoreRule, table } from './lib/intake-score.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name) => flag(name)?.split('=').slice(1).join('=') || null;
const OFFLINE = !!flag('offline');
const OUT = resolve(process.env.OUT ?? 'intake-evals-out');
const ROOT = new URL('../../', import.meta.url);
const ALL = JSON.parse(readFileSync(new URL('evals/intake/cases.json', ROOT), 'utf8')).cases;
const only = value('cases')?.split(',').map((s) => s.trim()).filter(Boolean);
const CASES = only ? ALL.filter((c) => only.includes(c.id)) : ALL;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

function finish(report) {
  writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(table(report.score));
  if (report.score.rule) console.log(`  rule: coding recall ${Math.round((report.score.rule.codingRecall ?? 0) * 100)}%, false coding routes [${report.score.rule.falseCodingRoutes.join(', ')}]`);
  for (const f of report.score.failures.slice(0, 40)) console.log(`  miss ${f.id} (${f.category}): want ${f.expect.kind}/${f.expect.workspace}${f.accept.length ? ` or ${f.accept.join('|')}` : ''}, got ${f.missing ? 'no decision' : `${f.got.kind}/${f.got.workspace}`}  "${f.text.slice(0, 70)}"`);
  console.log(`intake-evals: ${report.score.pass ? 'PASS' : 'FAIL'} (${report.mode}) report ${join(OUT, 'report.json')}`);
  process.exit(report.score.pass ? 0 : 1);
}

/** a rule's answer as { kind, workspace }, whatever its exact shape: null, { kind, workspace },
 *  { hit, workspaceMode }, or { repoId } (repo) */
function ruleVerdict(r) {
  if (!r || r.hit === false) return null;
  const kind = r.kind ?? (r.hit ? 'coding' : null);
  if (!kind) return null;
  const workspace = r.workspace ?? r.workspaceMode ?? (kind === 'coding' ? (r.repoId ? 'repo' : 'scratch') : 'none');
  return { kind, workspace };
}

// ── offline: the rule alone ──────────────────────────────────────────────────────────────────────
if (OFFLINE) {
  const asked = value('rule');
  const service = new URL('packages/shared/src/intake-rules.ts', ROOT);
  const ruleFrom = asked ?? (existsSync(service) ? 'packages/shared/src/intake-rules.ts' : 'evals/intake/reference-rule.mjs');
  const mod = await import(asked ? pathToFileURL(resolve(asked)).href : new URL(ruleFrom, ROOT).href);
  const rule = mod.intakeRule ?? mod.default;
  if (typeof rule !== 'function') { console.error(`intake-evals: ${ruleFrom} exports no intakeRule`); process.exit(2); }
  const repos = [{ id: 'repo-1', name: 'acme-web', primary: true }];
  const results = {};
  for (const c of CASES) {
    // null is "not a clear build ask": the brain or the agent decides, so it scores as a conversation
    results[c.id] = ruleVerdict(rule(fill(c.text, 'acme-web'), { repos })) ?? { kind: 'chat', workspace: 'none' };
  }
  finish({ mode: 'offline', rule: ruleFrom, at: new Date().toISOString(), score: scoreRule(CASES, results), results });
}

// ── live: post each case like Home, read threads.intake ──────────────────────────────────────────
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`intake-evals: set ${k}`); process.exit(2); } return v; };
const API = new Api({ url: need('NM_API_URL'), fleetSecret: need('FLEET_SECRET'), actorSecret: process.env.NM_ACTOR_SECRET ?? '' });
const TIMEOUT = Number(process.env.EVAL_TIMEOUT_S ?? 120) * 1000;
const CONCURRENCY = Math.max(1, Number(process.env.EVAL_CONCURRENCY ?? 4));
const tag = `r9intake-${Date.now().toString(36)}`;
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

const ws = await API.freshWorkspace(tag, { plan: 'cloud', credits: 3000 });
const me = ws.api;
log(`workspace ${ws.workspaceId} runner ${ws.machineId}`);
// the quiet room: no agent is in it, so nobody answers the threads (intake needs no agent)
const boot0 = await me.get('/v1/sync/bootstrap').catch(() => null);
const rowsOf = (b, t) => (b?.changes ?? []).filter((x) => x.table === t).map((x) => x.row);
const project = rowsOf(boot0, 'projects').find((p) => Number(p.is_default) === 1 || p.is_default === true)?.id
  ?? rowsOf(boot0, 'channels').find((ch) => ch.id === ws.channelId)?.project_id ?? null;
const room = project
  ? await me.cmd({ type: 'channel.create', workspace: ws.workspaceId, project, slug: 'intake-eval', topic: 'intake eval: no agent here' }).catch((e) => ({ error: e.message }))
  : { error: 'no default project in the feed' };
const channelId = room?.channelId ?? ws.channelId;
log(room?.channelId ? `quiet room ${channelId}` : `no quiet room (${room?.error ?? 'no id'}): posting in the default room, its agents may answer`);
// one repository on the project, so a named-repo ask can route to it
const REPO = 'acme-web';
const repo = await API.door('POST', `/internal/e2e/workspaces/${ws.workspaceId}/repos`, { channel: channelId, name: REPO, cloneUrl: `file:///nm/work/${REPO}-${tag}` }).catch((e) => ({ error: e.message }));
log(repo?.repoId ? `repository ${REPO} (${repo.repoId})` : `no repository (${repo?.error}): the coding-repo cases cannot route to repo`);

// ── the door (default): the decision with no thread ──────────────────────────────────────────────
if (!flag('threads')) {
  const results = {};
  const detail = [];
  const queue = [...CASES];
  const one = async (c) => {
    const text = fill(c.text, REPO);
    const at = Date.now();
    const r = await API.door('POST', '/internal/e2e/intake', { workspace: ws.workspaceId, text, ...(project ? { projectId: project } : {}) }).catch((e) => ({ error: e.message.slice(0, 200), status: e.status }));
    const d = r?.decision ?? null;
    const kind = d?.kind ?? (r?.rule?.hit ? 'coding' : null);
    const workspace = kind === 'coding' ? (r?.effects?.workspaceMode ?? d?.workspace ?? null) : (d?.workspace ?? 'none');
    results[c.id] = kind ? { kind, workspace } : null;
    detail.push({
      id: c.id, category: c.category, text, kind, workspace, decision: d, effects: r?.effects ?? null, rule: r?.rule ?? null, why: r?.why ?? null,
      repoOk: c.category === 'coding-repo' ? r?.effects?.repoId === repo?.repoId : null, ms: r?.ms ?? (r?.error ? null : Date.now() - at), error: r?.error ?? null,
    });
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { for (let c = queue.shift(); c; c = queue.shift()) { await one(c); await sleep(200); } }));
  const ms = detail.map((x) => x.ms).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  const pct = (q) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] : null);
  const count = (f) => detail.reduce((m, x) => { const k = f(x) ?? 'none'; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const sources = count((x) => x.decision?.source ?? (x.rule?.hit ? 'rule-only' : null));
  const whys = count((x) => x.why);
  const repoMiss = detail.filter((x) => x.repoOk === false).map((x) => ({ id: x.id, repoId: x.effects?.repoId ?? null }));
  log(`door: ms p50 ${pct(0.5)} p95 ${pct(0.95)}  sources ${JSON.stringify(sources)}  why ${JSON.stringify(whys)}  repo id misses ${repoMiss.length}`);
  if (process.env.NM_KEEP_AWAKE !== '1') await API.park(ws.machineId).then(() => log('runner parked'), (e) => log(`park failed: ${e.message}`));
  finish({
    mode: 'door', at: new Date().toISOString(), api: API.url, workspaceId: ws.workspaceId, projectId: project, repo: repo?.repoId ? REPO : null,
    latency: { p50: pct(0.5), p95: pct(0.95), n: ms.length }, sources, whys, repoMiss, score: score(CASES, results), cases: detail,
  });
}

// ── --threads: post each case like Home ──────────────────────────────────────────────────────────
const posted = new Map(); // case id -> { threadId, at }
const queue = [...CASES];
async function worker() {
  for (let c = queue.shift(); c; c = queue.shift()) {
    const threadId = randomUUID();
    const at = Date.now();
    try {
      await me.post('/v1/messages', { workspace: ws.workspaceId, channel: channelId, threadId, body: fill(c.text, REPO) });
      posted.set(c.id, { threadId, at });
    } catch (e) {
      posted.set(c.id, { threadId, at, error: e.message.slice(0, 200) });
    }
    await sleep(400);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
log(`posted ${[...posted.values()].filter((p) => !p.error).length}/${CASES.length}`);

// the decisions, from the person's feed (one bootstrap read answers for every thread)
const decided = new Map();
const deadline = Date.now() + TIMEOUT;
while (Date.now() < deadline) {
  const boot = await me.get('/v1/sync/bootstrap').catch(() => null);
  const rows = (boot?.changes ?? []).filter((x) => x.table === 'threads').map((x) => x.row);
  for (const [id, p] of posted) {
    if (decided.has(id)) continue;
    const row = rows.find((r) => r.id === p.threadId);
    if (!row) continue;
    let intake = row.intake;
    if (typeof intake === 'string') { try { intake = JSON.parse(intake); } catch { intake = null; } }
    if (intake && intake.kind) decided.set(id, { row, intake, seenAt: Date.now() });
  }
  if (decided.size >= [...posted.values()].filter((p) => !p.error).length) break;
  await sleep(3_000);
}
log(`decided ${decided.size}/${posted.size}`);

const results = {};
const detail = [];
for (const c of CASES) {
  const p = posted.get(c.id);
  const d = decided.get(c.id);
  results[c.id] = d ? { kind: d.intake.kind, workspace: d.intake.workspace ?? 'none' } : null;
  detail.push({
    id: c.id, category: c.category, text: fill(c.text, REPO), threadId: p?.threadId ?? null, postError: p?.error ?? null,
    intake: d?.intake ?? null, threadKind: d?.row.kind ?? null, workspaceMode: d?.row.workspace_mode ?? null, title: d?.row.title ?? null,
    // the service's own number when it records one, else the eval's poll (an upper bound, 3 s granularity)
    ms: d ? (d.intake.ms ?? d.seenAt - p.at) : null,
  });
}
const s = score(CASES, results);
const ms = detail.map((x) => x.ms).filter((x) => typeof x === 'number').sort((a, b) => a - b);
const pct = (q) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] : null);
const sources = detail.reduce((m, x) => { const k = x.intake?.source ?? 'none'; m[k] = (m[k] ?? 0) + 1; return m; }, {});
// a coding decision must also have moved the thread: kind coding and the workspace mode it named
const applied = detail.filter((x) => x.intake?.kind === 'coding').map((x) => ({ id: x.id, ok: x.threadKind === 'coding' && x.workspaceMode === x.intake.workspace, threadKind: x.threadKind, workspaceMode: x.workspaceMode }));
log(`intake ms p50 ${pct(0.5)} p95 ${pct(0.95)}  sources ${JSON.stringify(sources)}  coding applied ${applied.filter((a) => a.ok).length}/${applied.length}`);

if (process.env.NM_KEEP_AWAKE !== '1') await API.park(ws.machineId).then(() => log('runner parked'), (e) => log(`park failed: ${e.message}`));
finish({
  mode: 'live', at: new Date().toISOString(), api: API.url, workspaceId: ws.workspaceId, quietRoom: !!room?.channelId, repo: repo?.repoId ? REPO : null,
  latency: { p50: pct(0.5), p95: pct(0.95), n: ms.length }, sources, applied, score: s, cases: detail,
});
