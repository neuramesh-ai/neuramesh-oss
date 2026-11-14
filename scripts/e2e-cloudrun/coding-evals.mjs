#!/usr/bin/env node
// THE CODING EVALS ON CLOUD RUN (README.md beside this file, "Coding evals"). The product-flow
// coding evals of evals/coding (simple, medium TaskGarden, complex LedgerDesk) run against the
// sandbox deploy instead of a local desktop stack:
//
//   setup    the smoke account's nm user (the e2e door, the subject the hq gateway maps its IAP email
//            to), a fresh workspace with its cloudrun runner, the plan and credits, rex on the
//            starter brain (agent.register), as scripts/e2e-cloudrun/run.mjs does
//   boot     the runner is born awake: wait until it boots and reports running
//   fixture  a relay terminal in the machine's agent box (relay-terminal.mjs) writes the case's
//            fixture into /work/evals as a git repository, checks that the hidden acceptance oracle
//            FAILS on the starter (as prepare.mjs does), and keeps only a bare clone
//   repo     the e2e repo door (the sandbox stand-in for the GitHub App connect) links that bare
//            repository to the room's project with clone URL file:///nm/work/evals/<name>.git. The
//            machine then clones, fetches and cuts the thread's worktree on its own real path
//   park     an idle drain parks the runner, so the fixture crosses a sleep in the work snapshot and
//            the session below starts on a parked machine, as a person's usually does
//   session  hq through IAP, in a real Chromium: New session, the repo chip, the prompt, the plan,
//            the thread's permission mode set to Request Review, Act, each file review and npm test approval, and (complex)
//            the follow-up turn, with the selectors of scripts/coding-evals/flow.mjs (hq's Code view
//            is the web port of the desktop's)
//   grade    in the box, through the relay terminal: the agent's own recorded test run (its
//            runtime.json, read as scripts/coding-evals/recording.mjs reads it), npm test run again
//            independently, and the SAME hidden oracle (scripts/coding-evals/oracle.mjs, every check
//            run even after one fails, so each one is recorded)
//   reload   the thread after a reload keeps its plan, reviews, agent and model
//   final    an idle drain parks the runner again: the snapshot size, and the thread's worktree in it
//
// EVAL_CASES=bench (or bench:lru-cache,...) runs the packages/bench developer suite the same way, in
// one shared workspace: each task's workspace/ is the fixture, its task.json the prompt, and its
// hidden tests/failToPass.mjs the grade (copied into the worktree only after the agent finished,
// as packages/bench/src/run/developer.ts copies it into its temp dir).
//
// Preview checks are "not run" until the dev-server preview tunnel exists on Cloud Run.
// Model quality failures are data: each check is recorded and the run goes on where it can. A
// platform failure (the machine, the relay, sync, the box) ends the case with its error.
//
//   NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET     nm-api and its e2e doors (run.mjs)
//   HQ_URL                                        the hq service behind IAP
//   IAP_SA                                        the smoke account (its email is the hq identity)
//   IAP_JWT                                       optional: a ready JWT, else one is signed through
//                                                 IAM Credentials with the metadata token, and again
//                                                 every 40 minutes (a JWT lives 60)
//   NM_RELAY_URL, NM_RELAY_TOKEN_KEY              the relay terminal (relay-terminal.mjs)
//   EVAL_CASES                                    simple,medium,complex (default all three)
//   EVAL_MODEL, EVAL_HANDOFF_MODEL                optional model labels for the Code model chip;
//                                                 unset keeps the room's default seat (the starter)
//   EVAL_KEY_SECRET                               optional: a Secret Manager version name holding a
//                                                 Gemini API key. The driver reads it with the
//                                                 metadata token and stores it in each fresh
//                                                 workspace as hq's Models screen does
//                                                 (credential.set, provider gemini, through IAP). It
//                                                 is never printed or written to the evidence
//   OUT, PW_DIR                                   evidence dir, playwright-core install dir
//
// Node 22+ (WebSocket), playwright-core. Exit 0 only when every case passed every check.
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as zlib from 'node:zlib';
import { allowedPath, approvalCommands, statusOf } from '../coding-evals/support.mjs';
// the relay shards (docs/42): NM_RELAY_URL may be the shard list, and the terminal dials its machine's shard
import { parseRelayShards, shardUrlFor, WRONG_SHARD_CLOSE, wrongShardTarget } from '../../packages/relay/src/shard.ts';
import { agentPlanProgress, agentVerification } from '../coding-evals/recording.mjs';
import { RelayConnection } from './lib/relay.mjs';
import { previewServerSource, probePage } from './lib/preview-probe.mjs';
// the wizard's last button: "Start a new session →" since the 2026-11 upstream, "Meet @<agent> …" before it
const LAUNCH_BUTTON = /^(start a new session|meet @)/i;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const env = (k, d) => process.env[k] ?? d;
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`coding-evals: set ${k}`); process.exit(2); } return v.replace(/\/+$/, ''); };
const API = need('NM_API_URL');
const SECRET = need('FLEET_SECRET');
const ACTOR_SECRET = env('NM_ACTOR_SECRET', '');
const HQ = need('HQ_URL');
const IAP_SA = need('IAP_SA');
const RELAY = need('NM_RELAY_URL');
const RELAY_KEY = need('NM_RELAY_TOKEN_KEY');
const OUT = resolve(env('OUT', 'coding-evals-out'));
const SUITE = JSON.parse(readFileSync(join(ROOT, 'evals/coding/cases.json'), 'utf8'));
const CASES = env('EVAL_CASES', 'simple,medium,complex').split(',').map((s) => s.trim()).filter(Boolean);
const BENCH_DIR = join(ROOT, 'packages/bench/suite/developer');
/** a bench developer task as a Code session: the same Plan, Act and review flow, no npm test (the
 *  workspace has no package.json), graded by its hidden fail-to-pass test */
function benchSpec(name) {
  const task = JSON.parse(readFileSync(join(BENCH_DIR, name, 'task.json'), 'utf8'));
  const prompt = `Task #${task.number}: ${task.title}.\nRequirements:\n${task.requirements.map((r) => `- ${r}`).join('\n')}\nDefinition of done:\n${task.definitionOfDone}\nInspect the workspace and propose a short plan; wait for Act. Then implement it in the existing files under src/ with file-edit tools. Keep the module's exports. No installs, servers or commits.`;
  return { id: `bench-${name}`, title: `bench developer ${task.number}: ${task.title}`, kind: 'bench', timeoutSeconds: 600, preview: false, prompt, fixtureDir: join(BENCH_DIR, name, 'workspace'), hidden: join(BENCH_DIR, name, 'tests/failToPass.mjs'), shared: true };
}
function specsOf(cases) {
  return cases.flatMap((id) => {
    if (id === 'bench') return readdirSync(BENCH_DIR).filter((n) => existsSync(join(BENCH_DIR, n, 'task.json'))).sort().map(benchSpec);
    if (id.startsWith('bench:')) return id.slice(6).split('+').map(benchSpec);
    const c = SUITE.cases.find((x) => x.id === id);
    if (!c) throw new Error(`unknown case ${id}`);
    return [{ ...c, kind: 'coding', fixtureDir: join(ROOT, 'evals/coding/fixtures', c.id) }];
  });
}
const MODEL = env('EVAL_MODEL', '');
const HANDOFF = env('EVAL_HANDOFF_MODEL', '');
const STARTER_MODEL = env('NM_E2E_MODEL', 'gemini-3.5-flash-lite');
/** 0: the session starts on the awake runner (no park before it, no wake timing). For a deploy where
 *  the Code lane cannot yet open on a runner that is starting */
const PARK_BEFORE = env('EVAL_PARK_BEFORE', '1') !== '0';
/** a video of each case's hq page (<case>/<case>.webm beside its screenshots); EVAL_VIDEO=0 turns it off */
const VIDEO = env('EVAL_VIDEO', '1') !== '0';
const tag = `r6eval-${Date.now().toString(36)}`;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s]`, ...a);

// ── nm-api (run.mjs's call, cmd and machine) ─────────────────────────────────────────────────
let actor = null;
async function call(method, path, { body, fleet = false, as = actor } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (fleet) headers.authorization = `Bearer ${SECRET}`;
  if (as) headers['x-nm-actor'] = JSON.stringify(as);
  if (as && ACTOR_SECRET) headers['x-nm-actor-secret'] = ACTOR_SECRET;
  const res = await fetch(`${API}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`), { status: res.status, json });
  return json;
}
const cmd = (c) => call('POST', '/v1/commands', { body: c });
const machineRow = (id) => call('GET', `/internal/e2e/machines/${id}`, { fleet: true, as: null });

async function waitFor(label, read, budgetMs, everyMs = 2_000) {
  const start = Date.now();
  for (;;) {
    const v = await read().catch(() => null);
    if (v) return v;
    if (Date.now() - start > budgetMs) throw new Error(`timed out after ${Math.round(budgetMs / 1000)}s waiting for: ${label}`);
    await sleep(everyMs);
  }
}
/** this epoch keeps reporting: last_seen_at moves twice while the predicate holds (run.mjs running) */
async function running(id, pred, budgetMs) {
  let prev = null; let moves = 0;
  return waitFor('the machine running and reporting', async () => {
    const m = await machineRow(id);
    const moved = prev !== null && !!m.last_seen_at && m.last_seen_at !== prev;
    prev = m.last_seen_at ?? '';
    moves = pred(m) && moved ? moves + 1 : pred(m) ? moves : 0;
    return moves >= 2 ? m : null;
  }, budgetMs, 2_500);
}
/** desired 0, no drain, and no beat for 20 s (run.mjs asleep) */
async function asleep(id, budgetMs) {
  let quiet = null; let last = null;
  return waitFor('the machine parked and silent', async () => {
    const m = await machineRow(id);
    if (m.desired_replicas !== 0 || m.drain_state !== null) { quiet = null; return null; }
    if (m.last_seen_at !== last) { last = m.last_seen_at; quiet = Date.now(); return null; }
    return Date.now() - quiet >= 20_000 ? m : null;
  }, budgetMs, 2_500);
}
async function park(id, budgetMs = 300_000) {
  const now = await machineRow(id);
  if (!(now.desired_replicas === 0 && now.drain_state === null)) {
    await call('POST', `/internal/machines/${id}/idle-drain`, { fleet: true, as: null, body: {} }).catch((e) => { if (e.status !== 409) throw e; });
  }
  return asleep(id, budgetMs);
}

// ── the IAP identity ─────────────────────────────────────────────────────────────────────────
/** a self-signed JWT for the smoke account (cloudbuild-hq-browser.yaml's, signed here so a long run
 *  can sign a fresh one before the 60-minute expiry) */
async function iapJwt() {
  if (process.env.IAP_JWT) return process.env.IAP_JWT.trim();
  const meta = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  if (!meta.ok) throw new Error(`metadata token ${meta.status}`);
  const { access_token: token } = await meta.json();
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ iss: IAP_SA, sub: IAP_SA, aud: `${HQ}/*`, iat: now, exp: now + 3600 });
  const res = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${IAP_SA}:signJwt`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ payload }),
  });
  if (!res.ok) throw new Error(`signJwt ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).signedJwt;
}

/** a Secret Manager value through the build's own identity (no gcloud in the Playwright image) */
async function secretValue(version) {
  const meta = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  if (!meta.ok) throw new Error(`metadata token ${meta.status}`);
  const { access_token: token } = await meta.json();
  const res = await fetch(`https://secretmanager.googleapis.com/v1/${version}:access`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`secret ${version.split('/secrets/')[1] ?? '?'}: ${res.status}`);
  return Buffer.from((await res.json()).payload.data, 'base64').toString('utf8').trim();
}
const KEY_SECRET = env('EVAL_KEY_SECRET', '');

// ── the relay terminal in the agent box (relay-terminal.mjs) ─────────────────────────────────
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function relayToken(sub, key, ttl = 3000) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'nm-hq-relay' }))}.${b64url(JSON.stringify({ sub, aud: 'nm-relay', iat: now, exp: now + ttl }))}`;
  return `${input}.${b64url(createHmac('sha256', Buffer.from(key, 'base64url')).update(input).digest())}`;
}
// eslint-disable-next-line no-control-regex
const clean = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r/g, '');

class BoxTerminal {
  constructor(user, machine) { this.user = user; this.machine = machine; this.out = ''; this.n = 0; this.ws = null; this.closed = null; }
  /** attach and open a terminal; a machine that just woke may not be on the relay yet (4404), so retry */
  async open(budgetMs = 180_000) {
    const start = Date.now();
    for (let attempt = 1; ; attempt++) {
      const ok = await this.#dial().catch((e) => { this.lastError = e.message; return false; });
      if (ok) break;
      // a wrong-shard refusal names the machine's shard: dial it at once, once
      if (this.closed?.code === WRONG_SHARD_CLOSE && !this.shardFollowed) {
        const next = wrongShardTarget(this.closed.reason, parseRelayShards(RELAY), this.url);
        if (next) { this.url = next; this.shardFollowed = true; continue; }
      }
      if (Date.now() - start > budgetMs) throw new Error(`the relay terminal did not open in ${budgetMs / 1000}s: ${this.lastError ?? JSON.stringify(this.closed)}`);
      await sleep(Math.min(8_000, 1_000 * attempt));
    }
    // no echo: the typed commands (and the fixture's base64) then never mix with their output
    // a PTY makes git page its output, and a pager waits for a key that never comes (the bench
    // run 915b703b hung on "--More--" after every diff): no pager in this shell
    this.#type('stty -echo; export PS1="$ " PS2="" PAGER=cat GIT_PAGER=cat; cd /work\r');
    await sleep(800);
    const probe = await this.run('echo ok', 15_000);
    if (probe.out.trim() !== 'ok') throw new Error(`the box shell did not answer: ${JSON.stringify(probe)}`);
  }
  async #dial() {
    this.ch = `eval-${randomBytes(4).toString('hex')}`;
    this.out = ''; this.closed = null;
    this.url ??= shardUrlFor(RELAY, this.machine) || RELAY;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    let attached = null;
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.t === 'attached') attached = m;
      else if (m.ch === this.ch && m.t === 'data' && typeof m.d === 'string') this.out += Buffer.from(m.d, 'base64').toString('utf8');
      else if (m.ch === this.ch && m.t === 'close') this.closed = { by: 'machine' };
    });
    ws.addEventListener('close', (ev) => { this.closed = { code: ev.code, reason: ev.reason }; });
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('the socket did not open')), { once: true }); });
    ws.send(JSON.stringify({ t: 'attach', machineId: this.machine, token: relayToken(this.user, RELAY_KEY) }));
    for (let i = 0; i < 100 && !attached && !this.closed; i++) await sleep(100);
    if (!attached) { try { ws.close(); } catch { /* gone */ } throw new Error(`not attached: ${JSON.stringify(this.closed)}`); }
    ws.send(JSON.stringify({ ch: this.ch, t: 'open', cols: 200, rows: 50 }));
    for (let i = 0; i < 200 && !/[#$] $/m.test(this.out) && !this.closed; i++) await sleep(100);
    if (!/[#$] $/m.test(this.out)) { try { ws.close(); } catch { /* gone */ } throw new Error(`no prompt: ${clean(this.out).slice(-200) || JSON.stringify(this.closed)}`); }
    return true;
  }
  #type(s) { this.ws.send(JSON.stringify({ ch: this.ch, t: 'data', d: Buffer.from(s).toString('base64') })); }
  /** run one shell line; its output and exit code, between split markers the shell prints */
  /** run one shell line. A socket the relay closed (a relay roll says 1012) is dialed again and the
   *  line runs once more on the new shell: every line the driver sends is safe to repeat */
  async run(line, ms = 60_000) {
    try { return await this.#runOnce(line, ms); }
    catch (e) {
      if (!this.closed || this.reopening) throw e;
      this.reopens = (this.reopens ?? 0) + 1;
      return this.#runOnce(line, ms);
    }
  }
  async #runOnce(line, ms) {
    if (this.closed && !this.reopening) {
      this.reopening = true;
      try { await this.open(); } finally { this.reopening = false; }
    }
    const id = ++this.n;
    const from = this.out.length;
    this.#type(`echo "NM""B${id}"; ${line}; echo "NM""E${id}[$?]"\r`);
    const re = new RegExp(`NMB${id}\\n([\\s\\S]*?)\\n?NME${id}\\[(\\d+)\\]`);
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const m = re.exec(clean(this.out.slice(from)));
      if (m) return { code: Number(m[2]), out: m[1] };
      if (this.closed) throw new Error(`the terminal closed: ${JSON.stringify(this.closed)}`);
      await sleep(150);
    }
    throw new Error(`no answer in ${ms / 1000}s to: ${line.slice(0, 120)} (last output: ${clean(this.out.slice(from)).slice(-200)})`);
  }
  /** a file into the box, as base64 lines through a heredoc (no secret ever rides this) */
  async write(path, buf) {
    const lines = Buffer.from(buf).toString('base64').match(/.{1,76}/g) ?? [];
    this.#type(`base64 -d > '${path}' <<'NMEOF'\r`);
    for (let i = 0; i < lines.length; i += 40) { this.#type(`${lines.slice(i, i + 40).join('\r')}\r`); await sleep(40); }
    this.#type('NMEOF\r');
    const r = await this.run(`wc -c < '${path}'`, 30_000);
    if (Number(r.out.trim()) !== buf.length) throw new Error(`wrote ${r.out.trim()} bytes to ${path}, not ${buf.length}`);
  }
  /** a file out of the box (gzip + base64), or null when it is absent */
  async read(path, ms = 60_000) {
    const r = await this.run(`if [ -f '${path}' ]; then gzip -c '${path}' | base64 -w0; echo; else echo NOFILE; fi`, ms);
    const text = r.out.trim();
    return text === 'NOFILE' || !text ? null : zlib.gunzipSync(Buffer.from(text, 'base64'));
  }
  close() { try { this.ws?.send(JSON.stringify({ ch: this.ch, t: 'close' })); this.ws?.close(1000, 'done'); } catch { /* gone */ } }
}

// ── the oracle, every check recorded ─────────────────────────────────────────────────────────
/** scripts/coding-evals/oracle.mjs with ONE change: a failing check is recorded and the next one
 *  runs, instead of the first failure ending the script. The checks themselves are untouched. */
function oracleEveryCheck() {
  const src = readFileSync(join(ROOT, 'scripts/coding-evals/oracle.mjs'), 'utf8');
  const a = 'const check=(name,fn)=>{fn();checks.push(name);};';
  const b = "console.log(JSON.stringify({passed:true,checks}));";
  if (!src.includes(a) || !src.includes(b)) throw new Error('oracle.mjs changed shape: update oracleEveryCheck');
  return src
    .replace(a, 'const failed=[];const check=(name,fn)=>{try{fn();checks.push(name);}catch(e){failed.push({name,error:String(e&&e.message||e).slice(0,300)});}};')
    .replace(b, 'console.log("NMORACLE"+JSON.stringify({passed:failed.length===0&&checks.length>0,checks,failed}));');
}

// ── hq in the browser (flow.mjs, on Playwright) ──────────────────────────────────────────────
const require = createRequire(process.env.PW_DIR ? join(resolve(process.env.PW_DIR), 'resolve.js') : import.meta.url);
const { chromium } = require('playwright-core');

const uiState = (p) => p.evaluate(() => ({
  url: location.href, text: document.querySelector('.codingthread')?.innerText ?? '',
  busy: document.querySelector('.codingthread .cagent')?.disabled ?? false,
  agent: document.querySelector('.codingthread .cagent')?.textContent ?? '',
  model: document.querySelector('.codingthread .cmodel')?.textContent ?? '',
  replies: [...document.querySelectorAll('.codingthread .msg:not(.human)')].map((e) => e.innerText),
  answered: [...document.querySelectorAll('.codingthread .msg:not(.human):not(.ghostmsg):not([role="status"])')].some((e) => e.innerText.trim().length > 0),
  progress: (() => { const x = document.querySelector('[data-plan-progress]'); return x ? { done: Number(x.dataset.completed), total: Number(x.dataset.total) } : null; })(),
  plan: !!document.querySelector('[data-work-plan="inline"]'),
  handoff: !!document.querySelector('[aria-label="Continue in Act mode"]'),
  cards: [...document.querySelectorAll('[data-change-review]')].map((e) => ({ id: e.dataset.changeReview, status: e.dataset.status, files: [...e.querySelectorAll('button[aria-label^="Review "]')].map((b) => b.getAttribute('aria-label').replace(/^Review /, '').replace(/ in this change set$/, '')) })),
  approval: document.querySelector('.engapproval') ? {
    commands: [...document.querySelectorAll('.engapproval code')].map((e) => e.textContent),
    // an approval card can carry file changes too (EngineeringApproval.tsx "Review proposed <path>")
    files: [...document.querySelectorAll('.engapproval button[aria-label^="Review proposed "]')].map((b) => b.getAttribute('aria-label').replace(/^Review proposed /, '')),
    title: document.querySelector('.engapprovaltop')?.textContent,
  } : null,
  // the GitHub card itself (thread/GitHubGate.tsx), not words in the thread: a model can quote a tool's
  // hint about GitHub (r7 build ede25023: the starter repeated "...the Connect GitHub card..." verbatim)
  gate: (() => { const g = document.querySelector('.codingthread .hgate'); return g && !/GitHub is connected/.test(g.textContent ?? '') ? (g.textContent ?? '').trim().slice(0, 200) : null; })(),
}));

async function capture(p, dir, label) {
  mkdirSync(dir, { recursive: true });
  await p.screenshot({ path: join(dir, `${label}.png`) }).catch(() => {});
  const aria = await p.locator('body').ariaSnapshot({ timeout: 10_000 }).catch((e) => `# ariaSnapshot failed: ${String(e.message).split('\n')[0]}`);
  writeFileSync(join(dir, `${label}.txt`), aria);
}

async function selectModel(p, scope, name, level = 'Medium') {
  await p.click(`${scope} .cmodel`);
  await p.click(`button[aria-label="Thinking for ${name}"]`);
  await p.click(`.cmodlv button >> nth=${['Low', 'Medium', 'High'].indexOf(level)}`);
  await p.waitForFunction(() => !document.querySelector('.cmodpop'), undefined, { timeout: 15_000 });
}

/** flow.mjs requireApprovals: the thread's permission mode (upstream's PermissionPicker,
 *  @neuramesh/shared permission-mode.ts) is set to Request Review, so edits and commands both reach
 *  the review gates whatever the workspace default is. Request Review also asks before web and
 *  connector actions: turn() declines those (they are outside the eval policy), so a run never waits
 *  on one. */
async function requireApprovals(p) {
  await p.click('.codingthread .perm-trigger');
  const option = '[role="menuitemradio"]:has-text("Request Review")';
  await p.waitForSelector(option);
  await p.click(option);
  await p.waitForSelector('.codingthread button[aria-label="Permissions: Request Review"]');
  await p.waitForSelector('[role="menu"][aria-label="Thread permissions"]', { state: 'hidden' });
}

async function fullPlanProgress(p) {
  await p.click('.codingthread [aria-label="Open plan"] >> nth=-1', { timeout: 15_000 });
  await p.waitForSelector('[data-work-plan="pane"]', { timeout: 15_000 });
  return p.evaluate(() => {
    const items = [...document.querySelectorAll('[data-work-plan="pane"] [aria-label="Work plan steps"] li')];
    return { total: items.length, done: items.filter((i) => i.classList.contains('complete')).length };
  });
}

/** the eval's command policy (support.mjs allowedCommand), with the cloud worktree's host or box
 *  path as the one cd prefix it allows: the thread id ends its directory name */
function allowedCloudCommand(command, threadId) {
  let c = command.trim();
  const m = /^cd\s+(['"]?)(\/(?:nm\/)?work\/brain\/cache\/worktrees\/[\w-]+)\1\s+&&\s+/.exec(c);
  if (m && m[2].endsWith(`-${threadId}`)) c = c.slice(m[0].length);
  return /^(?:npm test|node --test(?: test\/\*\.test\.mjs)?)$/.test(c);
}

const turnSettled = (s, initial) => !s.busy && !s.cards.some((c) => c.status === 'proposed') && !s.approval && s.replies.length > initial && !s.progress;

/** flow.mjs turn on hq: drives only visible user controls. An action outside the eval's policy is
 *  declined and recorded (the desktop runner stops there; a declined call leaves the model its turn,
 *  which is the more useful datum on a cloud run), never approved. */
async function turn(p, ctx, { planning = false, replyCount, completionCheck, timeoutSeconds, quietSeconds = 240 }) {
  const { spec, result, dir } = ctx;
  const until = Date.now() + timeoutSeconds * 1000;
  const seen = new Set();
  const initial = replyCount ?? (await uiState(p)).replies.length;
  let tick = 0; let stable = 0; let nextShot = Date.now() + 20_000; let lastText = ''; let changedAt = Date.now(); let lastCheck = 0;
  while (Date.now() < until) {
    const s = await uiState(p);
    if (!result.timings.firstTokenMs && s.answered && ctx.sentAt) result.timings.firstTokenMs = Date.now() - ctx.sentAt;
    const progress = s.text.replace(/\bthought for (?:\d+[smh]\s*)+/g, 'thought');
    if (progress !== lastText) { lastText = progress; changedAt = Date.now(); }
    if (Date.now() - changedAt > quietSeconds * 1000) throw Object.assign(new Error(`No visible progress for ${quietSeconds}s`), { kind: 'stall' });
    if (/local brain branch is safe|sync needs a retry|connection is unavailable/i.test(s.text)) throw Object.assign(new Error('Conversation sync or runtime connection failed'), { kind: 'platform' });
    if (s.gate) throw Object.assign(new Error(`the session cannot reach its repository: ${s.gate}`), { kind: 'platform' });
    if (s.progress && !seen.has(`progress-${s.progress.done}`)) {
      seen.add(`progress-${s.progress.done}`);
      result.events.push({ type: 'plan-progress', ...s.progress, at: new Date().toISOString() });
    }
    const proposed = s.cards.find((c) => c.status === 'proposed');
    if (proposed && !seen.has(proposed.id)) {
      seen.add(proposed.id);
      const sel = `[data-change-review="${proposed.id}"]`;
      if (await p.evaluate((x) => !!document.querySelector(`${x} button[aria-expanded="false"]`), sel)) await p.click(`${sel} button[aria-expanded="false"]`);
      const card = (await uiState(p)).cards.find((c) => c.id === proposed.id) ?? proposed;
      const inPolicy = !planning && card.files.length > 0 && card.files.every(allowedPath);
      await p.click(`${sel} button[aria-label^="Review "] >> nth=0`).catch(() => {});
      await p.waitForSelector('[aria-label="Code changes"]', { timeout: 10_000 }).catch(() => {});
      await capture(p, dir, `${++tick}-review`);
      if (inPolicy) {
        result.events.push({ type: 'review', files: card.files, at: new Date().toISOString() });
        await p.click(`${sel} .btn.primary`);
        log(`[${spec.id}] reviewed and approved ${card.files.length} files: ${card.files.join(', ')}`);
      } else {
        result.events.push({ type: 'policy-decline', what: planning ? 'edit in Plan mode' : 'edit outside fixture paths', files: card.files, at: new Date().toISOString() });
        await p.click(`${sel} button.btn:has-text("Decline")`).catch(() => {});
        log(`[${spec.id}] DECLINED an edit (${planning ? 'Plan mode' : 'outside policy'}): ${card.files.join(', ')}`);
      }
    } else if (s.approval?.commands.length && !await p.evaluate(() => document.querySelector('.engapproval .primary')?.disabled)) {
      const commands = s.approval.commands.flatMap(approvalCommands);
      const key = `cmd-${commands.join('\n')}-${result.events.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        await capture(p, dir, `${++tick}-command`);
        if (!planning && commands.length && commands.every((c) => allowedCloudCommand(c, result.threadId))) {
          result.events.push({ type: 'command', command: commands.join('\n'), at: new Date().toISOString() });
          await p.click('.engapproval .primary');
          log(`[${spec.id}] approved: ${commands.join(' ; ')}`);
        } else {
          result.events.push({ type: 'policy-decline', what: planning ? 'command in Plan mode' : 'command outside policy', command: commands.join('\n'), at: new Date().toISOString() });
          await p.click('.engapproval button.btn:has-text("Decline")');
          log(`[${spec.id}] DECLINED a command: ${commands.join(' ; ')}`);
        }
      }
    } else if (s.approval && !s.approval.commands.length && !await p.evaluate(() => document.querySelector('.engapproval .primary')?.disabled)) {
      // NOT a command and NOT a change-review card: file changes carried on the approval card itself,
      // or (Request Review) a web or connector action. Before permission modes nothing here asked,
      // and an unhandled card waited out the quiet timeout as a "stall"
      const files = s.approval.files ?? [];
      const key = `approval-${s.approval.title}-${files.join('\n')}-${result.events.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        await capture(p, dir, `${++tick}-approval`);
        if (!planning && files.length && files.every(allowedPath)) {
          result.events.push({ type: 'review', files, via: 'approval', at: new Date().toISOString() });
          await p.click('.engapproval .primary');
          log(`[${spec.id}] approved ${files.length} files on the approval card: ${files.join(', ')}`);
        } else {
          result.events.push({ type: 'policy-decline', what: files.length ? (planning ? 'edit in Plan mode' : 'edit outside fixture paths') : 'action outside the eval policy', title: s.approval.title, files, at: new Date().toISOString() });
          await p.click('.engapproval button.btn:has-text("Decline")');
          log(`[${spec.id}] DECLINED: ${s.approval.title}${files.length ? ` (${files.join(', ')})` : ''}`);
        }
      }
    }
    if (planning && s.plan && s.handoff && !s.busy) { await capture(p, dir, 'plan'); result.events.push({ type: 'plan', at: new Date().toISOString() }); return 'plan'; }
    // a planning turn that ended without a plan (the model never made a valid propose_work_plan): quiet,
    // idle and answered for 45 s. The caller records the failed gate and may continue in Act
    if (planning && !s.busy && !s.approval && s.replies.length > initial && !s.plan && Date.now() - changedAt > 45_000) { await capture(p, dir, 'no-plan'); result.events.push({ type: 'no-plan', at: new Date().toISOString() }); return 'no-plan'; }
    const current = planning ? s : await uiState(p);
    if (!planning && turnSettled(current, initial)) {
      if (++stable >= 2) {
        // the recording read costs a terminal round trip: at most every 10 s
        if (!completionCheck) { await capture(p, dir, `${++tick}-response`); return; }
        if (Date.now() - lastCheck > 10_000) {
          lastCheck = Date.now();
          if (await completionCheck()) { const after = await uiState(p); if (turnSettled(after, initial) && after.text === current.text) { await capture(p, dir, `${++tick}-response`); return; } }
        }
      }
    } else stable = 0;
    if (Date.now() > nextShot) { await capture(p, dir, `${++tick}-progress`); nextShot = Date.now() + 30_000; log(`[${spec.id}] ${planning ? 'planning' : 'working'} (${s.cards.length} change sets, ${s.replies.length} replies${s.busy ? ', busy' : ''})`); }
    await sleep(800);
  }
  throw Object.assign(new Error(`${spec.id} ${planning ? 'plan' : 'turn'} exceeded ${timeoutSeconds}s`), { kind: 'timeout' });
}

/** THE PREVIEW (lib/preview-probe.mjs): the app served on a loopback port in the box, opened in the
 *  machine's browser pane (the person tab, the relay's browser lane) as a person's preview is, then the
 *  probe page runs preview.mjs's checks on its DOM and posts them back to the box server */
async function previewInBox(term, spec, boxCwd, result, dir) {
  const port = 41730;
  const probes = { [spec.id]: probePage(spec.id) };
  await term.write('/tmp/nm-preview.mjs', Buffer.from(previewServerSource(probes)));
  await term.run(`rm -f /tmp/nm-preview-result.json; (nohup node /tmp/nm-preview.mjs '${boxCwd}' ${port} /tmp/nm-preview-result.json ${spec.id} > /tmp/nm-preview.log 2>&1 &) ; sleep 1; cat /tmp/nm-preview.log`);
  const relay = await RelayConnection.open({ url: RELAY, key: RELAY_KEY, user: result.ids.user, machine: result.ids.machine });
  try {
    const pane = await relay.browser({ tab: 'person', width: 1280, height: 900 });
    const opened = await pane.navigate(`http://localhost:${port}/`);
    const shot = pane.jpeg(); if (shot) writeFileSync(join(dir, 'preview-initial.jpg'), shot);
    result.checks.push({ name: 'the app opens in the machine browser pane (box loopback preview)', passed: !!opened.ok, detail: { title: opened.state?.title ?? null, url: opened.state?.url ?? null, notice: opened.notice } });
    if (!opened.ok) throw new Error(`the preview did not open: ${opened.notice}`);
    const probe = await pane.navigate(`http://localhost:${port}/__nm_probe`, 30_000);
    let res = null;
    for (let i = 0; i < 60 && !res; i++) {
      await sleep(2_000);
      const r = await term.run('cat /tmp/nm-preview-result.json 2>/dev/null || true');
      try { res = r.out.trim() ? JSON.parse(r.out.trim()) : null; } catch { res = null; }
    }
    const last = pane.jpeg(); if (last) writeFileSync(join(dir, 'preview-final.jpg'), last);
    pane.close();
    if (!res) throw new Error(`the probe posted no result (probe page: ${probe.notice ?? 'opened'})`);
    for (const c of res.checks) result.checks.push({ name: `preview: ${c.name}`, passed: c.passed });
    result.previewErrors = res.errors;
    const passed = res.checks.filter((c) => c.passed).length;
    return { summary: `${passed}/${res.checks.length} preview checks passed (DOM events in the machine's Chromium; the pane lane has only pixel input)` };
  } finally {
    relay.close();
    await term.run(`pkill -f nm-preview.mjs || true`).catch(() => {});
  }
}

/** THE WIZARD (hq-browser.mjs walkWizard): a new workspace may open on onboarding */
async function walkWizard(page) {
  const steps = [];
  for (let guard = 0; guard < 20; guard++) {
    const bar = page.locator('[role="progressbar"][aria-valuenow]');
    if (!(await bar.count())) return { steps, open: false };
    const label = (await bar.getAttribute('aria-label')) ?? '?';
    if (steps.at(-1) !== label) steps.push(label);
    if (Number(await bar.getAttribute('aria-valuenow')) === Number(await bar.getAttribute('aria-valuemax'))) {
      const meet = page.getByRole('button', { name: LAUNCH_BUTTON });
      await meet.waitFor({ timeout: 180_000 });
      await meet.click({ timeout: 30_000 });
      await bar.waitFor({ state: 'detached', timeout: 30_000 });
      return { steps, open: false, finished: true };
    }
    const skip = page.locator('button.proskip');
    if (await skip.count()) await skip.click({ timeout: 30_000 });
    else await page.getByRole('button', { name: /^continue/i }).click({ timeout: 60_000 });
    await page.waitForFunction((prev) => document.querySelector('[role="progressbar"][aria-valuenow]')?.getAttribute('aria-label') !== prev, label, { timeout: 60_000 });
  }
  return { steps, open: true };
}

// ── one case ─────────────────────────────────────────────────────────────────────────────────
const sha = (v) => createHash('sha256').update(v).digest('hex');

async function runCase(browserCtx, spec, shared) {
  const dir = join(OUT, spec.id);
  mkdirSync(dir, { recursive: true });
  const result = { id: spec.id, title: spec.title, startedAt: new Date().toISOString(), checks: [], events: [], timings: {}, ids: {}, model: MODEL || `room default (${STARTER_MODEL}, the starter brain)`, handoffModel: HANDOFF || null, preview: spec.preview ? 'not reached' : 'none' };
  const check = (name, yes, detail) => { result.checks.push({ name, passed: !!yes, ...(detail === undefined ? {} : { detail }) }); log(`[${spec.id}] ${yes ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 300)}`}`); return !!yes; };
  const phase = async (name, fn) => { const s = Date.now(); try { return await fn(); } finally { result.timings[`${name}Ms`] = Date.now() - s; } };
  const save = () => writeFileSync(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  let term = null; let page = null; let wakeWatch = null;
  const runtimesOf = async () => page ? page.evaluate(async (id) => (await window.__nmDb?.getAll('SELECT runtimes FROM machines WHERE id = ?', [id]))?.[0]?.runtimes ?? null, result.ids.machine).catch(() => null) : null;
  /** the workspace's own Gemini key, set the way hq's Models screen sets it: credential.set through the
   *  gateway (IAP, as this person). The key stays inside this call. Set right after the workspace is
   *  made, because the runner reports the runtimes a key unlocks when it boots, and the Code model chip
   *  offers Gemini only when that report names it (shared code-models.ts codeProviderStates) */
  const setKey = async () => {
    if (!KEY_SECRET || shared?.keyed?.includes(result.ids.workspace)) return;
    page ??= await browserCtx.newPage();
    const doc = await page.goto(`${HQ}/${encodeURIComponent(result.ids.slug)}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (doc?.status() !== 200) throw new Error(`hq answered ${doc?.status()}`);
    await page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, null, { timeout: 60_000 });
    const key = await secretValue(KEY_SECRET);
    const status = await page.evaluate(async ([ws, token]) => {
      const res = await fetch('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'credential.set', workspace: ws, provider: 'gemini', scope: 'workspace', authMode: 'apikey', token }) });
      return res.status;
    }, [result.ids.workspace, key]);
    if (status >= 300) throw Object.assign(new Error(`credential.set answered ${status}`), { kind: 'platform' });
    result.events.push({ type: 'credential', provider: 'gemini', scope: 'workspace', status, at: new Date().toISOString() });
    if (shared) (shared.keyed ??= []).push(result.ids.workspace);
    result.credentialsSeen = await page.evaluate(async (ws) => {
      const r = await fetch(`/v1/credentials?workspace=${encodeURIComponent(ws)}`);
      const j = await r.json().catch(() => null);
      return { status: r.status, rows: (j?.credentials ?? []).map((c) => ({ provider: c.provider, scope: c.scope, authMode: c.authMode })) };
    }, result.ids.workspace).catch((e) => ({ error: e.message }));
  };
  try {
    // setup: the smoke account's own nm user, a fresh workspace, its runner, rex on the starter
    const reuse = shared?.ids ? shared.ids : null;
    if (reuse) { Object.assign(result.ids, reuse); actor = { kind: 'human', id: reuse.user }; }
    if (!reuse) await phase('setup', async () => {
      const user = await call('POST', '/internal/e2e/users', { fleet: true, as: null, body: { email: IAP_SA } });
      actor = { kind: 'human', id: user.userId };
      const slug = `${tag}-${shared ? 'bench' : spec.id}`;
      const made = await cmd({ type: 'workspace.create', name: `R6 eval ${spec.id} ${tag.slice(-6)}`, slug });
      Object.assign(result.ids, { user: user.userId, workspace: made.workspaceId, channel: made.channelId, slug: made.slug ?? slug });
      const usage = await call('GET', `/v1/machines/usage?workspace=${made.workspaceId}`);
      let id = usage?.machines?.find((m) => m.kind === 'runner')?.id;
      if (!id) id = (await call('POST', '/internal/machines', { fleet: true, as: null, body: { workspaceId: made.workspaceId, kind: 'runner', ownerUserId: user.userId, name: 'runner' } })).machineId;
      result.ids.machine = id;
      const m = await machineRow(id);
      if (m.substrate !== 'cloudrun') throw new Error(`the runner is ${m.substrate}, not cloudrun`);
      await call('POST', `/internal/e2e/workspaces/${made.workspaceId}/fund`, { fleet: true, as: null, body: { plan: 'cloud', credits: 5000 } });
      const agent = await cmd({ type: 'agent.register', workspace: made.workspaceId, machineId: id, name: 'rex', role: 'orchestrator', model: STARTER_MODEL, runtime: 'gemini', channels: [made.channelId] });
      result.ids.agent = agent?.agentId ?? null;
      // a workspace born after the person's first gets no runner awake: one message wakes it
      if (m.desired_replicas !== 1) await call('POST', '/v1/messages', { body: { workspace: made.workspaceId, channel: made.channelId, body: 'Coding eval setup: say hi in one word.' } });
    });
    await setKey();
    save();
    if (reuse) {
      // a shared runner parked after the last task: one message wakes it for the fixture
      await call('POST', '/v1/messages', { body: { workspace: result.ids.workspace, channel: result.ids.channel, body: `Coding eval: next task ${spec.id}. Say ok in one word.` } });
    }
    const booted = await phase(reuse ? 'rewake' : 'boot', () => running(result.ids.machine, (r) => r.epoch >= 1 && r.drain_state === null && r.desired_replicas === 1, 420_000));
    result.ids.bootEpoch = booted.epoch;
    if (shared && !reuse) shared.ids = { user: result.ids.user, workspace: result.ids.workspace, channel: result.ids.channel, slug: result.ids.slug, machine: result.ids.machine, agent: result.ids.agent };

    // fixture: the case's starter as a git repository in the box, the oracle failing on it
    const name = `eval-${spec.id}-${tag.slice(-6)}`;
    await phase('fixture', async () => {
      term = new BoxTerminal(result.ids.user, result.ids.machine);
      await term.open();
      const tgz = execFileSync('tar', ['-czf', '-', '-C', spec.fixtureDir, '.']);
      const src = `/work/evals/${name}-src`;
      let r = await term.run(`mkdir -p /work/evals && rm -rf '${src}' && mkdir -p '${src}' && command -v git node npm | tr '\\n' ' '`);
      if (r.code !== 0) throw new Error(`the box cannot make /work/evals: ${r.out}`);
      result.box = { tools: r.out.trim() };
      await term.write(`/work/evals/${name}.tgz`, tgz);
      const g = '-c user.name="NeuraMesh Evals" -c user.email=evals@neuramesh.local';
      r = await term.run(`cd '${src}' && tar -xzf ../${name}.tgz && git init -q -b main && git ${g} add . && git ${g} commit -qm "coding eval v1 starter" && cd /work/evals && git clone --bare --quiet '${src}' '${name}.git' && git -C '${name}.git' rev-parse HEAD`, 60_000);
      if (r.code !== 0) throw new Error(`the fixture repository was not made: ${r.out.slice(-400)}`);
      result.ids.fixtureCommit = r.out.trim().split('\n').at(-1);
      if (spec.kind === 'bench') {
        await term.run(`mkdir -p '${src}/tests'`);
        await term.write(`${src}/tests/failToPass.mjs`, readFileSync(spec.hidden));
        r = await term.run(`cd '${src}' && timeout 20 node tests/failToPass.mjs > /tmp/nm-eval-ftp.log 2>&1; echo "FTP=$?"; cd /work`, 60_000);
        const baseFailed = !/FTP=0\b/.test(r.out);
        check('the hidden fail-to-pass test fails on the stub', baseFailed, r.out.slice(-200));
        if (!baseFailed) throw new Error('failToPass passes the stub: the fixture is broken');
      } else {
        await term.write('/tmp/nm-eval-oracle.mjs', Buffer.from(oracleEveryCheck()));
        r = await term.run(`node /tmp/nm-eval-oracle.mjs ${spec.id} '${src}' 2>&1 | tail -c 2000; rm -f /tmp/nm-eval-oracle.mjs`, 60_000);
        const baseline = /NMORACLE(\{.*\})/.exec(r.out);
        const baseFailed = !baseline || JSON.parse(baseline[1]).passed === false;
        check('the acceptance oracle fails on the unimplemented starter', baseFailed, baseline ? JSON.parse(baseline[1]).failed?.map((f) => f.name) : r.out.slice(-200));
        if (!baseFailed) throw new Error('the oracle passes the starter: the fixture is broken');
      }
      await term.run(`rm -rf '${src}' /work/evals/${name}.tgz`);
      term.close(); term = null;
    });
    // the repository, through the stand-in for the GitHub App connect
    const repo = await phase('repo', () => call('POST', `/internal/e2e/workspaces/${result.ids.workspace}/repos`, { fleet: true, as: null, body: { channel: result.ids.channel, name, cloneUrl: `file:///nm/work/evals/${name}.git` } }));
    Object.assign(result.ids, { repo: repo.repoId, repoLabel: repo.label });
    // park, so the fixture crosses a sleep and the session starts on a parked runner
    if (KEY_SECRET && page) {
      // the runner probes its keys at boot (and every 10 minutes): one that booted before the key
      // landed still reports no gemini, and the chip would refuse the model. One park and wake fixes
      // that, the way a person's next wake would
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForFunction(() => !!window.__nmDb?.currentStatus?.lastSyncedAt, null, { timeout: 60_000, polling: 500 }).catch(() => {});
      result.runtimesAfterBoot = await runtimesOf();
      if (!String(result.runtimesAfterBoot ?? '').includes('gemini')) {
        await phase('rebootForKey', async () => {
          const p0 = await park(result.ids.machine);
          await call('POST', '/v1/messages', { body: { workspace: result.ids.workspace, channel: result.ids.channel, body: 'Coding eval: wake to read the new key. Say ok in one word.' } });
          await running(result.ids.machine, (r) => r.epoch > p0.epoch && r.drain_state === null && r.desired_replicas === 1, 420_000);
          await sleep(5_000);
        });
        result.events.push({ type: 'reboot-for-key', runtimesBefore: result.runtimesAfterBoot });
      }
    }
    const parked = PARK_BEFORE ? await phase('park', () => park(result.ids.machine)) : await machineRow(result.ids.machine);
    result.ids.parkedEpoch = parked.epoch;
    result.snapshotAfterFixture = PARK_BEFORE ? parked.snapshot_work : null;
    result.parkBefore = PARK_BEFORE;
    save();

    // the session, in hq
    page ??= await browserCtx.newPage();
    await page.setViewportSize({ width: 1600, height: 1050 });
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e?.message ?? e).slice(0, 300)));
    await phase('hqLoad', async () => {
      const doc = await page.goto(`${HQ}/${encodeURIComponent(result.ids.slug)}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      if (doc?.status() !== 200) throw new Error(`hq answered ${doc?.status()}`);
      await page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, null, { timeout: 60_000 });
      await page.waitForFunction(() => !!window.__nmDb?.currentStatus?.lastSyncedAt, null, { timeout: 120_000, polling: 500 }).catch(() => {});
      result.wizard = await walkWizard(page).catch((e) => ({ error: e.message }));
      // what the Code model chip decides Gemini on (shared code-models.ts codeProviderStates): the
      // runner's reported runtimes, from the replica
      result.machineRuntimes = await page.evaluate(async (id) => (await window.__nmDb?.getAll('SELECT runtimes FROM machines WHERE id = ?', [id]))?.[0]?.runtimes ?? null, result.ids.machine).catch((e) => `error: ${e.message}`);
      await capture(page, dir, '00-loaded');
    });
    const ctx = { spec, result, dir, sentAt: null };
    // a wake watcher: the send below wakes the parked runner (send → a new epoch running)
    const wake = async () => {
      const m = await running(result.ids.machine, (r) => r.desired_replicas === 1 && r.epoch > parked.epoch && r.drain_state === null, 600_000).catch((e) => ({ error: e.message }));
      if (!m.error) { result.timings.wakeMs = Date.now() - ctx.sentAt; result.ids.sessionEpoch = m.epoch; }
      else result.wakeError = m.error;
    };
    await phase('start', async () => {
      await page.click('[aria-label="New session"]', { timeout: 30_000 });
      await page.waitForSelector('.stagebox', { timeout: 30_000 });
      await page.click('.stagebox .crepo');
      const item = page.getByRole('menuitemradio', { name: new RegExp(repo.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
      await item.waitFor({ timeout: 90_000 });
      await capture(page, dir, '01-repo-picker');
      await item.click();
      if (MODEL) {
        await selectModel(page, '.stagebox', MODEL).catch(async (e) => {
          // the labels the menu offered, so a wrong label is plain in the evidence
          const offered = await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="Thinking for "]')].map((b) => b.getAttribute('aria-label').slice(13))).catch(() => []);
          await capture(page, dir, '01b-model-menu');
          throw new Error(`model "${MODEL}" not selectable (${e.message.split('\n')[0]}); the menu offers: ${offered.join(', ') || 'nothing'}`);
        });
      }
      await page.fill('.stagebox textarea', spec.prompt);
      await capture(page, dir, '02-composed');
      ctx.sentAt = Date.now();
      if (PARK_BEFORE) wakeWatch = wake();
      await page.click('.stagebox button[aria-label="Send"]');
      await page.waitForSelector('.codingthread', { timeout: 60_000 });
      await page.waitForURL(/\/c\/[^/?]+/, { timeout: 30_000 }).catch(() => {});
      result.threadId = decodeURIComponent((page.url().match(/\/c\/([^/?]+)/) ?? [])[1] ?? '');
      result.url = page.url();
      if (!result.threadId) throw new Error('the thread URL holds no id');
    });
    save();

    // plan
    const planOutcome = await phase('planTurn', () => turn(page, ctx, { planning: true, timeoutSeconds: spec.timeoutSeconds + 600, quietSeconds: 420 }));
    const gated = planOutcome === 'plan';
    check('plan card and implementation gate are visible', gated);
    const planned = (await uiState(page)).progress;
    check('unfinished new plan shows zero completed steps', planned?.total > 0 && planned.done === 0, planned);
    // the worktree the machine cut for the thread, seen from the box
    term = new BoxTerminal(result.ids.user, result.ids.machine);
    await term.open();
    const wt = await term.run(`ls -d /work/brain/cache/worktrees/*-${result.threadId} 2>/dev/null | head -1`);
    const boxCwd = wt.out.trim();
    result.cwd = boxCwd.replace(/^\/work\//, '/nm/work/');
    result.boxCwd = boxCwd;
    if (!boxCwd) throw Object.assign(new Error('no worktree for the thread under /work/brain/cache/worktrees'), { kind: 'platform' });
    // the worktree's .git names its git dir by the HOST path (/nm/work/...), which the box shell
    // may not have (it sees /work): map it, rather than read a missing path as "not a repository"
    const gitIn = (args) => `cd '${boxCwd}' && gd=$(sed -n 's#^gitdir: /nm/work/#/work/#p' .git) && git --no-pager -c safe.directory='*' --git-dir="$gd" --work-tree=. ${args}; rc=$?; cd /work; (exit $rc)`;
    result.box.nmWorkAlias = (await term.run('test -e /nm/work && echo yes || echo no')).out.trim();
    const status = await term.run(gitIn('status --porcelain'));
    check('planning left repository unchanged', status.code === 0 && !status.out.trim(), status.out.slice(0, 300));
    const recordingPath = `/work/brain/conversations/${sha(result.ids.workspace)}/${sha(result.ids.user)}/${sha(result.threadId)}/runtime.json`;
    const readRecording = async () => { const buf = await term.read(recordingPath).catch(() => null); try { return buf ? JSON.parse(buf.toString('utf8')) : { messages: [] }; } catch { return { messages: [] }; } };
    const verify = async (label, afterIndex = -1, previous = null) => {
      const rec = await readRecording();
      const response = rec.messages?.findLast((m) => m.role === 'assistant' && m.modelInfo);
      const progress = agentPlanProgress(rec.messages ?? []);
      const v = { ...agentVerification(rec.messages ?? [], result.cwd, afterIndex), progress, model: response?.modelInfo?.id, provider: response?.modelInfo?.provider, messages: rec.messages?.length ?? 0 };
      const fresh = !previous || (v.index > previous.index);
      v.passed = v.passed && fresh && !!progress && progress.done === progress.total;
      writeFileSync(join(dir, `${label}-agent-verification.json`), `${JSON.stringify(v, null, 2)}\n`);
      return v;
    };

    // Act
    await requireApprovals(page);
    result.events.push({ type: 'permissions', mode: 'request-review', edit: 'ask', command: 'ask' });
    const beforeAct = (await uiState(page)).replies.length;
    if (gated) await page.click('[aria-label="Continue in Act mode"] .primary');
    else {
      // NOT the product's gate: the composer's own Act toggle and one plain follow-up, so Act, the tests
      // and the oracle still get graded. Recorded, and never a first pass
      result.events.push({ type: 'plan-fallback', note: 'no plan card: switched the composer to Act and asked to continue', at: new Date().toISOString() });
      result.firstPass = false;
      await page.click('.codingthread button[aria-pressed]:has-text("Act")');
      await page.fill('.codingthread textarea', spec.kind === 'bench'
        ? 'Continue in Act mode: implement the task from my first message now, in the existing files under src/.'
        : 'Continue in Act mode: implement the complete task from my first message now, add the tests and run npm test.');
      await page.click('.codingthread button[aria-label="Send"]');
    }
    const bench = spec.kind === 'bench';
    const na = (name, why) => { result.checks.push({ name, passed: null, status: `not applicable (${why})` }); };
    await phase('actTurn', () => turn(page, { ...ctx, dir: join(dir, 'implementation') }, { replyCount: beforeAct, timeoutSeconds: spec.timeoutSeconds, completionCheck: bench ? null : async () => (await verify('implementation')).passed }).catch((e) => { if (e.kind === 'platform') throw e; result.actError = e.message; }));
    result.implementationVerification = await verify('implementation');
    if (bench) na('agent tests passed inside the coding sandbox', 'a bench workspace has no tests');
    else check('agent tests passed inside the coding sandbox', result.implementationVerification.passed, { index: result.implementationVerification.index, lastEdit: result.implementationVerification.lastEdit, progress: result.implementationVerification.progress, model: result.implementationVerification.model });
    const execution = await fullPlanProgress(page).catch((e) => ({ error: e.message }));
    check('plan steps explicitly complete after execution', execution?.total > 0 && execution.done === execution.total, execution);
    check('completed plan hides composer progress', !(await uiState(page)).progress);

    if (spec.followup && !result.actError) {
      if (HANDOFF) { await selectModel(page, '.codingthread', HANDOFF); result.events.push({ type: 'model-handoff', to: HANDOFF }); }
      else result.events.push({ type: 'model-handoff', to: null, note: 'no second model in this run: the follow-up runs on the same model' });
      await page.waitForFunction(() => !document.querySelector('.codingthread .cagent')?.disabled, undefined, { timeout: 60_000 });
      await capture(page, dir, 'model-handoff');
      const beforeFollowup = (await uiState(page)).replies.length;
      await page.fill('.codingthread textarea', spec.followup);
      await page.click('.codingthread button[aria-label="Send"]');
      await phase('followupTurn', () => turn(page, { ...ctx, dir: join(dir, 'followup') }, { replyCount: beforeFollowup, timeoutSeconds: spec.timeoutSeconds, completionCheck: async () => (await verify('followup', -1, result.implementationVerification)).passed }).catch((e) => { if (e.kind === 'platform') throw e; result.followupError = e.message; }));
      result.followupVerification = await verify('followup', -1, result.implementationVerification);
      check('handoff agent tests passed inside the coding sandbox', result.followupVerification.passed, { index: result.followupVerification.index, model: result.followupVerification.model });
      check('handoff performed a new test run', result.followupVerification.index > result.implementationVerification.index);
      if (HANDOFF) {
        check('followup ran on the selected model', (await uiState(page)).model.includes(HANDOFF));
        check('recorded provider model changed for the followup', !!result.followupVerification.model && result.followupVerification.model !== result.implementationVerification.model);
      } else result.checks.push({ name: 'model handoff', passed: null, status: 'not run (one model in this run)' });
    }

    const s = await uiState(page);
    const finalProgress = await fullPlanProgress(page).catch((e) => ({ error: e.message }));
    check('final plan steps are complete', finalProgress.total > 0 && finalProgress.done === finalProgress.total, finalProgress);
    check('final composer progress is hidden', !s.progress);
    check('file review approvals occurred', result.events.some((e) => e.type === 'review'));
    if (bench) na('agent requested test execution', 'a bench workspace has no tests');
    else check('agent requested test execution', result.events.some((e) => e.type === 'command' && /test/.test(e.command)));
    check('applied change cards remain in transcript', s.cards.some((c) => c.status === 'applied'), s.cards.map((c) => c.status));
    check('the agent stayed inside the eval policy (nothing declined)', !result.events.some((e) => e.type === 'policy-decline'), result.events.filter((e) => e.type === 'policy-decline'));

    // grade in the box: npm test again, and the hidden oracle
    await phase('grade', async () => {
      if (bench) {
        // the hidden test goes in only now, and out again after it ran
        const had = await term.run(`test -d '${boxCwd}/tests' && echo yes || echo no`);
        await term.run(`mkdir -p '${boxCwd}/tests'`);
        await term.write(`${boxCwd}/tests/nm-hidden-failToPass.mjs`, readFileSync(spec.hidden));
        const f = await term.run(`cd '${boxCwd}' && s=$(date +%s%3N); timeout 20 node tests/nm-hidden-failToPass.mjs > /tmp/nm-eval-ftp.log 2>&1; rc=$?; e=$(date +%s%3N); cd /work; rm -f '${boxCwd}/tests/nm-hidden-failToPass.mjs'; ${had.out.trim() === 'no' ? `rmdir '${boxCwd}/tests' 2>/dev/null;` : ''} echo "FTP=$rc FTPMS=$((e-s))"; tail -c 3000 /tmp/nm-eval-ftp.log`, 60_000);
        writeFileSync(join(dir, 'hidden-test.log'), f.out);
        const m = /FTP=(\d+) FTPMS=(\d+)/.exec(f.out);
        result.timings.hiddenTestInBoxMs = m ? Number(m[2]) : null;
        check('hidden fail-to-pass test passes', !!m && m[1] === '0', m ? { exit: Number(m[1]) } : f.out.slice(-200));
        na('generated project tests pass independently', 'a bench workspace has no tests');
        const diff = await term.run(`${gitIn('status --short')}; ${gitIn('diff --stat HEAD')} | tail -40`);
        writeFileSync(join(dir, 'diff-stat.txt'), diff.out);
        return;
      }
      const t = await term.run(`cd '${boxCwd}' && s=$(date +%s%3N); timeout 120 npm test > /tmp/nm-eval-npm.log 2>&1; rc=$?; e=$(date +%s%3N); cd /work; echo "NPMRC=$rc NPMMS=$((e-s))"; tail -c 6000 /tmp/nm-eval-npm.log`, 180_000);
      const m = /NPMRC=(\d+) NPMMS=(\d+)/.exec(t.out);
      writeFileSync(join(dir, 'agent-tests.log'), t.out);
      result.timings.npmTestInBoxMs = m ? Number(m[2]) : null;
      check('generated project tests pass independently', !!m && m[1] === '0' && /(?:#|ℹ) pass [1-9]/.test(t.out) && /(?:#|ℹ) fail 0\b/.test(t.out), m ? { exit: Number(m[1]) } : t.out.slice(-200));
      await term.write('/tmp/nm-eval-oracle.mjs', Buffer.from(oracleEveryCheck()));
      const o = await term.run(`node /tmp/nm-eval-oracle.mjs ${spec.id} '${boxCwd}' 2>&1 | tail -c 4000; rm -f /tmp/nm-eval-oracle.mjs`, 60_000);
      const oj = /NMORACLE(\{.*\})/.exec(o.out);
      result.oracle = oj ? JSON.parse(oj[1]) : { passed: false, error: o.out.slice(-1000) };
      for (const name of result.oracle.checks ?? []) result.checks.push({ name: `oracle: ${name}`, passed: true });
      for (const f of result.oracle.failed ?? []) result.checks.push({ name: `oracle: ${f.name}`, passed: false, detail: f.error });
      check('independent acceptance oracle passes', result.oracle.passed === true, oj ? undefined : result.oracle.error?.slice(-300));
      const diff = await term.run(`${gitIn('status --short')}; ${gitIn('diff --stat HEAD')} | tail -40`);
      writeFileSync(join(dir, 'diff-stat.txt'), diff.out);
    });

    // reload
    await phase('reload', async () => {
      await page.reload();
      await page.waitForSelector('.codingthread .cagent', { timeout: 60_000 });
      await page.waitForFunction(() => !document.querySelector('.codingthread .cagent')?.disabled, undefined, { timeout: 60_000 }).catch(() => {});
      const r = await uiState(page);
      const again = await fullPlanProgress(page).catch((e) => ({ error: e.message }));
      check('reload retains plan progress', JSON.stringify(again) === JSON.stringify(finalProgress), again);
      check('reload keeps completed composer progress hidden', !r.progress);
      check('reload retains applied review history', r.cards.some((c) => c.status === 'applied'));
      check('reload retains agent and model', r.agent.includes('rex') && (!MODEL || r.model.includes(spec.followup && HANDOFF ? HANDOFF : MODEL)), { agent: r.agent, model: r.model });
      check('thread has real assistant responses', r.replies.filter((t) => t.trim()).length > 1, r.replies.length);
      await capture(page, dir, 'solution');
    });
    if (spec.preview && boxCwd) {
      await phase('preview', async () => {
        try {
          const pv = await previewInBox(term, spec, boxCwd, result, dir);
          result.preview = pv.summary;
        } catch (e) {
          result.preview = `failed: ${e.message}`;
          result.checks.push({ name: 'preview checks ran', passed: false, detail: e.message.slice(0, 300) });
        }
      });
    } else result.checks.push({ name: 'preview checks', passed: null, status: 'not applicable (no preview in this case)' });
    result.consoleErrors = consoleErrors.slice(0, 20);
  } catch (e) {
    result.error = e.message;
    result.errorKind = e.kind ?? 'platform-or-driver';
    log(`[${spec.id}] ERROR (${result.errorKind}): ${e.message}`);
    if (page) await capture(page, dir, 'failure').catch(() => {});
  } finally {
    term?.close();
    // the wake watcher polls on its own: a case that failed before the wake does not wait for it
    if (wakeWatch) await Promise.race([wakeWatch, sleep(5_000)]);
    // park, and measure what the work snapshot carries now
    if (result.ids.machine) {
      try {
        const s = Date.now();
        const m = await park(result.ids.machine, 420_000);
        result.timings.finalParkMs = Date.now() - s;
        result.snapshot = { key: m.snapshot_work };
        const { url } = await call('GET', `/internal/e2e/machines/${result.ids.machine}/snapshot`, { fleet: true, as: null });
        const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
        const bytes = Buffer.from(await res.arrayBuffer());
        result.snapshot.compressedBytes = bytes.length;
        if (typeof zlib.zstdDecompressSync === 'function') {
          const tar = zlib.zstdDecompressSync(bytes);
          result.snapshot.tarBytes = tar.length;
          if (result.threadId) result.snapshot.holdsWorktree = tar.includes(Buffer.from(`-${result.threadId}/`));
        }
        log(`[${spec.id}] parked; snapshot ${result.snapshot.key} ${result.snapshot.compressedBytes} bytes`);
      } catch (e) { result.parkError = e.message; log(`[${spec.id}] PARK FAILED: ${e.message}`); }
    }
    await page?.close().catch(() => {});
    // the page's video is complete once the page is closed: keep it beside the screenshots
    if (VIDEO && page?.video()) {
      try { await page.video().saveAs(join(dir, `${spec.id}.webm`)); await page.video().delete().catch(() => {}); result.video = `${spec.id}/${spec.id}.webm`; }
      catch (e) { result.videoError = e.message; }
    }
    result.finishedAt = new Date().toISOString();
    result.durationMs = Date.parse(result.finishedAt) - Date.parse(result.startedAt);
    result.status = statusOf(result.checks.filter((c) => c.passed !== null), result.error);
    save();
    log(`[${spec.id}] ${result.status}: ${result.checks.filter((c) => c.passed).length} passed, ${result.checks.filter((c) => c.passed === false).length} failed, ${result.checks.filter((c) => c.passed === null).length} not run`);
  }
  return result;
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────
log(`coding evals ${tag}: ${CASES.join(', ')} on ${HQ} (${MODEL || 'starter'}${HANDOFF ? ` → ${HANDOFF}` : ''})`);
const specs = specsOf(CASES.flatMap((c) => (c.startsWith('bench:') ? [c.replace(/,/g, '+')] : [c])));
const browser = await chromium.launch();
const results = [];
try {
  const context = await browser.newContext({
    extraHTTPHeaders: { authorization: `Bearer ${await iapJwt()}` },
    ...(VIDEO ? { recordVideo: { dir: join(OUT, '.video'), size: { width: 1280, height: 800 } } } : {}),
  });
  // a JWT lives 60 minutes and a full suite runs longer: a fresh one every 40
  const refresh = setInterval(() => { iapJwt().then((j) => context.setExtraHTTPHeaders({ authorization: `Bearer ${j}` })).catch((e) => log(`JWT refresh failed: ${e.message}`)); }, 40 * 60_000);
  // bench tasks share one workspace and runner, so five small tasks cost one boot
  const shared = {};
  try { for (const spec of specs) results.push(await runCase(context, spec, spec.shared ? shared : null)); } finally { clearInterval(refresh); }
} finally { await browser.close().catch(() => {}); }
const summary = {
  tag, hq: HQ, api: API, model: MODEL || `starter (${STARTER_MODEL})`, handoffModel: HANDOFF || null, startedAt: new Date(t0).toISOString(), finishedAt: new Date().toISOString(),
  cases: results.map((r) => ({ id: r.id, status: r.status, error: r.error ?? null, errorKind: r.errorKind ?? null, passed: r.checks.filter((c) => c.passed).length, failed: r.checks.filter((c) => c.passed === false).map((c) => c.name), notRun: r.checks.filter((c) => c.passed === null).map((c) => c.name), timings: r.timings, snapshot: r.snapshot ?? null, ids: r.ids, threadUrl: r.url ?? null })),
};
writeFileSync(join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
process.exit(results.length && results.every((r) => r.status === 'passed') ? 0 : 1);
