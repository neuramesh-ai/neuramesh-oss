// THE HQ BROWSER CHECK (infra/images/hq/README.md). A real Chromium opens the sandbox hq on Cloud Run
// through IAP, as a person's browser does, and checks the browser path end to end:
//
//   1. IAP lets the page in, and the app renders into #root.
//   2. The replica (wa-sqlite on OPFS, in a dedicated worker) opens and syncs through the gateway.
//   3. The replica holds this person's workspace rows.
//   4. Nothing on the page throws, and no same-origin request fails on auth or on the server.
//
// With HQ_BROWSER_FLOW=chat it then walks the person's own path: it finishes the onboarding wizard
// if it is open, sends the composer's message, and waits for an agent's reply in the replica. That
// wakes the workspace's runner, so it costs a few minutes of a machine.
//
// IAP takes the smoke account's self-signed JWT as `Authorization: Bearer` on every request, the
// worker's too. Chromium refuses Proxy-Authorization as an injected header (net::ERR_INVALID_ARGUMENT).
// The injected header also replaces the app's own Authorization on the PowerSync calls, which is
// harmless: the gateway drops whatever the browser sends there and mints the sync token itself.
//
//   HQ_URL            the hq service URL (required)
//   IAP_JWT_FILE      a file that holds the JWT (aud "<HQ_URL>/*"), or IAP_JWT
//   OUT               where report.json and the screenshots go (default ./hq-browser-out)
//   PW_DIR            the directory playwright-core is installed in (default: resolve from here)
//   SYNC_TIMEOUT_MS   how long the replica may take to sync (default 120000)
//   HQ_BROWSER_FLOW   load (default) or chat
//   REPLY_TIMEOUT_MS  how long the agent may take to answer, a runner wake included (default 420000)
//
// Exit 0 when every check passes. The report never holds the JWT.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// the wizard's last button: "Start a new session →" since the 2026-11 upstream, "Meet @<agent> …" before it
const LAUNCH_BUTTON = /^(start a new session|meet @)/i;

const HQ = (process.env.HQ_URL ?? '').replace(/\/+$/, '');
const JWT = (process.env.IAP_JWT ?? (process.env.IAP_JWT_FILE ? readFileSync(process.env.IAP_JWT_FILE, 'utf8') : '')).trim();
const OUT = resolve(process.env.OUT ?? 'hq-browser-out');
const SYNC_TIMEOUT_MS = Number(process.env.SYNC_TIMEOUT_MS ?? 120_000);
const FLOW = process.env.HQ_BROWSER_FLOW === 'chat' ? 'chat' : 'load';
const REPLY_TIMEOUT_MS = Number(process.env.REPLY_TIMEOUT_MS ?? 420_000);
if (!HQ || !JWT) {
  console.error('hq-browser: HQ_URL and IAP_JWT (or IAP_JWT_FILE) are required');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const require = createRequire(process.env.PW_DIR ? join(resolve(process.env.PW_DIR), 'resolve.js') : import.meta.url);
const { chromium } = require('playwright-core');

const t0 = Date.now();
const at = () => Number(((Date.now() - t0) / 1000).toFixed(1));
/** same-origin: path and query (the app puts ids there, never a credential). Elsewhere: no query. */
const shown = (u) => {
  try {
    const x = new URL(u);
    return x.origin === HQ ? `${x.pathname}${x.search}` : `${x.origin}${x.pathname}`;
  } catch {
    return String(u).slice(0, 200);
  }
};
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
  const d = detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${d.length > 600 ? `${d.slice(0, 600)}…` : d}`);
};

const consoleLines = [];
const pageErrors = [];
const responses = [];
const failedRequests = [];
const workers = [];
const flow = {};

/** one query against the page's replica (window.__nmDb, a dev-user build only) */
const replica = (page, sql, params = []) => page.evaluate(async ([q, p]) => window.__nmDb ? window.__nmDb.getAll(q, p) : null, [sql, params]);

/** Poll an async page function until it returns something truthy. NOT page.waitForFunction: that
 *  one takes the predicate's promise as its answer at the first poll, so an async "not yet" (null)
 *  would pass at once. */
async function pollPage(page, fn, arg, { timeout, interval = 1_000 }) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(fn, arg).catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`no answer within ${timeout} ms`);
    await page.waitForTimeout(interval);
  }
}

/** THE WIZARD (apps/hq/src/views/Onboarding.tsx): Continue through each step, the Pro step's skip
 *  where it shows, and the last step's "Start a new session →" once the crew exists. Returns the steps it saw. */
async function walkWizard(page) {
  const steps = [];
  for (let guard = 0; guard < 20; guard++) {
    const bar = page.locator('[role="progressbar"][aria-valuenow]');
    if (!(await bar.count())) return { steps, open: false, ...(steps.length ? {} : { note: 'no wizard on screen' }) };
    const label = (await bar.getAttribute('aria-label')) ?? '?';
    if (steps.at(-1) !== label) steps.push(label);
    if (Number(await bar.getAttribute('aria-valuenow')) === Number(await bar.getAttribute('aria-valuemax'))) {
      // the last step reads "Please wait…" until nm.onboard has created the crew, then "Start a new session →" (it read "Meet @<orchestrator> …" before the 2026-11 upstream)
      const meet = page.getByRole('button', { name: LAUNCH_BUTTON });
      await meet.waitFor({ timeout: 180_000 });
      await page.screenshot({ path: join(OUT, '03-launch.png') });
      await meet.click({ timeout: 30_000 });
      await bar.waitFor({ state: 'detached', timeout: 30_000 });
      return { steps, open: false, finished: true };
    }
    const skip = page.locator('button.proskip');
    if (await skip.count()) await skip.click({ timeout: 30_000 });
    else await page.getByRole('button', { name: /^continue/i }).click({ timeout: 60_000 });
    await page.waitForFunction(
      (prev) => document.querySelector('[role="progressbar"][aria-valuenow]')?.getAttribute('aria-label') !== prev,
      label,
      { timeout: 60_000 },
    );
  }
  return { steps, open: true };
}

console.log(`== hq browser check (${FLOW}): ${HQ}`);
const browser = await chromium.launch();
let report = {};
try {
  const context = await browser.newContext({
    extraHTTPHeaders: { authorization: `Bearer ${JWT}` },
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type()) || /\[webnm\]/.test(m.text())) consoleLines.push({ t: at(), type: m.type(), text: m.text().slice(0, 600) });
  });
  page.on('pageerror', (e) => pageErrors.push({ t: at(), message: String(e?.message ?? e).slice(0, 600) }));
  page.on('response', (r) => responses.push({ t: at(), status: r.status(), method: r.request().method(), url: shown(r.url()), sameOrigin: r.url().startsWith(`${HQ}/`) }));
  page.on('requestfailed', (r) => failedRequests.push({ t: at(), method: r.method(), url: shown(r.url()), error: r.failure()?.errorText ?? '' }));
  page.on('worker', (w) => workers.push({ t: at(), url: shown(w.url()) }));

  // 1. the page, through IAP
  const doc = await page.goto(`${HQ}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  check('IAP lets the page in', doc?.status() === 200, `HTTP ${doc?.status()} at ${at()}s`);
  try {
    await page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, null, { timeout: 60_000 });
    check('the app renders into #root', true, `at ${at()}s`);
  } catch (e) {
    check('the app renders into #root', false, firstLine(e));
  }
  await page.screenshot({ path: join(OUT, '01-boot.png') });

  // 2. the replica: a dev-user build exposes it as window.__nmDb (apps/hq/web/main.tsx)
  let status;
  try {
    const handle = await page.waitForFunction(() => {
      const s = window.__nmDb?.currentStatus;
      // SQLiteReplica (client-core) stamps lastSyncedAt when a full pass ends: it has no hasSynced
      return s?.lastSyncedAt ? { connected: s.connected, lastSyncedAt: new Date(s.lastSyncedAt).toISOString() } : null;
    }, null, { timeout: SYNC_TIMEOUT_MS, polling: 500 });
    status = { ...(await handle.jsonValue()), at: at() };
  } catch {
    status = await page.evaluate(() => {
      const s = window.__nmDb?.currentStatus;
      if (!s) return { replica: 'absent' };
      return { connected: s.connected, lastSyncedAt: s.lastSyncedAt ? new Date(s.lastSyncedAt).toISOString() : null, error: String(s.error ?? ''), downloading: !!s.dataFlowStatus?.downloading, uploading: !!s.dataFlowStatus?.uploading };
    }).catch((e) => ({ evaluate: firstLine(e) }));
  }
  check('the replica (SQLite WASM on OPFS) opens and syncs through the gateway', !!status?.lastSyncedAt, status);

  // 3. what the replica holds
  const gateway = await page.evaluate(async () => (await fetch('/__hq/whoami')).json()).catch((e) => ({ error: firstLine(e) }));
  console.log(`  gateway: sync ${gateway?.sync ?? '?'}, relay ${gateway?.relay ?? 'none'}`);
  const counts = await page.evaluate(async () => {
    const db = window.__nmDb;
    if (!db) return null;
    const out = {};
    for (const t of ['workspace_members', 'channels', 'messages', 'agents', 'machines', 'projects']) {
      try { out[t] = (await db.get(`SELECT count(*) AS n FROM ${t}`)).n; } catch (e) { out[t] = String(e?.message ?? e); }
    }
    return out;
  }).catch((e) => ({ evaluate: firstLine(e) }));
  check("the replica holds this person's workspace rows", Number(counts?.workspace_members) > 0, counts);

  // let the app paint from the replica, then look at it
  await page.waitForTimeout(5_000);
  await page.screenshot({ path: join(OUT, '02-synced.png') });

  // 5. (HQ_BROWSER_FLOW=chat) the person's own path
  if (FLOW === 'chat') {
    try {
      flow.wizard = await walkWizard(page);
      check('the onboarding wizard finishes (or was done before)', flow.wizard.open === false, flow.wizard);
    } catch (e) {
      flow.wizard = { error: firstLine(e) };
      check('the onboarding wizard finishes (or was done before)', false, flow.wizard);
      await page.screenshot({ path: join(OUT, '03-wizard-stuck.png') });
    }
    if (flow.wizard.open === false) {
      await page.waitForTimeout(2_000);
      const box = page.locator('textarea:visible').first();
      let draft = '';
      try {
        await box.waitFor({ timeout: 30_000 });
        draft = await box.inputValue();
        if (!draft.trim()) {
          const orch = (await replica(page, "SELECT name FROM agents WHERE role = 'orchestrator' LIMIT 1"))?.[0]?.name;
          draft = `${orch ? `@${orch} ` : ''}introduce yourself in one sentence.`;
          await box.fill(draft);
        }
        await box.press('End');
        await box.press('Enter');
        // the mention menu takes the first Enter when it is open: a second one sends
        await page.waitForTimeout(1_500);
        if ((await box.inputValue()).trim()) await box.press('Enter');
        flow.sent = { draft: draft.slice(0, 160), at: at() };
      } catch (e) {
        flow.sent = { error: firstLine(e) };
      }
      await page.screenshot({ path: join(OUT, '04-sent.png') });
      // the send lands in the replica first, then the upload queue posts it through the gateway
      let mine = null;
      try {
        mine = await pollPage(page, async (text) => {
          const rows = await window.__nmDb?.getAll("SELECT id, channel_id, thread_id, created_at FROM messages WHERE author_kind = 'human' AND body = ? ORDER BY created_at DESC LIMIT 1", [text]);
          return rows?.[0] ?? null;
        }, draft, { timeout: 30_000, interval: 500 });
      } catch { /* reported below */ }
      check('the composer send lands in the replica', !!mine, mine ?? flow.sent);
      let uploaded = null;
      try {
        await page.waitForFunction(() => (window.__nmDb?.currentStatus?.dataFlowStatus?.uploading === false), null, { timeout: 30_000, polling: 500 });
        // the upload queue: nm_outbox on the SQLite replica (client-core sqlite-store.ts)
        const pending = await replica(page, 'SELECT count(*) AS n FROM nm_outbox');
        uploaded = { pendingCrud: Number(pending?.[0]?.n ?? -1) };
      } catch (e) {
        uploaded = { error: firstLine(e) };
      }
      const posts = responses.filter((r) => r.sameOrigin && r.method !== 'GET' && /^\/v1\/(messages|commands)/.test(r.url));
      check('the upload queue posts it through the gateway', uploaded?.pendingCrud === 0 && posts.some((r) => r.status < 300), { ...uploaded, posts: posts.slice(-5) });
      // the agent's answer: the runner wakes on the message, the agent replies, and sync brings it
      // down. It must be an agent's message in the same room, newer than the send (the synced
      // created_at of both rows is the server's, so they compare as text).
      let reply = null;
      if (mine) {
        try {
          const row = await pollPage(page, async (m) => {
            const rows = await window.__nmDb?.getAll(
              "SELECT m.author_id, a.name AS agent, m.thread_id, m.body, m.created_at FROM messages m LEFT JOIN agents a ON a.id = m.author_id WHERE m.author_kind = 'agent' AND m.channel_id = ? AND m.created_at > ? ORDER BY m.created_at LIMIT 1",
              [m.channel_id, m.created_at]);
            return rows?.[0] ?? null;
          }, mine, { timeout: REPLY_TIMEOUT_MS, interval: 2_000 });
          reply = { agent: row.agent ?? row.author_id, sameThread: !!mine.thread_id && row.thread_id === mine.thread_id, body: String(row.body ?? '').slice(0, 300), createdAt: row.created_at, at: at(), afterSend: flow.sent?.at ? Number((at() - flow.sent.at).toFixed(1)) : null };
        } catch (e) {
          reply = { error: firstLine(e) };
        }
      } else {
        reply = { error: 'no send to answer' };
      }
      flow.reply = reply;
      check("an agent's reply reaches the page through the replica", !reply.error && reply.body.length > 0, reply);
      await page.waitForTimeout(3_000);
      await page.screenshot({ path: join(OUT, '05-reply.png') });
    }
  }

  const text = await page.evaluate(() => document.body.innerText).catch(() => '');
  writeFileSync(join(OUT, 'page-text.txt'), text);
  try {
    writeFileSync(join(OUT, 'aria.yaml'), await page.locator('body').ariaSnapshot({ timeout: 10_000 }));
  } catch (e) {
    writeFileSync(join(OUT, 'aria.yaml'), `# ariaSnapshot failed: ${firstLine(e)}\n`);
  }

  // 4. nothing broke on the way
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 5));
  const AUTH_OR_SERVER = new Set([401, 403, 500, 502, 503, 504]);
  const broken = responses.filter((r) => r.sameOrigin && AUTH_OR_SERVER.has(r.status));
  check('no same-origin request failed on auth or on the server', broken.length === 0, broken.slice(0, 10));
  // IAP sends a request that carries no credential to Google sign-in (a 302 on this origin)
  const signIn = responses.filter((r) => (r.sameOrigin && r.status === 302) || r.url.startsWith('https://accounts.google.com'));
  check('every request carried the IAP credential (no sign-in redirects)', signIn.length === 0, signIn.slice(0, 10));
  check('the page is not an error screen', !/Something went wrong|Application error|IAP did not vouch/i.test(text), text.slice(0, 160).replace(/\s+/g, ' '));

  report = {
    hq: HQ,
    flow: FLOW,
    seconds: at(),
    checks,
    gateway: { sync: gateway?.sync ?? null, relay: gateway?.relay ?? null },
    replica: { status, counts },
    ...(FLOW === 'chat' ? { chat: flow } : {}),
    workers,
    consoleLines: consoleLines.slice(0, 120),
    pageErrors,
    notOk: responses.filter((r) => r.status >= 400).slice(0, 60),
    failedRequests: failedRequests.slice(0, 60),
    sameOrigin: responses.filter((r) => r.sameOrigin).map(({ t, status, method, url }) => ({ t, status, method, url })).slice(0, 400),
  };
} catch (e) {
  check('the browser check ran to the end', false, String(e?.stack ?? e).slice(0, 800));
  report = { hq: HQ, flow: FLOW, seconds: at(), checks, chat: flow, consoleLines, pageErrors, failedRequests };
} finally {
  await browser.close().catch(() => {});
}

writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const failed = checks.filter((c) => !c.ok).length;
console.log(`== ${checks.length - failed} passed, ${failed} failed (${at()}s). Report: ${join(OUT, 'report.json')}`);
if (consoleLines.length) {
  console.log('== console (errors, warnings, [webnm] lines):');
  for (const l of consoleLines.slice(0, 30)) console.log(`  ${l.t}s ${l.type}: ${l.text.slice(0, 300)}`);
}
process.exit(failed ? 1 : 0);
