// THE FEATURE SUITE'S TOOLKIT (features.mjs). Calls to nm-api as a person, the e2e doors, a
// browser context per person through IAP, the replica, and the check ledger every scenario writes.
//
// Two ways to act as a person, on purpose:
//   - `gw(person, ...)`: through the hq gateway with the person's IAP JWT, the browser's own lane.
//   - `api(...)`: nm-api directly with x-nm-actor and the actor secret, the e2e driver's lane. It
//     reaches the doors (fleet secret) too.
// Both name the same nm user: the gateway maps the IAP email through the same user door.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const env = (k, d) => process.env[k] ?? d;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const firstLine = (e) => String(e?.message ?? e).split('\n')[0];
const t0 = Date.now();
export const at = () => Number(((Date.now() - t0) / 1000).toFixed(1));

export const cfg = {
  hq: env('HQ_URL', '').replace(/\/+$/, ''),
  api: env('NM_API_URL', '').replace(/\/+$/, ''),
  fleetSecret: env('FLEET_SECRET', ''),
  actorSecret: env('NM_ACTOR_SECRET', ''),
  out: resolve(env('OUT', 'features-out')),
  pwDir: env('PW_DIR', ''),
  /** the two people: A owns the workspace, B is invited into it */
  people: {
    a: { email: env('PERSON_A_EMAIL', ''), jwt: readJwt('IAP_JWT_FILE_A') },
    b: { email: env('PERSON_B_EMAIL', ''), jwt: readJwt('IAP_JWT_FILE_B') },
  },
};
function readJwt(k) {
  const f = process.env[k];
  try { return f ? readFileSync(f, 'utf8').trim() : ''; } catch { return ''; }
}
mkdirSync(cfg.out, { recursive: true });

/** a fresh IAP JWT for a smoke account, signed with the build's own identity (the metadata server's
 *  token, then IAM Credentials signJwt), so a suite longer than the first JWT's hour keeps going */
export async function signIapJwt(email) {
  const tok = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'metadata-flavor': 'Google' }, signal: AbortSignal.timeout(10_000) });
  if (!tok.ok) throw new Error(`metadata token: HTTP ${tok.status}`);
  const { access_token: accessToken } = await tok.json();
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ iss: email, sub: email, aud: `${cfg.hq}/*`, iat: now, exp: now + 3600 });
  const res = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${email}:signJwt`, {
    method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ payload }), signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`signJwt for ${email}: HTTP ${res.status}`);
  return (await res.json()).signedJwt;
}

// ── the ledger ────────────────────────────────────────────────────────────────────────────────
/** one entry per scenario: { id, title, status: pass|fail|blocked|skipped, checks[], notes[], ms } */
export const results = [];

export class Blocked extends Error {}
export class Skip extends Error {}

export function scenarioCtx(id, title) {
  const r = { id, title, status: 'pass', checks: [], notes: [], startedAt: at() };
  results.push(r);
  const t = {
    r,
    check(name, ok, detail) {
      r.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail: trim(detail) }) });
      if (!ok) r.status = 'fail';
      const d = detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
      console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${name}${d.length > 400 ? `${d.slice(0, 400)}…` : d}`);
      return !!ok;
    },
    note(text) { r.notes.push(trim(text)); console.log(`    note  ${typeof text === 'string' ? text : JSON.stringify(text).slice(0, 300)}`); },
    /** the feature needs an account the sandbox does not have: say what, and stop the scenario */
    blocked(why) { throw new Blocked(why); },
    skip(why) { throw new Skip(why); },
  };
  return t;
}

function trim(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return v;
  return s.length > 1500 ? `${s.slice(0, 1500)}…` : (typeof v === 'string' ? v : JSON.parse(s));
}

// ── nm-api ────────────────────────────────────────────────────────────────────────────────────
export class HttpError extends Error {
  constructor(msg, status, json) { super(msg); this.status = status; this.json = json; }
}

/** nm-api directly. `as`: a user id (x-nm-actor human), an actor object, or null. `fleet`: the door bearer */
export async function api(method, path, { body, as = null, fleet = false, raw = false, timeout = 30_000 } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (fleet) headers.authorization = `Bearer ${cfg.fleetSecret}`;
  if (as) {
    headers['x-nm-actor'] = JSON.stringify(typeof as === 'string' ? { kind: 'human', id: as } : as);
    if (cfg.actorSecret) headers['x-nm-actor-secret'] = cfg.actorSecret;
  }
  const res = await fetch(`${cfg.api}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout) });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) throw new HttpError(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`, res.status, json);
  return json ?? text;
}

/** the same call through the hq gateway, as the person IAP vouches for */
export async function gw(person, method, path, { body, raw = false, timeout = 30_000 } = {}) {
  const res = await fetch(`${cfg.hq}${path}`, {
    method,
    headers: { authorization: `Bearer ${person.jwt}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeout),
  });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) throw new HttpError(`gw ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`, res.status, json);
  return json ?? text;
}

/** POST /v1/commands as a user */
export const cmd = (as, command) => api('POST', '/v1/commands', { body: command, as });

/** the actor header for one of the workspace's agents, by role (or name): the bare-header lane
 *  names it, exactly as a machine's host writes as its agent */
export function agentActor(ctx, roleOrName) {
  const a = ctx.ws.agents.find((x) => x.role === roleOrName) ?? ctx.ws.agents.find((x) => x.name === roleOrName);
  if (!a) throw new Error(`no ${roleOrName} agent in the workspace (agents: ${ctx.ws.agents.map((x) => `${x.name}:${x.role}`).join(', ')})`);
  return { kind: 'agent', id: a.id, role: a.role };
}

/** run a call that must be refused; returns the error code (or 'ok' when it was accepted) */
export async function refusal(promise) {
  try { await promise; return 'ok'; } catch (e) { return e?.json?.code ?? (e?.status ? `HTTP ${e.status}` : firstLine(e)); }
}

/** rows of one table as the person's feed carries them (GET /v1/sync/bootstrap): the replica's truth */
export async function feedRows(as, table, ws) {
  const boot = await api('GET', '/v1/sync/bootstrap', { as, timeout: 60_000 });
  return boot.changes.filter((c) => c.table === table && (!ws || !('workspace_id' in (c.row ?? {})) || c.row.workspace_id === ws)).map((c) => c.row);
}

/** GET /v1/tasks/:id → { task, events, artifacts } */
export const getTask = (as, id) => api('GET', `/v1/tasks/${id}`, { as });

/** poll until fn returns something truthy */
export async function until(label, fn, { timeout = 60_000, every = 2_000 } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) { last = e; }
    if (Date.now() > deadline) throw new Error(`timed out after ${Math.round(timeout / 1000)}s waiting for ${label}${last ? ` (last error: ${firstLine(last)})` : ''}`);
    await sleep(every);
  }
}

/** the doors (NM_E2E_ROUTES=1 and the fleet secret) */
export const door = {
  user: (email) => api('POST', '/internal/e2e/users', { fleet: true, body: { email } }),
  fund: (ws, body) => api('POST', `/internal/e2e/workspaces/${ws}/fund`, { fleet: true, body }),
  machine: (id) => api('GET', `/internal/e2e/machines/${id}`, { fleet: true }),
  messages: (ws, since) => api('GET', `/internal/e2e/workspaces/${ws}/messages?since=${encodeURIComponent(since)}`, { fleet: true }).then((j) => j.messages),
  idleDrain: (id) => api('POST', `/internal/machines/${id}/idle-drain`, { fleet: true, body: {} }),
};

// ── the browser ───────────────────────────────────────────────────────────────────────────────
let chromium = null;
export function playwright() {
  if (chromium) return chromium;
  const require = createRequire(cfg.pwDir ? join(resolve(cfg.pwDir), 'resolve.js') : import.meta.url);
  ({ chromium } = require('playwright-core'));
  return chromium;
}

/** what every page saw: console errors, page errors, responses (no credentials kept) */
export function watchPage(page, tag, seen = { tag, console: [], errors: [], responses: [] }) {
  const shown = (u) => {
    try { const x = new URL(u); return x.origin === cfg.hq ? `${x.pathname}${x.search}` : `${x.origin}${x.pathname}`; } catch { return String(u).slice(0, 200); }
  };
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) seen.console.push({ t: at(), type: m.type(), text: m.text().slice(0, 400) }); });
  page.on('pageerror', (e) => seen.errors.push({ t: at(), message: String(e?.message ?? e).slice(0, 400) }));
  page.on('response', (r) => seen.responses.push({ t: at(), status: r.status(), method: r.request().method(), url: shown(r.url()), same: r.url().startsWith(`${cfg.hq}/`) }));
  return seen;
}

/** a browser context's video option: on unless VIDEO=0. Files land in OUT/.video until a scenario
 *  ends and keeps its page's recording as <scenario>.webm */
export function videoOpts() {
  return env('VIDEO', '1') === '0' ? {} : { recordVideo: { dir: join(cfg.out, '.video'), size: { width: 1280, height: 800 } } };
}

/** one query against the page's replica (window.__nmDb, a dev-user build only) */
export const replica = (page, sql, params = []) => page.evaluate(async ([q, p]) => (window.__nmDb ? window.__nmDb.getAll(q, p) : null), [sql, params]);

/** poll a replica query until it returns at least one row */
export async function replicaRow(page, sql, params, { timeout = 60_000, every = 1_000 } = {}) {
  return until(`a replica row for: ${sql.slice(0, 80)}`, async () => (await replica(page, sql, params))?.[0] ?? null, { timeout, every });
}

let shot = 0;
export async function snap(page, name) {
  const file = `${String(++shot).padStart(2, '0')}-${name.replace(/[^a-z0-9-]+/gi, '-').slice(0, 60)}.png`;
  await page.screenshot({ path: join(cfg.out, file) }).catch(() => {});
  return file;
}

/** a string as a literal regular expression */
export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** visible text on the page */
export const bodyText = (page) => page.evaluate(() => document.body.innerText).catch(() => '');

/** wait for a regexp to show in the page's visible text */
export async function seeText(page, re, { timeout = 30_000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const text = await bodyText(page);
    const m = re.exec(text);
    if (m) return m[0];
    if (Date.now() > deadline) return null;
    await page.waitForTimeout(750);
  }
}

/** click the first visible element of a locator; false when there is none */
export async function clickIf(locator, { timeout = 10_000 } = {}) {
  try {
    await locator.first().click({ timeout });
    return true;
  } catch {
    return false;
  }
}

/** open an hq destination the way a person does: the rail's Chat mode band (Automations,
 *  Customizations, Marketing OS), its More menu (Whiteboards, Files), or Code mode's Tasks.
 *  Returns false when the door was not there. */
export async function goView(page, label) {
  await page.keyboard.press('Escape').catch(() => {});
  const mode = label === 'Tasks' ? 'Code' : 'Chat';
  // the Chat | Code switch at the rail's head (a button or a tab, by build)
  const sw = page.locator(`button:text-is("${mode}"), [role="tab"]:text-is("${mode}")`).first();
  await sw.click({ timeout: 5_000 }).catch(() => {});
  const direct = page.locator(`button.navitem[aria-label="${label}"]`);
  if (!(await direct.count()) && label === 'Tasks') {
    // Chat mode's More menu holds the Code door, which switches the rail to Code mode
    await clickIf(page.locator('button.navitem[aria-label="More"]'), { timeout: 5_000 });
    await clickIf(page.getByRole('menuitem', { name: 'Code' }), { timeout: 5_000 });
  }
  if (await direct.count()) return clickIf(direct);
  await clickIf(page.locator('button.navitem[aria-label="More"]'), { timeout: 5_000 });
  return clickIf(page.getByRole('menuitem', { name: label }), { timeout: 5_000 });
}

export function writeReport(extra) {
  const summary = { pass: 0, fail: 0, blocked: 0, skipped: 0 };
  for (const r of results) summary[r.status === 'skipped' ? 'skipped' : r.status] = (summary[r.status === 'skipped' ? 'skipped' : r.status] ?? 0) + 1;
  const report = { seconds: at(), summary, results, ...extra };
  writeFileSync(join(cfg.out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
